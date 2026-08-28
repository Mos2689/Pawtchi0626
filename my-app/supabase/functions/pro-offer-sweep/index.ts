/**
 * pro-offer-sweep — decides who becomes eligible for the discounted plan.
 *
 * Runs every six hours. Two passes, in this order:
 *
 *   1. Expire windows that ran out of time.
 *   2. Evaluate candidates and write grants.
 *
 * Expiry runs first so a user whose window closed this tick cannot be counted
 * as still-open by anything downstream in the same run.
 *
 * ── Why the rules are not in this file ──────────────────────────────────────
 *
 * `evaluateEligibility` and `assignCohort` come from `_shared/proOffer/`, which
 * is byte-mirrored from `lib/proOffer/` by scripts/sync-notification-shared.js
 * and asserted in the app test suite. The August 2026 audit found the live
 * notification dispatcher had been a dashboard-only fork of the app's rules,
 * drifting for four months. The same mistake here would not push a wrong
 * string to somebody — it would hand a permanent discount to a segment that
 * would have paid full price, and it would surface as a revenue number long
 * after the cause was forgotten.
 *
 * ── Dry run ─────────────────────────────────────────────────────────────────
 *
 * With `enabled = false` the sweep evaluates every candidate and reports the
 * pool size and which rule is binding, but writes NOTHING. That is how we find
 * out whether the experiment can reach significance before discounting a
 * dollar — and writing during a dry run would have been actively harmful, since
 * a grant row is the one-window-per-user record and would have burned the
 * population the experiment needs. See the note at the write site.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import { isAuthorisedCronRequest, unauthorised } from '../_shared/notifications/cronAuth.ts';
import { assignCohort, evaluateEligibility } from '../_shared/proOffer/eligibility.ts';
import { PRO_OFFER_CONFIG_FALLBACK } from '../_shared/proOffer/types.ts';
import type {
  IneligibleReason,
  ProOfferConfig,
  ProOfferSignals,
} from '../_shared/proOffer/types.ts';

/** One row of get_pro_offer_candidates(). */
interface CandidateRow {
  owner_id: string;
  account_age_days: number;
  views_total: number;
  dismissals_total: number;
  dismissals_post_freemium: number;
  days_since_last_dismissal: number | null;
  purchase_started_count: number;
  days_since_purchase_started: number | null;
  active_days_14: number;
  walks_30d: number;
  is_review_bypass: boolean;
}

/**
 * A numeric threshold, or the launch default.
 *
 * The failure this guards against matters more here than anywhere else. If a
 * dropped or renamed column arrived as `undefined`, every threshold comparison
 * in evaluateEligibility (`accountAgeDays < undefined`) would be false, no
 * reason would be recorded, and this sweep would grant the offer to the entire
 * user base in one run — permanently, since a grant row is written once and
 * never revisited. A schema typo would read as a spectacular experiment.
 */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function rowToConfig(row: Record<string, unknown>): ProOfferConfig {
  const d = PRO_OFFER_CONFIG_FALLBACK;
  return {
    enabled: row.enabled === true,
    // Falls back to 0, not to the default: a corrupt allocation should put
    // everyone in control, not in the discount arm.
    variantAllocationPct: num(row.variant_allocation_pct, 0),
    offeringId: typeof row.offering_id === 'string' && row.offering_id
      ? row.offering_id
      : d.offeringId,
    minAccountAgeDays: num(row.min_account_age_days, d.minAccountAgeDays),
    minDismissalsPostFreemium: num(row.min_dismissals_post_freemium, d.minDismissalsPostFreemium),
    minDismissalsTotal: num(row.min_dismissals_total, d.minDismissalsTotal),
    dismissalCooldownDays: num(row.dismissal_cooldown_days, d.dismissalCooldownDays),
    minActiveDays14: num(row.min_active_days_14, d.minActiveDays14),
    purchaseStartedCooldownDays: num(
      row.purchase_started_cooldown_days,
      d.purchaseStartedCooldownDays,
    ),
    offerWindowDays: num(row.offer_window_days, d.offerWindowDays),
    maxImpressions: num(row.max_impressions, d.maxImpressions),
    impressionSpacingHours: num(row.impression_spacing_hours, d.impressionSpacingHours),
    inboxEnabled: row.inbox_enabled === true,
    configVersion: num(row.config_version, 0),
  };
}

function rowToSignals(row: CandidateRow): ProOfferSignals {
  return {
    ownerId: row.owner_id,
    accountAgeDays: row.account_age_days ?? 0,
    viewsTotal: row.views_total ?? 0,
    dismissalsTotal: row.dismissals_total ?? 0,
    dismissalsPostFreemium: row.dismissals_post_freemium ?? 0,
    daysSinceLastDismissal: row.days_since_last_dismissal,
    purchaseStartedCount: row.purchase_started_count ?? 0,
    daysSincePurchaseStarted: row.days_since_purchase_started,
    activeDays14: row.active_days_14 ?? 0,
    walks30d: row.walks_30d ?? 0,
    isReviewBypass: !!row.is_review_bypass,
  };
}

serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // Fail-closed, before any work. Same guard as notify-dispatch.
  if (!(await isAuthorisedCronRequest(req, admin))) return unauthorised();

  const { data: configRow, error: configErr } = await admin
    .from('pro_offer_config')
    .select('*')
    .limit(1)
    .maybeSingle();

  if (configErr || !configRow) {
    console.error('[pro-offer-sweep] config unreadable:', configErr?.message);
    return new Response(JSON.stringify({ error: 'config_unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const config = rowToConfig(configRow);

  // ── Pass 1: expire ────────────────────────────────────────────────────────
  const { data: expiredCount, error: expireErr } = await admin.rpc('expire_pro_offers');
  if (expireErr) console.error('[pro-offer-sweep] expire failed:', expireErr.message);

  // ── Pass 2: evaluate ──────────────────────────────────────────────────────
  const { data: candidates, error: candErr } = await admin.rpc('get_pro_offer_candidates');
  if (candErr) {
    console.error('[pro-offer-sweep] candidates failed:', candErr.message);
    return new Response(JSON.stringify({ error: 'candidates_unavailable' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = (candidates ?? []) as CandidateRow[];

  // Which rule is actually binding. Without this the only observable output of
  // a dry run is "N eligible", which does not tell you whether to loosen the
  // account-age floor or the engagement floor to get a testable pool.
  const blockedBy: Record<string, number> = {};
  let eligible = 0;
  let granted = 0;
  let variant = 0;

  for (const row of rows) {
    const signals = rowToSignals(row);
    const decision = evaluateEligibility(signals, config);

    if (!decision.eligible) {
      for (const reason of decision.reasons as IneligibleReason[]) {
        blockedBy[reason] = (blockedBy[reason] ?? 0) + 1;
      }
      continue;
    }
    eligible++;

    // ── Dry run: COUNT, do not write ──────────────────────────────────────
    //
    // The first version of this wrote control-cohort grants while disabled, so
    // the eligible pool could be sized. That was wrong, and quietly so: a grant
    // row is the one-window-per-user record, `get_pro_offer_candidates`
    // excludes anyone who has one, and `grant_pro_offer` is ON CONFLICT DO
    // NOTHING. Two weeks of dry running would have permanently locked every
    // qualifying user into control — burning exactly the population the
    // experiment needs, and nothing would have looked broken.
    //
    // The summary below reports the same pool size without touching anybody.
    if (!config.enabled) continue;

    // A review-bypass account forced into control by the hash would show App
    // Review the standard paywall — which defeats the entire purpose of listing
    // it. Bypass means variant, always.
    const cohort = signals.isReviewBypass
      ? 'variant'
      : assignCohort(signals.ownerId, config.variantAllocationPct);

    const { data: inserted, error: grantErr } = await admin.rpc('grant_pro_offer', {
      p_owner_id: signals.ownerId,
      p_cohort: cohort,
      p_window_days: config.offerWindowDays,
      p_config_version: config.configVersion,
      // Frozen at grant time. Recomputing these at analysis time would let the
      // cohort definition drift under the experiment.
      p_signals: {
        account_age_days: signals.accountAgeDays,
        dismissals_total: signals.dismissalsTotal,
        dismissals_post_freemium: signals.dismissalsPostFreemium,
        days_since_last_dismissal: signals.daysSinceLastDismissal,
        purchase_started_count: signals.purchaseStartedCount,
        active_days_14: signals.activeDays14,
        walks_30d: signals.walks30d,
        review_bypass: signals.isReviewBypass,
      },
    });

    if (grantErr) {
      console.error('[pro-offer-sweep] grant failed:', signals.ownerId, grantErr.message);
      continue;
    }
    if (inserted) {
      granted++;
      if (cohort === 'variant') variant++;
    }
  }

  const summary = {
    dry_run: !config.enabled,
    config_version: config.configVersion,
    candidates: rows.length,
    // Would-be grants. In a dry run this is the whole point of the call, and
    // `granted` stays 0 because nothing was written.
    eligible,
    expired: expiredCount ?? 0,
    granted,
    variant,
    control: granted - variant,
    // Which rule is actually binding. Without this the only output is "N
    // eligible", which does not tell you whether to loosen the account-age
    // floor or the engagement floor to reach a testable pool.
    blocked_by: blockedBy,
  };

  console.log('[pro-offer-sweep]', JSON.stringify(summary));

  return new Response(JSON.stringify(summary), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});

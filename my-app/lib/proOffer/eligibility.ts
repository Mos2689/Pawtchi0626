/**
 * The pro-offer rule engine. PURE — no RN, no Supabase, no clock of its own.
 *
 * Everything here is a function of (signals, config, now). That is what lets
 * the same code decide grants inside the server sweep and decide rendering
 * inside the paywall, without the two drifting apart — the failure mode the
 * notification pipeline was rebuilt to escape (one dispatcher, mirrored rules).
 *
 * ── The number that governs the whole design ────────────────────────────────
 *
 * At $6.99 against $9.99, the discount arm needs a +43% relative conversion
 * lift (9.99 / 6.99 = 1.43) just to break even on revenue at equal retention.
 * That is a low bar only if the eligible segment converts at close to zero.
 * So every rule below exists to answer one question: is this person's
 * probability of ever paying $9.99 approximately nil? Anyone we let through who
 * would have paid full price costs $3.00 a month for the life of their
 * subscription — permanently, since a price rise later needs their consent.
 */

import type {
  DisplayDecision,
  EligibilityDecision,
  IneligibleReason,
  ProOfferCohort,
  ProOfferConfig,
  ProOfferGrant,
  ProOfferSignals,
} from './types';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Rules B–F. A ("never purchased") and G ("no prior grant") are structural
 * rather than tunable, so they are applied by the SQL candidate query — no
 * config value can ever relax them, and filtering early keeps the sweep small.
 *
 * Returns every failing reason rather than short-circuiting, because the
 * dry-run pass needs to know which rule is actually binding before we decide
 * whether the eligible pool is large enough to run an experiment on at all.
 */
export function evaluateEligibility(
  signals: ProOfferSignals,
  config: ProOfferConfig,
): EligibilityDecision {
  // App Review cannot age an account 45 days inside a review cycle. Bypassing
  // is a row in config, not a branch in shipped app code.
  if (signals.isReviewBypass) {
    return { eligible: true, reasons: [] };
  }

  const reasons: IneligibleReason[] = [];

  // B — 30 days of freemium plus 14 days of genuinely being behind the wall.
  // Before day 31 nothing was withheld, so nothing was refused.
  if (signals.accountAgeDays < config.minAccountAgeDays) {
    reasons.push('account_too_young');
  }

  // C — the refusal signal. Post-freemium dismissals are the only ones that
  // mean anything: a dismissal on day 6 is someone closing a screen that was
  // not stopping them from doing anything.
  if (signals.dismissalsPostFreemium < config.minDismissalsPostFreemium) {
    reasons.push('too_few_post_freemium_dismissals');
  }
  if (signals.dismissalsTotal < config.minDismissalsTotal) {
    reasons.push('too_few_total_dismissals');
  }

  // D — the primary anti-cannibalisation rule, and the reason this feature is
  // safe to ship at all. A discount that arrives five days after a dismissal
  // cannot be learned as a response to that dismissal. Remove this rule and we
  // are teaching "close the paywall, get a cheaper Pawtchi".
  //
  // Never dismissed → null → C has already failed, so no reason to add here.
  if (
    signals.daysSinceLastDismissal !== null &&
    signals.daysSinceLastDismissal < config.dismissalCooldownDays
  ) {
    reasons.push('dismissal_too_recent');
  }

  // E — the value floor. A dormant user is a retention problem, not a
  // monetisation one; discounting them buys a subscriber who churns in a month
  // and makes the arm look worse than doing nothing.
  if (signals.activeDays14 < config.minActiveDays14) {
    reasons.push('not_engaged_enough');
  }

  // F — the judgment call. A StoreKit sheet abandon is as often a failed Face
  // ID or a missing payment method as it is a refused price, so a recent
  // abandoner may well still convert at $9.99. They cool longer rather than
  // being excluded permanently.
  if (
    signals.daysSincePurchaseStarted !== null &&
    signals.daysSincePurchaseStarted < config.purchaseStartedCooldownDays
  ) {
    reasons.push('checkout_too_recent');
  }

  return { eligible: reasons.length === 0, reasons };
}

/**
 * FNV-1a over the user id, bucketed 0–99.
 *
 * Deterministic and stateless so the same user always lands in the same bucket
 * no matter which process asks. A random draw stored at grant time would work
 * too, right up until a partially-failed sweep re-ran and reassigned somebody
 * mid-experiment.
 */
export function bucketFor(ownerId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < ownerId.length; i++) {
    hash ^= ownerId.charCodeAt(i);
    // >>> 0 keeps it an unsigned 32-bit int; JS bitwise ops are signed.
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash % 100;
}

/** `variant` below the allocation line, `control` above it. 0% → nobody. */
export function assignCohort(ownerId: string, variantAllocationPct: number): ProOfferCohort {
  const pct = Math.max(0, Math.min(100, variantAllocationPct));
  return bucketFor(ownerId) < pct ? 'variant' : 'control';
}

/**
 * Should the win-back paywall render right now?
 *
 * `isPro` is passed in from RevenueCat rather than read from the grant, and it
 * is checked FIRST. The grant's `ever_entitled_at` mirror in Postgres is
 * allowed to be stale — someone can subscribe on another device and not reopen
 * this one — so the live entitlement is the only thing that can be trusted to
 * keep a discount screen away from a paying subscriber.
 */
export function shouldShowOffer(
  grant: ProOfferGrant | null,
  config: ProOfferConfig,
  opts: { now: Date; isPro: boolean },
): DisplayDecision {
  const none = (reason: DisplayDecision['reason']): DisplayDecision => ({
    show: false,
    reason,
    impressionIndex: 0,
    daysLeftInWindow: 0,
  });

  if (opts.isPro) return none('already_subscribed');
  if (!config.enabled) return none('config_disabled');
  if (!grant) return none('no_grant');
  if (grant.cohort === 'control') return none('control_cohort');
  if (grant.status !== 'granted' && grant.status !== 'shown') return none('window_closed');

  const expiresAt = Date.parse(grant.expiresAt);
  // An unparseable timestamp is a bug, not a licence to show a discount
  // forever. Fail closed, consistent with the config fallback.
  if (!Number.isFinite(expiresAt) || expiresAt <= opts.now.getTime()) {
    return none('window_closed');
  }

  if (grant.shownCount >= config.maxImpressions) return none('impressions_exhausted');

  if (grant.lastShownAt) {
    const last = Date.parse(grant.lastShownAt);
    if (
      Number.isFinite(last) &&
      opts.now.getTime() - last < config.impressionSpacingHours * MS_PER_HOUR
    ) {
      return none('too_soon_since_last_impression');
    }
  }

  return {
    show: true,
    reason: null,
    impressionIndex: grant.shownCount + 1,
    daysLeftInWindow: Math.max(0, Math.ceil((expiresAt - opts.now.getTime()) / MS_PER_DAY)),
  };
}

/**
 * Whether a grant should be closed out by the sweep.
 *
 * Impression exhaustion is handled in `record_pro_offer_impression` at the
 * moment it happens, so the next open is already the standard paywall rather
 * than waiting up to six hours for a cron tick. This covers time expiry only.
 */
export function hasWindowElapsed(grant: ProOfferGrant, now: Date): boolean {
  if (grant.status !== 'granted' && grant.status !== 'shown') return false;
  const expiresAt = Date.parse(grant.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

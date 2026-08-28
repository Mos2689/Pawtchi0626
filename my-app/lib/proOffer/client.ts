/**
 * The impure edge of the pro offer: Supabase reads/writes and the local cache.
 *
 * Everything that decides anything lives in `eligibility.ts`, which is pure and
 * tested. This file only fetches, caches and reports — so a bug here can lose
 * an offer, but it cannot invent one.
 *
 * ── Cache policy ────────────────────────────────────────────────────────────
 *
 * Config and grant are cached in AsyncStorage so the paywall can paint without
 * waiting on the network, and so impression spacing still works offline. The
 * cache is never authoritative:
 *
 *   - config cache miss  → PRO_OFFER_CONFIG_FALLBACK, which has `enabled:false`
 *   - grant cache miss   → null, i.e. the standard paywall
 *
 * Both fail CLOSED. The access model in SubscriptionProvider deliberately fails
 * OPEN on the same kind of error, and the asymmetry is intentional: wrongly
 * granting access costs nothing, wrongly granting a discount costs $3/month for
 * the life of a subscription.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../supabase';
import { PRO_OFFER_CONFIG_FALLBACK } from './types';
import type { ProOfferConfig, ProOfferGrant } from './types';

const CONFIG_KEY = '@pawtchi/pro_offer_config';
const GRANT_PREFIX = '@pawtchi/pro_offer_grant:';
/** Per-user, so the next account on a shared device cannot inherit a grant. */
const grantKey = (userId: string) => `${GRANT_PREFIX}${userId}`;

/** Beyond this the cached config is refreshed, but it is still used meanwhile. */
const CONFIG_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedConfig {
  config: ProOfferConfig;
  fetchedAt: number;
}

/**
 * A numeric threshold, or the launch default if the column is missing or
 * unusable.
 *
 * This is not defensive noise. If a renamed or dropped column arrived here as
 * `undefined`, every threshold comparison in the rule engine
 * (`accountAgeDays < undefined`) would evaluate to false, no reason would be
 * pushed, and the sweep would declare the entire user base eligible. A schema
 * typo would read as a spectacularly successful experiment.
 */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Postgres row → config, field by field, with each fallback named explicitly. */
function rowToConfig(row: Record<string, unknown>): ProOfferConfig {
  const d = PRO_OFFER_CONFIG_FALLBACK;
  return {
    enabled: row.enabled === true,
    // Not `?? d.variantAllocationPct` — the fallback is 0, and defaulting a
    // corrupt allocation to "everyone in control" is the safe direction.
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

/**
 * Postgres row → grant. Returns null for anything that is not a usable grant,
 * including a row missing its cohort or expiry — a grant with no window is not
 * a conservative grant, it is an unbounded one.
 */
function rowToGrant(row: Record<string, unknown> | null | undefined): ProOfferGrant | null {
  if (!row) return null;
  const { cohort, status, eligible_at, expires_at, last_shown_at } = row;
  if (cohort !== 'control' && cohort !== 'variant') return null;
  if (typeof status !== 'string' || typeof expires_at !== 'string') return null;
  return {
    cohort,
    status: status as ProOfferGrant['status'],
    eligibleAt: typeof eligible_at === 'string' ? eligible_at : expires_at,
    expiresAt: expires_at,
    lastShownAt: typeof last_shown_at === 'string' ? last_shown_at : null,
    shownCount: num(row.shown_count, 0),
    configVersion: num(row.config_version, 0),
  };
}

/**
 * Live config, falling back to cache, then to the disabled default.
 *
 * Returns the cached value immediately if it is fresh; otherwise refetches but
 * still returns the stale cache on failure. A network blip must not flip the
 * offer off for someone mid-window — that would read as the price vanishing.
 */
export async function loadProOfferConfig(): Promise<ProOfferConfig> {
  let cached: CachedConfig | null = null;
  try {
    const raw = await AsyncStorage.getItem(CONFIG_KEY);
    if (raw) cached = JSON.parse(raw) as CachedConfig;
  } catch {
    // Corrupt cache is the same as no cache.
  }

  if (cached && Date.now() - cached.fetchedAt < CONFIG_TTL_MS) {
    return cached.config;
  }

  try {
    // An RPC rather than a table select: pro_offer_config has RLS on with no
    // policy, so PostgREST cannot read it at all. The function returns the
    // columns a device needs and withholds review_bypass_user_ids.
    const { data, error } = await supabase.rpc('get_pro_offer_config');
    if (error) throw error;

    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    if (!row) throw new Error('no_config_row');

    const config = rowToConfig(row);
    await AsyncStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({ config, fetchedAt: Date.now() } satisfies CachedConfig),
    );
    return config;
  } catch {
    return cached?.config ?? PRO_OFFER_CONFIG_FALLBACK;
  }
}

/** The user's grant, or null. Cached per-user; stale cache beats no answer. */
export async function loadProOfferGrant(userId: string): Promise<ProOfferGrant | null> {
  try {
    const { data, error } = await supabase.rpc('get_pro_offer_state');
    if (error) throw error;

    const grant = rowToGrant(Array.isArray(data) ? data[0] : data);
    await AsyncStorage.setItem(grantKey(userId), JSON.stringify(grant));
    return grant;
  } catch {
    try {
      const raw = await AsyncStorage.getItem(grantKey(userId));
      return raw ? (JSON.parse(raw) as ProOfferGrant | null) : null;
    } catch {
      return null;
    }
  }
}

/**
 * Wipe every cached grant on this device. Called from clearAllUserState().
 *
 * Sweeps by prefix rather than taking a user id, because the sign-out path in
 * AuthProvider clears state without one, and threading an id through it just
 * for this would be a second thing to forget.
 *
 * This mirrors the `runtimeItems: []` reset in useNotificationCenterStore,
 * which exists because a card published for one account once survived into the
 * next account on the same device. A leaked grant would be that bug with a
 * price attached.
 */
export async function clearProOfferCache(): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(k => k.startsWith(GRANT_PREFIX));
    if (mine.length > 0) await AsyncStorage.multiRemove(mine);
  } catch {
    // Best-effort; a stale cache still cannot show an offer, because every
    // render re-checks isPro and the server status.
  }
}

// ── Writes. All best-effort: instrumentation must never break a purchase. ──

export type PaywallInteractionKind = 'view' | 'dismiss' | 'purchase_started';

/**
 * Feeds the eligibility counters.
 *
 * `postFreemium` is decided by the caller because SubscriptionProvider already
 * computes it (`!isFreemiumActive`); re-deriving it in SQL would let the wall
 * and the counter disagree about who is actually behind it.
 */
export async function recordPaywallInteraction(
  kind: PaywallInteractionKind,
  postFreemium: boolean,
): Promise<void> {
  try {
    await supabase.rpc('record_paywall_interaction', {
      p_kind: kind,
      p_post_freemium: postFreemium,
    });
  } catch {
    // Swallow — a failed counter costs one signal, a thrown error costs a sale.
  }
}

/** Mirrors "this account has held the entitlement" into Postgres. Write-once. */
export async function recordEntitlementSeen(): Promise<void> {
  try {
    await supabase.rpc('record_entitlement_seen');
  } catch {
    // Best-effort. The live RevenueCat check is the real gate.
  }
}

/**
 * Burns an impression and returns the new count.
 *
 * Server-side and idempotent inside the spacing window, which is what stops two
 * devices from spending two impressions on one sighting. Returns 0 when the
 * call fails so the caller reports an unknown index rather than guessing.
 */
export async function recordProOfferImpression(): Promise<number> {
  try {
    const { data, error } = await supabase.rpc('record_pro_offer_impression');
    if (error) throw error;
    return typeof data === 'number' ? data : 0;
  } catch {
    return 0;
  }
}

export async function recordProOfferConversion(productId: string): Promise<void> {
  try {
    await supabase.rpc('record_pro_offer_conversion', { p_product_id: productId });
  } catch {
    // The entitlement is what grants access; this row is measurement only.
  }
}

/** Withdraws an open offer. The path that keeps discounts away from payers. */
export async function revokeProOffer(reason: string): Promise<void> {
  try {
    await supabase.rpc('revoke_pro_offer', { p_reason: reason });
  } catch {
    // Client-side isPro still suppresses the screen on every render.
  }
}

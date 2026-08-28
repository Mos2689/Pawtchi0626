/**
 * The pro-offer contract, shared by the pure rule engine, the client hook and
 * the server sweep.
 *
 * Kept dependency-free on purpose: `eligibility.ts` is unit-tested under
 * `testEnvironment: node` (see package.json jest config), so nothing in this
 * folder may import React Native, Supabase or RevenueCat. The impure edges live
 * in `config.ts` and `hooks/useProOffer.ts`.
 */

/**
 * Which arm of the experiment a user landed in. Assigned once at grant time
 * from a deterministic hash of the user id and never recomputed — a sweep
 * re-run must not be able to move anyone between arms.
 *
 * `control` users are eligible and DO get a grant row. That is not an
 * oversight: without a row the two arms have different denominators and
 * "revenue per eligible user" cannot be computed at all.
 */
export type ProOfferCohort = 'control' | 'variant';

/**
 * Note what is absent: there is no `NOT_ELIGIBLE` and no `DISMISSED`.
 *
 * "Not eligible" is the absence of a grant row — storing a row per
 * non-qualifying account would be a row per user to express nothing.
 *
 * "Dismissed" is not a state because a dismissal is not terminal. It is
 * `shownCount` incrementing. Modelling it as a status makes "dismissed once,
 * then bought" unrepresentable, and that is the outcome we most want to see.
 */
export type ProOfferStatus =
  /** Eligible, nothing shown yet. */
  | 'granted'
  /** Seen at least once, window still open. */
  | 'shown'
  /** Purchased the discounted SKU. */
  | 'converted'
  /** Window elapsed, or the impression budget ran out. */
  | 'expired'
  /**
   * Withdrawn. Subscribed at full price, kill switch flipped, review cleanup.
   * The proposed state model had no way to express this, which meant a paying
   * subscriber could keep seeing a discount screen.
   */
  | 'revoked';

/** Server config. Every field is a knob that must be changeable without a build. */
export interface ProOfferConfig {
  enabled: boolean;
  variantAllocationPct: number;
  /** RevenueCat offering id — the pricing-experiment lever. Never a product id. */
  offeringId: string;

  minAccountAgeDays: number;
  minDismissalsPostFreemium: number;
  minDismissalsTotal: number;
  dismissalCooldownDays: number;
  minActiveDays14: number;
  purchaseStartedCooldownDays: number;

  offerWindowDays: number;
  maxImpressions: number;
  impressionSpacingHours: number;

  inboxEnabled: boolean;
  configVersion: number;
}

/**
 * The safe default. Used when the config fetch fails and nothing is cached.
 *
 * Fails CLOSED — offer off. Note the deliberate asymmetry with
 * SubscriptionProvider, which fails OPEN (a transient error grants access
 * rather than locking a paying customer out). Being generous with access is
 * safe; being generous with discounts is not.
 */
export const PRO_OFFER_CONFIG_FALLBACK: ProOfferConfig = Object.freeze({
  enabled: false,
  variantAllocationPct: 0,
  offeringId: 'winback_monthly',
  minAccountAgeDays: 45,
  minDismissalsPostFreemium: 2,
  minDismissalsTotal: 3,
  dismissalCooldownDays: 5,
  minActiveDays14: 3,
  purchaseStartedCooldownDays: 14,
  offerWindowDays: 14,
  maxImpressions: 3,
  impressionSpacingHours: 72,
  inboxEnabled: false,
  configVersion: 0,
});

/** A user's grant, as returned by `get_pro_offer_state()`. */
export interface ProOfferGrant {
  cohort: ProOfferCohort;
  status: ProOfferStatus;
  eligibleAt: string;
  expiresAt: string;
  lastShownAt: string | null;
  shownCount: number;
  configVersion: number;
}

/** The signals the six eligibility rules read. One row per candidate. */
export interface ProOfferSignals {
  ownerId: string;
  accountAgeDays: number;
  viewsTotal: number;
  dismissalsTotal: number;
  dismissalsPostFreemium: number;
  /** Null when they have never dismissed — which fails rule C anyway. */
  daysSinceLastDismissal: number | null;
  purchaseStartedCount: number;
  /** Null when they have never reached checkout. Rule F passes trivially. */
  daysSincePurchaseStarted: number | null;
  activeDays14: number;
  walks30d: number;
  isReviewBypass: boolean;
}

/** Why a candidate did not qualify. One per rule, for the dry-run funnel. */
export type IneligibleReason =
  | 'account_too_young'
  | 'too_few_post_freemium_dismissals'
  | 'too_few_total_dismissals'
  | 'dismissal_too_recent'
  | 'not_engaged_enough'
  | 'checkout_too_recent';

/** Why the win-back paywall is not being rendered to someone who has a grant. */
export type SuppressionReason =
  | 'config_disabled'
  | 'no_grant'
  | 'control_cohort'
  | 'window_closed'
  | 'impressions_exhausted'
  | 'too_soon_since_last_impression'
  | 'already_subscribed';

export interface EligibilityDecision {
  eligible: boolean;
  reasons: IneligibleReason[];
}

export interface DisplayDecision {
  show: boolean;
  reason: SuppressionReason | null;
  /** 1-based index of the impression this render would be. 0 when not showing. */
  impressionIndex: number;
  /** Whole days left in the window, floored at 0. For the expiry line. */
  daysLeftInWindow: number;
}

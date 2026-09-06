import type { SubscriptionStatus } from '../providers/SubscriptionProvider';
import {
  PROMO_PLAN_LABEL,
  PROMO_STATUS_LABEL,
  promoAccessDetail,
} from './creatorCode/copy';

/**
 * Four states, because they are four different conversations.
 *
 * `trial` used to collapse into `plus` — both were "subscribed", which is true
 * of the entitlement and useless to the person reading the card. Someone with a
 * trial running has a decision approaching; someone on a paid plan has already
 * made it. Rendering them identically meant the one state with a deadline was
 * the one state that never mentioned it.
 */
/**
 * Five states, because they are five different conversations.
 *
 * `trial` used to collapse into `plus` — both were "subscribed", which is true
 * of the entitlement and useless to the person reading the card. Someone with a
 * trial running has a decision approaching; someone on a paid plan has already
 * made it.
 *
 * `locked` is the more serious omission. SubscriptionProvider takes care to
 * tell a lapsed subscriber from one who never subscribed, and this function
 * then folded BOTH into `free` alongside a brand-new user in their welcome
 * period — so an account that had lost access read "Free plan · CURRENT",
 * word for word what someone currently enjoying everything sees. The one
 * moment the card had something urgent to say was the moment it said nothing.
 */
/**
 * `granted` is the sixth, and it exists because `isPro` used to mean exactly one
 * thing — a paid store subscription — and now means two.
 *
 * Someone holding a creator code, or a comped creator, is `isPro` with no
 * billing period, no renewal and nothing to manage. Folding them into `plus`
 * printed "N days in this billing period" over access that has no billing
 * period, under a "Manage" button that opens an empty App Store subscriptions
 * page. Both are small lies about money, which is the worst category of thing
 * for this card to be wrong about.
 */
export type ProfileMembershipTone =
  | 'loading'
  | 'free'
  | 'locked'
  | 'trial'
  | 'plus'
  | 'granted';

export interface ProfileMembershipPresentation {
  tone: ProfileMembershipTone;
  planLabel: string;
  statusLabel: string | null;
  detail: string;
  actionLabel: string | null;
  /**
   * Days remaining, surfaced separately from `detail` so the card can give it
   * its own weight rather than burying it mid-sentence. Null whenever there is
   * no deadline worth counting — which is every state except a running trial.
   */
  daysLeft: number | null;
}

interface ProfileMembershipInput {
  status: SubscriptionStatus;
  daysLeft: number | null;
  isPro: boolean;
  hasFullAccess: boolean;
  /** Access was granted (creator code, or a comp), not purchased. */
  isPromoAccess?: boolean;
  /** When granted access ends. Only read for the `granted` tone. */
  expiresAt?: Date | null;
}

function dayCount(days: number): string {
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * Honest, compact plan copy for Profile.
 *
 * `hasFullAccess` matters for non-subscribers because Pawtchi includes a
 * welcome period. Calling that person restricted, or asking them to unlock
 * something they can already use, would make the status card less trustworthy
 * than the absence it replaces.
 */
export function buildProfileMembershipPresentation({
  status,
  daysLeft,
  isPro,
  hasFullAccess,
  isPromoAccess = false,
  expiresAt = null,
}: ProfileMembershipInput): ProfileMembershipPresentation {
  if (status === 'loading') {
    return {
      tone: 'loading',
      planLabel: 'Membership',
      statusLabel: null,
      detail: 'Checking your current plan…',
      actionLabel: null,
      daysLeft: null,
    };
  }

  if (isPro) {
    // Checked before `trial` and `plus`, because both of those would otherwise
    // claim someone whose access was given rather than bought. Requires a
    // date — without one there is nothing honest to say about when it ends, so
    // it falls through to the ordinary paid copy rather than printing a blank.
    if (isPromoAccess && expiresAt) {
      return {
        tone: 'granted',
        planLabel: PROMO_PLAN_LABEL,
        statusLabel: PROMO_STATUS_LABEL,
        detail: promoAccessDetail(expiresAt),
        // Deliberately null. There is no store subscription behind this, so a
        // "Manage" button would open an empty App Store page — a dead end that
        // reads as a billing bug.
        actionLabel: null,
        // Unlike a paid plan, this one genuinely is a deadline. Counting down
        // to it is the honest thing, not a nudge toward cancelling.
        daysLeft: daysLeft != null && daysLeft > 0 ? daysLeft : null,
      };
    }

    if (status === 'trial') {
      const remaining = daysLeft != null && daysLeft > 0
        ? `${dayCount(daysLeft)} left in your trial · Full access`
        : 'Trial active · Full access';
      return {
        tone: 'trial',
        planLabel: 'Pawtchi Plus',
        statusLabel: 'TRIAL',
        detail: remaining,
        actionLabel: 'Manage',
        daysLeft: daysLeft != null && daysLeft > 0 ? daysLeft : null,
      };
    }

    return {
      tone: 'plus',
      planLabel: 'Pawtchi Plus',
      statusLabel: 'ACTIVE',
      detail: daysLeft != null && daysLeft > 0
        ? `${dayCount(daysLeft)} in this billing period · Full access`
        : 'Every personalised insight is unlocked',
      actionLabel: 'Manage',
      // Deliberately null on a paid plan. A renewal is not a deadline, and
      // counting down to one invites a cancellation nobody was considering.
      daysLeft: null,
    };
  }

  // Still has everything — the welcome period is running. Nothing has been
  // taken away, so nothing here should imply it has.
  if (hasFullAccess) {
    return {
      tone: 'free',
      planLabel: 'Free plan',
      statusLabel: 'CURRENT',
      detail: 'Full access is included during your welcome period',
      actionLabel: 'Explore Plus',
      daysLeft: null,
    };
  }

  // Gated. The two ways to arrive here are genuinely different situations and
  // deserve different sentences: one person is being asked to buy something
  // they have already lived with, the other something they have only read
  // about. Both are told plainly that access has ended, because they can see
  // that it has and a card that says "CURRENT" instead is not on their side.
  if (status === 'expired') {
    return {
      tone: 'locked',
      planLabel: 'Pawtchi Plus',
      statusLabel: 'ENDED',
      detail: 'Your Plus membership has ended — personalised guidance is paused',
      actionLabel: 'Renew Plus',
      daysLeft: null,
    };
  }

  return {
    tone: 'locked',
    planLabel: 'Free plan',
    statusLabel: 'LIMITED',
    detail: 'Your welcome period has ended — personalised guidance is paused',
    actionLabel: 'Explore Plus',
    daysLeft: null,
  };
}

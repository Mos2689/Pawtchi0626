import type { SubscriptionStatus } from '../providers/SubscriptionProvider';

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
export type ProfileMembershipTone =
  | 'loading'
  | 'free'
  | 'locked'
  | 'trial'
  | 'plus';

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

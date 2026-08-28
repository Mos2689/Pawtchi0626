// The eight questions worth answering before someone writes to us.
//
// Local TypeScript, not a CMS. At this stage a remote knowledge base would be
// infrastructure to maintain in exchange for the ability to fix a typo without
// a build — a trade that only becomes worthwhile once there are enough entries
// to search. Every entry carries a stable `id` so that when it does become
// worthwhile, swapping the source is one function and no analytics break.
//
// ── Two rules these entries follow ──────────────────────────────────────────
//
// 1. An FAQ must not discourage contact. Each answer ends by resolving the
//    question, never by implying the owner should have known. There is no
//    "was this helpful?" — a thumbs-down is a dead end dressed as a feature.
//
// 2. An entry that cannot apply must not be shown. `visibleWhen` filters by
//    species and feature flag, so a cat owner never reads about walks. This is
//    not a nicety: walks are dogs-only AND currently behind a disabled release
//    flag, so an unfiltered walk entry would be wrong for most owners today.

import { WALK_TRACKING_ENABLED } from '../../constants/features';

/** What the list knows about the owner when deciding what to show. */
export interface FaqContext {
  species?: string | null;
  /** useWalkEnabled(): the release flag AND a dog is the active pet. */
  walkEnabled: boolean;
}

/**
 * An action offered inline with an answer. The screen owns the handlers — this
 * stays a pure data module, so it can be tested and later served remotely.
 */
export type FaqActionId =
  | 'manage_subscription'
  | 'restore_purchases'
  | 'open_notifications'
  | 'open_profile';

export interface FaqEntry {
  /** Stable across re-ordering and re-wording. Analytics key. */
  id: string;
  question: string;
  answer: string;
  action?: { label: string; id: FaqActionId };
  visibleWhen?: (ctx: FaqContext) => boolean;
}

export const FAQS: readonly FaqEntry[] = [
  {
    id: 'cancel_subscription',
    question: 'How do I cancel or change my subscription?',
    answer:
      'Subscriptions are handled by the App Store or Google Play, not inside Pawtchi, so cancelling has to happen there. The button below opens the right screen on your device. Your data stays exactly as it is if you cancel.',
    action: { label: 'Open subscription settings', id: 'manage_subscription' },
  },
  {
    id: 'purchase_not_unlocked',
    question: 'I subscribed, but Pawtchi Plus is not unlocked',
    answer:
      'This is almost always a receipt that has not reached us yet, and restoring fixes it. Tap below to check your purchase again. If it still does not unlock, write to us and we will sort it out from our side.',
    action: { label: 'Restore purchases', id: 'restore_purchases' },
  },
  {
    id: 'calorie_target_changed',
    question: 'Why did the daily calorie target change?',
    answer:
      'The target is recalculated whenever something it depends on changes — a new weight, a body condition score, an age or breed correction, or a life-stage change like being desexed. A change usually means the plan just got more accurate. You can see what it was based on in the Health tab.',
  },
  {
    id: 'scan_accuracy',
    question: 'How accurate is the food scan?',
    answer:
      'The scan reads the label and compares it against the profile you have set up, which makes it a good guide rather than a measurement. Lighting and a clear view of the panel make a real difference. Where a number matters clinically, treat the packaging and your vet as the source of truth.',
  },
  {
    id: 'no_notifications',
    question: 'I am not getting notifications',
    answer:
      'There are two switches: permission at the device level, and the per-type settings inside Pawtchi. Quiet hours also hold reminders back until the morning. The screen below shows which of those is currently stopping them.',
    action: { label: 'Open notification settings', id: 'open_notifications' },
  },
  {
    id: 'not_a_vet',
    // The one answer that must never be softened to sound more capable.
    question: 'Can Pawtchi replace my vet?',
    answer:
      'No. Pawtchi helps you notice things and keep good records, and it can help you prepare for an appointment, but it does not diagnose and it cannot examine your animal. If something seems wrong, call your vet — bring the vet report from the Health tab with you.',
  },
  {
    id: 'delete_account',
    question: 'How do I delete my account and my data?',
    answer:
      'Delete account sits at the bottom of the Profile tab, and it removes your account, your animals and everything logged against them. It cannot be undone and it does not cancel a subscription, so cancel that first if you have one.',
    action: { label: 'Open Profile', id: 'open_profile' },
  },
  {
    id: 'where_are_walks',
    question: 'Where did tracked walks go?',
    answer:
      'Tracked walks are being rebuilt and are switched off in this version, so the walk screens are hidden rather than broken. Walks you log by hand still count towards activity and streaks as normal.',
    // Shown only where a walk surface would otherwise have been expected: a dog
    // profile. A cat owner has never seen a walk screen and should not be told
    // one is missing.
    visibleWhen: (ctx) => ctx.species === 'dog' && !WALK_TRACKING_ENABLED,
  },
];

/** The entries this owner should actually see, in order. */
export function visibleFaqs(ctx: FaqContext): FaqEntry[] {
  return FAQS.filter((f) => !f.visibleWhen || f.visibleWhen(ctx));
}

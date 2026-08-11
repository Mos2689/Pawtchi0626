/**
 * Email rules — decides *whether* an email is worth sending, and which one.
 *
 * Byte-mirrored to `supabase/functions/_shared/email/rules.ts`; the drift check
 * lives in `rules.test.ts`.
 *
 * ── How this differs from the push rules ────────────────────────────────────
 *
 * `lib/notifications/rules.ts` rations interruptions. This file rations
 * attention, which is a different problem with a different failure mode. A push
 * that arrives at the wrong moment is ignored; an email that arrives too often
 * gets the sender marked as spam, and a complaint rate above 0.3% costs the
 * channel for everybody, permanently. So the caps here are tighter than the
 * push ones and the bar for what counts as "worth it" is higher.
 *
 * The governing distinction: **push is an interruption for a time-bound action;
 * email is a document you keep.** Anything that still reads well an hour later
 * belongs here. Anything with a sub-hour window (a meal slot opening, a streak
 * about to lapse) belongs in push and is deliberately absent from this file —
 * see NEVER_EMAIL below, which exists so that absence is explicit rather than
 * an oversight somebody later "fixes".
 *
 * Keep this file import-free of anything but sibling pure modules, so both the
 * Expo bundler and the Deno edge runtime compile it and the mirror check can
 * compare raw bytes.
 */

import type { EmailCampaignKey, EmailCategory } from './copy';
import { EMAIL_CAMPAIGN_CATEGORY } from './copy';
import { isoWeek } from '../notifications/rules';

export interface EmailRuleInput {
  /** Owner-local hour, 0-23. Never a server clock. */
  localHour: number;
  /** Owner-local ISO weekday, 1 = Monday .. 7 = Sunday. */
  localWeekday: number;

  hasPet: boolean;
  /** Hours since the pet record was created. Drives the day-0 assessment. */
  hoursSincePetCreated: number | null;
  daysSinceSignup: number;

  /** Lifetime count. 0 means the owner has never logged anything. */
  totalLogs: number;
  daysSinceLastSession: number | null;

  /** Days the weight plan has been flagged as needing reassessment. */
  reassessmentDueDays: number | null;

  /** Set by the candidate query when the week has something to report. */
  digestEligible: boolean;

  /** Emails already sent to this owner in the trailing 7 days. */
  sentThisWeek: number;

  /** Campaigns already sent at least once, so once-ever rules stay once-ever. */
  alreadySent: readonly EmailCampaignKey[];
}

export interface EmailRuleMatch {
  campaign: EmailCampaignKey;
  /**
   * Window key for idempotency. Combined with the user id it becomes
   * `notification_history.dedupe_key`, so a campaign cannot fire twice for the
   * same window even if the dispatcher runs 48 times a day.
   */
  window: string;
}

/**
 * The hard ceiling, across every campaign in this file.
 *
 * Two is not a placeholder. Pawtchi has ~180 addresses and no consumer sending
 * history on the domain, so the first months of this channel are a reputation
 * build; a third weekly email buys marginal engagement against a real risk of
 * complaints. Transactional mail (`reply_fallback`) is exempt because it is not
 * a campaign — somebody wrote to us and is waiting.
 */
export const EMAIL_WEEKLY_CAP = 2;

/**
 * Campaigns that must never become emails, recorded so the absence is a
 * decision rather than a gap.
 *
 * `meal_window` and `streak_risk` have windows measured in minutes and hours;
 * an email cannot be timely enough and would arrive as a reproach for something
 * already missed. `hydration` is neither channel — it was 75% of every push
 * ever sent before the rebuild and is now an in-app nudge only.
 */
export const NEVER_EMAIL: readonly string[] = [
  'meal_window',
  'streak_risk',
  'hydration',
  'walk_insight',
];

/**
 * First match wins, highest value first. Returning at most one campaign per run
 * is itself a fatigue control: the dispatcher physically cannot stack two
 * emails on one owner in one pass.
 */
export function selectEmailCampaign(
  input: EmailRuleInput,
  todayISO: string,
): EmailRuleMatch | null {
  if (input.sentThisWeek >= EMAIL_WEEKLY_CAP) return null;

  const sent = (c: EmailCampaignKey) => input.alreadySent.includes(c);

  // ── Day zero: the assessment they have never read ─────────────────────────
  // Outranks everything. It is the one email that reaches every owner with a
  // pet regardless of whether they have logged anything, and it is the first
  // impression of the channel.
  //
  // The 30-minute floor lets the plan finish computing and keeps the email out
  // of the same minute as the onboarding reveal, where it would be redundant.
  // The 72-hour ceiling means a backfill or an outage cannot suddenly mail the
  // entire existing user base a "welcome" months late.
  if (
    input.hasPet &&
    !sent('reading') &&
    input.hoursSincePetCreated !== null &&
    input.hoursSincePetCreated >= 0.5 &&
    input.hoursSincePetCreated <= 72
  ) {
    return { campaign: 'reading', window: 'once' };
  }

  // ── Activation: nothing else matters until the first log exists ───────────
  // Twice, at day 2 and day 5, then never again. The window key encodes which
  // of the two it is, so the pair cannot become a drip.
  if (input.hasPet && input.totalLogs === 0 && input.localHour === 11) {
    if (input.daysSinceSignup >= 2 && input.daysSinceSignup <= 3 && !sent('first_log')) {
      return { campaign: 'first_log', window: 'a' };
    }
    if (input.daysSinceSignup >= 5 && input.daysSinceSignup <= 6) {
      return { campaign: 'first_log', window: 'b' };
    }
  }

  // ── The plan is decaying, and that is worth saying out loud ───────────────
  // The largest health-honest segment in the database. Daytime only: this asks
  // for a physical action (find the scales, weigh the dog) that nobody performs
  // at 21:00.
  if (
    input.reassessmentDueDays !== null &&
    input.reassessmentDueDays >= 7 &&
    input.localHour >= 9 &&
    input.localHour < 19
  ) {
    // The candidate query enforces the 21-day gap; the window key only has to
    // stop a second send inside one day.
    return { campaign: 'reassessment', window: todayISO };
  }

  // ── Earned summary, Sunday evening in the owner's own time ────────────────
  if (input.digestEligible && input.localWeekday === 7 && input.localHour === 18) {
    return { campaign: 'weekly_digest_email', window: isoWeek(todayISO) };
  }

  // ── Reactivation: one question, once, then we leave them alone ────────────
  // Deliberately not at 7 days — the push winback already owns that moment for
  // the minority who can receive it, and stacking both would be the same
  // message twice. This is also why there is no "we miss you" variant: the ask
  // is a question about their animal, which is answerable and useful, rather
  // than an appeal on the app's behalf.
  if (
    input.hasPet &&
    input.totalLogs > 0 &&
    !sent('open_question') &&
    input.daysSinceLastSession !== null &&
    input.daysSinceLastSession >= 14 &&
    input.daysSinceLastSession < 30 &&
    input.localHour === 10
  ) {
    return { campaign: 'open_question', window: 'once' };
  }

  return null;
}

// ── Category gating ─────────────────────────────────────────────────────────

export interface EmailPreferences {
  email_enabled: boolean;
  cat_email_lifecycle: boolean;
  cat_email_digest: boolean;
  cat_email_insights: boolean;
  cat_email_walk: boolean;
}

/**
 * Whether an owner's preferences permit a campaign.
 *
 * `direct` bypasses both the category flags and the master switch, and that is
 * intentional: `email_enabled = false` means "stop sending me campaigns", not
 * "withhold the reply to the letter I wrote you". This is the same carve-out
 * the push pipeline makes for `founder_reply`, and it is why RFC 8058 exempts
 * transactional mail from one-click unsubscribe.
 */
export function isEmailAllowed(
  campaign: EmailCampaignKey,
  prefs: EmailPreferences,
): boolean {
  const category: EmailCategory = EMAIL_CAMPAIGN_CATEGORY[campaign];
  if (category === 'direct') return true;
  if (!prefs.email_enabled) return false;

  switch (category) {
    case 'lifecycle': return prefs.cat_email_lifecycle;
    case 'digest': return prefs.cat_email_digest;
    case 'insights': return prefs.cat_email_insights;
    case 'walk': return prefs.cat_email_walk;
  }
}

/**
 * Cross-channel anti-duplication.
 *
 * Several moments legitimately exist on both channels — a plan reassessment is
 * a push nudge *and* an email that explains why it matters. What must not
 * happen is both arriving about the same event within a few hours, which reads
 * as one message sent twice rather than two channels doing different jobs.
 *
 * Push wins the tie when it is available, because it is the more perishable of
 * the two and the owner who can receive it is by definition already reachable.
 */
export const CROSS_CHANNEL_PAIRS: Record<string, string> = {
  reassessment: 'weigh_in_due',
  first_log: 'first_log_prompt',
  weekly_digest_email: 'weekly_recap',
};

export const CROSS_CHANNEL_SUPPRESSION_HOURS = 24;

export function isSuppressedByPush(
  campaign: EmailCampaignKey,
  hoursSinceMatchingPush: number | null,
): boolean {
  if (!(campaign in CROSS_CHANNEL_PAIRS)) return false;
  if (hoursSinceMatchingPush === null) return false;
  return hoursSinceMatchingPush < CROSS_CHANNEL_SUPPRESSION_HOURS;
}

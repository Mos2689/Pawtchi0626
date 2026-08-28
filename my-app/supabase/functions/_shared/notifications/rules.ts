/**
 * Notification rules — decides *whether* a push is worth sending, and which.
 *
 * Byte-mirrored to `supabase/functions/_shared/notifications/rules.ts`; the
 * mirror check lives in `rules.test.ts`.
 *
 * Relationship to `lib/nudgeEngine.ts`: that engine decides what card to show
 * an owner who has already opened the app, so it fires on almost every session
 * by design. A push has a much higher bar — it interrupts someone. These rules
 * are deliberately a small, high-signal subset, and several of them exist
 * precisely to fix what the old dispatcher got wrong:
 *
 *   - The retired `pet-reminders` sent `nudge_water` to anyone whose logged
 *     water was under 30% of a target it computed as `weight * 50` inline. That
 *     is true for nearly every user on nearly every day, which is how one rule
 *     came to be 75% of all notifications ever sent (1,014 of 1,353). Hydration
 *     is now an in-app nudge only — it is real information, but it is not worth
 *     a daily interruption, and the target must come from lib/hydration.ts.
 *   - Every threshold here is evaluated against the owner's *local* hour. The
 *     old dispatcher used `getUTCHours() + 5` with a comment claiming AEST,
 *     which is UTC+10/+11.
 *
 * Keep this file import-free so both runtimes compile it and the mirror check
 * can compare raw bytes. Anything needing a shared calculation (water targets,
 * calorie maths) is passed in already computed by the caller, which reads it
 * from the single source on its own side.
 */

import type { CampaignKey } from './copy.ts';

export interface RuleInput {
  /** Owner-local hour, 0-23. Never a server clock. */
  localHour: number;
  /** Owner-local ISO weekday, 1 = Monday .. 7 = Sunday. */
  localWeekday: number;

  hasPet: boolean;
  daysSinceSignup: number;

  /** Lifetime count. 0 means the owner has never logged anything. */
  totalLogs: number;
  daysSinceLastLog: number | null;
  daysSinceLastSession: number | null;

  /** Today, as a fraction of the pet's calorie target. */
  calPercent: number;
  /** Count of the last three days that came in under 70% of target. */
  daysUnderTarget: number;

  hasWeightGoal: boolean;
  goalDirection: 'lose' | 'maintain' | 'gain' | null;
  daysSinceLastWeighIn: number | null;

  /** Minutes until the next unlogged feeding slot; null when none is pending. */
  minutesToNextMeal: number | null;
  nextMealLabel: string | null;
  /** Owner's configured lead time, from owner_preferences.nudge_lead_minutes. */
  leadMinutes: number;

  currentStreakDays: number;
  loggedToday: boolean;

  /** Set when an event fired since the last dispatch run. */
  pendingMilestone: boolean;
  pendingWalksign: boolean;
  pendingVetCheckin: boolean;

  /** Populated only on the weekly-recap pass. */
  weekMealsLogged: number;
  weekWalksLogged: number;
}

export interface RuleMatch {
  campaign: CampaignKey;
  /**
   * Window key for idempotency. Combined with the user id it becomes
   * `notification_history.dedupe_key`, so a campaign can never fire twice for
   * the same window even if the dispatcher runs 96 times a day.
   */
  window: string;
}

/**
 * First match wins, highest value first. Returning at most one campaign per
 * run is itself a fatigue control: the dispatcher physically cannot stack
 * three pushes on one owner in one pass.
 */
export function selectCampaign(input: RuleInput, todayISO: string): RuleMatch | null {
  // ── Event-driven, earned moments ──────────────────────────────────────────
  // These are rare, always relevant, and represent the emotional peaks of the
  // product. They outrank every reminder.
  if (input.pendingMilestone) {
    return { campaign: 'milestone', window: todayISO };
  }
  if (input.pendingWalksign) {
    return { campaign: 'walksign_confirmed', window: todayISO };
  }
  if (input.pendingVetCheckin && input.localHour >= 9 && input.localHour < 20) {
    return { campaign: 'vet_checkin', window: todayISO };
  }

  // ── Activation: nothing else matters until the first log exists ───────────
  if (!input.hasPet) {
    if (input.daysSinceSignup >= 1 && input.daysSinceSignup <= 4 && input.localHour === 10) {
      return { campaign: 'onboarding_incomplete', window: `${todayISO}:${input.daysSinceSignup}` };
    }
    return null;
  }

  if (input.totalLogs === 0 && input.daysSinceSignup >= 1 && input.daysSinceSignup <= 3) {
    // Aim at the meal window when we know it, otherwise late morning.
    const atMealWindow =
      input.minutesToNextMeal !== null && input.minutesToNextMeal <= 60 && input.minutesToNextMeal > 0;
    if (atMealWindow || input.localHour === 11) {
      return { campaign: 'first_log_prompt', window: todayISO };
    }
    return null;
  }

  // ── The core habit loop ───────────────────────────────────────────────────
  if (
    input.minutesToNextMeal !== null &&
    input.minutesToNextMeal > 0 &&
    input.minutesToNextMeal <= input.leadMinutes
  ) {
    return { campaign: 'meal_window', window: `${todayISO}:${input.nextMealLabel ?? 'meal'}` };
  }

  // ── Health signals worth an interruption ──────────────────────────────────
  // Chronic under-eating is clinically meaningful (hepatic lipidosis risk in
  // cats, over-aggressive loss plans in dogs). Mirrors nudgeEngine P4.5.
  if (input.daysUnderTarget >= 2 && input.calPercent < 60 && input.localHour === 18) {
    return { campaign: 'plan_drift', window: isoWeek(todayISO) };
  }

  // A plan running on a three-week-old weight is not catching problems.
  // Mirrors nudgeEngine P1.5 thresholds exactly.
  if (
    input.hasWeightGoal &&
    input.daysSinceLastWeighIn !== null &&
    input.localWeekday === 6 &&
    input.localHour === 9 &&
    ((input.goalDirection === 'lose' && input.daysSinceLastWeighIn >= 14) ||
      (input.goalDirection === 'gain' && input.daysSinceLastWeighIn >= 14) ||
      (input.goalDirection === 'maintain' && input.daysSinceLastWeighIn >= 28))
  ) {
    return { campaign: 'weigh_in_due', window: isoWeek(todayISO) };
  }

  // ── Streak protection, only for owners who actually have a streak ─────────
  if (input.currentStreakDays >= 3 && !input.loggedToday && input.localHour === 20) {
    return { campaign: 'streak_risk', window: isoWeek(todayISO) };
  }

  // ── Earned summary. Suppressed when there is nothing to report ────────────
  if (
    input.localWeekday === 7 &&
    input.localHour === 18 &&
    input.weekMealsLogged >= 3
  ) {
    return { campaign: 'weekly_recap', window: isoWeek(todayISO) };
  }

  // ── Reactivation, twice, then we leave them alone ─────────────────────────
  if (
    input.daysSinceLastSession !== null &&
    input.totalLogs > 0 &&
    input.localHour === 10
  ) {
    if (input.daysSinceLastSession >= 7 && input.daysSinceLastSession < 14) {
      return { campaign: 'winback_7d', window: 'winback_7d' };
    }
    if (input.daysSinceLastSession >= 30 && input.daysSinceLastSession < 45) {
      return { campaign: 'winback_30d', window: 'winback_30d' };
    }
  }

  return null;
}

/** ISO year-week key, e.g. 2026-W32. Weekly campaigns dedupe on this. */
export function isoWeek(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// ── Quiet hours + frequency caps ────────────────────────────────────────────

export type NotificationIntensity = 'minimal' | 'standard' | 'chatty';

export interface FrequencyCap {
  perDay: number;
  perWeek: number;
}

export const INTENSITY_CAPS: Record<NotificationIntensity, FrequencyCap> = {
  // Care reminders only, at most one a week.
  minimal: { perDay: 1, perWeek: 1 },
  standard: { perDay: 1, perWeek: 4 },
  chatty: { perDay: 2, perWeek: 10 },
};

/** Campaigns a `minimal` owner still receives. Everything else is suppressed. */
export const MINIMAL_ALLOWED: readonly CampaignKey[] = [
  'meal_window',
  'vet_checkin',
  'milestone',
  // Transactional. `minimal` means "stop nudging me", not "withhold the reply
  // to the letter I wrote you".
  'founder_reply',
];

export function isAllowedForIntensity(
  campaign: CampaignKey,
  intensity: NotificationIntensity,
): boolean {
  if (intensity === 'minimal') return MINIMAL_ALLOWED.includes(campaign);
  return true;
}

/**
 * Quiet-hours test in the owner's local minutes-since-midnight. Handles the
 * midnight-wrapping window (22:00 → 07:00) that every real configuration uses.
 *
 * Same semantics as lib/notificationScheduler.ts:fallsInQuietWindow, so the
 * local and remote paths agree on what "quiet" means.
 */
export function fallsInQuietWindow(
  localMinutes: number,
  quietStart: string | null,
  quietEnd: string | null,
): boolean {
  if (!quietStart || !quietEnd) return false;
  const start = parseMinutes(quietStart);
  const end = parseMinutes(quietEnd);
  if (start === end) return false;
  if (start < end) return localMinutes >= start && localMinutes < end;
  return localMinutes >= start || localMinutes < end;
}

export function parseMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Milestones are the one thing worth holding rather than dropping — an owner
 * should still hear their dog hit a weight stage, just not at 03:00.
 */
export const DEFERRABLE_THROUGH_QUIET: readonly CampaignKey[] = [
  'milestone',
  'walksign_confirmed',
  // Held, never dropped. The reply stays unsent in the database until the
  // window closes, so it goes out on the next run rather than being lost to a
  // quiet period the owner set for meal reminders.
  'founder_reply',
  // A walk that ends at 22:30 would otherwise never get its insight, because
  // the owner's quiet window opens before the dispatcher next runs. Held, so it
  // arrives in the morning — the candidate lookback is 10 hours precisely to
  // cover an overnight window, and the per-walk dedupe key makes that safe.
  'walk_insight',
];

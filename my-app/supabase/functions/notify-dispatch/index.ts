/**
 * notify-dispatch — the single notification engine.
 *
 * Replaces `pet-reminders`, which existed only as a deployed artifact in the
 * Supabase dashboard (no repo copy, no review, no tests) and had drifted far
 * enough from the app that it was pushing a developer test string to real
 * owners. Everything decision-shaped here comes from
 * `_shared/notifications/rules.ts` and `copy.ts`, which are mechanically
 * mirrored from `lib/notifications/` and unit-tested in the app test suite.
 *
 * Guarantees:
 *   - Cron-only. Fail-closed secret check before any work happens.
 *   - At most one push per user per run (the rule engine returns one campaign).
 *   - Quiet hours, intensity, category opt-outs and frequency caps are all
 *     evaluated in the owner's own timezone.
 *   - Idempotent: `dedupe_key` is unique, so a double-invocation cannot double
 *     -send. The ledger row is written BEFORE the push leaves.
 *   - Every Expo ticket is persisted so `notify-receipts` can prove delivery.
 */

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
import {
  CRON_SECRET_HEADER,
  isAuthorisedCronRequest,
  unauthorised,
} from '../_shared/notifications/cronAuth.ts';
import {
  sendPushBatch,
  isPermanentTokenFailure,
  type ExpoMessage,
} from '../_shared/notifications/expo.ts';
import {
  CAMPAIGN_CATEGORY,
  renderCopy,
  type CampaignKey,
  type NotificationCategory,
  type PetSex,
  type WalkInsightKind,
} from '../_shared/notifications/copy.ts';
import { selectWalkInsight } from '../_shared/notifications/walkInsights.ts';
import {
  DEFERRABLE_THROUGH_QUIET,
  INTENSITY_CAPS,
  fallsInQuietWindow,
  isAllowedForIntensity,
  selectCampaign,
  type NotificationIntensity,
  type RuleInput,
} from '../_shared/notifications/rules.ts';

/**
 * Where the support inbox digest is sent.
 *
 * A default in code rather than a required env var, because this is a business
 * address and not a credential — nothing is exposed by it being here, and an
 * unset env var would otherwise mean support requests pile up silently with
 * nobody told. `SUPPORT_INBOX_EMAIL` still overrides it, so the address can be
 * changed from the dashboard without a redeploy.
 *
 * Note this is the RECIPIENT. The sender is `Pawtchi <hello@pawtchi.com>`,
 * fixed in send-email, so Resend only needs pawtchi.com verified — the
 * recipient domain needs nothing.
 */
const SUPPORT_INBOX = Deno.env.get('SUPPORT_INBOX_EMAIL') ?? 'admin@heylivingclub.com';

/** One row of get_founder_reply_pushes() — a reply that is owed a push. */
interface FounderReplyPush {
  user_id: string;
  letter_id: string;
  reply_id: string;
  tokens: string[];
  timezone: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

/** One row of get_support_reply_pushes(). Same shape, different entity. */
interface SupportReplyPush {
  user_id: string;
  ticket_id: string;
  reply_id: string;
  tokens: string[];
  timezone: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
}

/**
 * One row of get_walk_insight_candidates(): a valid walk that ended recently
 * and has not been notified. All the history arithmetic is done in SQL — the
 * comparisons are all "versus this pet's own past", and doing them per
 * candidate over the wire would be the N+1 pattern that made the retired
 * pet-reminders function take 40 seconds at 34 tokens.
 */
interface WalkInsightCandidate {
  owner_id: string;
  pet_id: string;
  pet_name: string | null;
  pet_gender: string | null;
  walk_id: string;
  walk_ended_at: string;
  timezone: string | null;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  notification_intensity: string;
  tokens: string[];
  sent_today: number;
  sent_this_week: number;
  sniff_count: number;
  longest_pause_seconds: number;
  new_street_count: number;
  /** Null means there is not enough history to make a "longest in N days" claim. */
  days_since_longer_walk: number | null;
  rising_weeks: number;
  route_repeats_this_week: number;
  /** Previously sent insight kinds, newest first. Feeds the novelty guard. */
  recent_kinds: string[];
}

/** One row of get_unnotified_support_tickets() — for the team's digest email. */
interface UnnotifiedTicket {
  id: string;
  topic: string;
  area: string;
  body_preview: string;
  owner_email: string | null;
  app_version: string | null;
  platform: string | null;
  has_attachment: boolean;
  created_at: string;
}

/**
 * Just enough of the Supabase client for the digest helpers.
 *
 * Structural, not nominal, for the same reason cronAuth.ts uses one: the client
 * is constructed from a different specifier here than in send-email, and
 * `ReturnType<typeof createClient>` resolves to the un-parameterised
 * `SupabaseClient<unknown, never, ...>`, which the real `<any, 'public', any>`
 * instance is not assignable to. Describing the two calls we actually make
 * sidesteps the mismatch entirely.
 */
interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

/** One row of get_unnotified_founder_letters(). */
interface UnnotifiedLetter {
  id: string;
  body_preview: string;
  owner_email: string | null;
  entry_source: string | null;
  app_version: string | null;
  created_at: string;
}

interface Candidate {
  user_id: string;
  timezone: string | null;
  tokens: string[];
  pet_id: string | null;
  pet_name: string | null;
  pet_sex: string | null;
  days_since_signup: number;
  push_enabled: boolean;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  nudge_lead_minutes: number;
  notification_intensity: string;
  cat_care_reminders: boolean;
  cat_health_insights: boolean;
  cat_milestones: boolean;
  cat_digest: boolean;
  cat_lifecycle: boolean;
  /**
   * Optional: the candidate query does not select it, because walk_insight is
   * delivered by its own event-driven pass which filters on cat_walk in SQL.
   * Declared so the exhaustive switch in categoryEnabled() can name it — that
   * switch falling through returns undefined, which reads as "category off"
   * and would drop a message while looking like a deliberate opt-out.
   */
  cat_walk?: boolean;
  total_logs: number;
  days_since_last_log: number | null;
  days_since_last_session: number | null;
  cal_percent: number;
  days_under_target: number;
  logged_today: boolean;
  current_streak_days: number;
  has_weight_goal: boolean;
  goal_direction: 'lose' | 'maintain' | 'gain' | null;
  days_since_last_weigh_in: number | null;
  next_meal_time: string | null;
  next_meal_label: string | null;
  week_meals_logged: number;
  week_walks_logged: number;
  pending_milestone_id: string | null;
  pending_walksign_key: string | null;
  pending_vet_checkin: string | null;
  sent_today: number;
  sent_this_week: number;
}

/**
 * Fallback when we do not yet know an owner's timezone.
 *
 * `profiles.timezone` is populated by the app at token registration, so until
 * that release is in people's hands it is null for every existing user (16 of
 * 16 at deploy time). Falling back to UTC would fire a "10:00" campaign at
 * roughly 20:00 for an Australian owner — the same class of error as the
 * retired dispatcher's `getUTCHours() + 5`, just in the other direction.
 *
 * Australia/Sydney is the right guess for this user base, and it is a guess:
 * `profiles.timezone` stays null so "unknown" is never confused with "known".
 * Override per-project with the DEFAULT_TIMEZONE secret.
 */
const FALLBACK_TIMEZONE = Deno.env.get('DEFAULT_TIMEZONE') ?? 'Australia/Sydney';

/**
 * The owner's wall-clock time. Never a server clock: the retired dispatcher
 * used `getUTCHours() + 5` with a comment claiming AEST, which is UTC+10/+11.
 */
function localClock(timezone: string | null): { hour: number; minutes: number; weekday: number; dateISO: string } {
  const zone = timezone || FALLBACK_TIMEZONE;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
    }).formatToParts(new Date());
  } catch {
    // A malformed IANA string from a device. Retry once against UTC; if even
    // that throws, fall through to a UTC-derived value rather than recursing.
    // Passing 'UTC' explicitly is safe: `zone` is then truthy and the guard
    // below is false, so this terminates after exactly one retry.
    if (zone !== 'UTC') return localClock('UTC');
    const now = new Date();
    return {
      hour: now.getUTCHours(),
      minutes: now.getUTCHours() * 60 + now.getUTCMinutes(),
      weekday: now.getUTCDay() === 0 ? 7 : now.getUTCDay(),
      dateISO: now.toISOString().slice(0, 10),
    };
  }

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  const minute = Number(get('minute'));
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  return {
    hour,
    minutes: hour * 60 + minute,
    weekday: weekdayMap[get('weekday')] ?? 1,
    dateISO: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** Minutes from now until a HH:MM:SS slot today, in the owner's timezone. */
function minutesUntil(slot: string | null, nowMinutes: number): number | null {
  if (!slot) return null;
  const [h, m] = slot.split(':').map(Number);
  if (Number.isNaN(h)) return null;
  return (h || 0) * 60 + (m || 0) - nowMinutes;
}

function categoryEnabled(c: Candidate, category: NotificationCategory): boolean {
  switch (category) {
    case 'care_reminders': return c.cat_care_reminders;
    case 'health_insights': return c.cat_health_insights;
    case 'milestones': return c.cat_milestones;
    case 'digest': return c.cat_digest;
    case 'lifecycle': return c.cat_lifecycle;
    // Unreachable from selectCampaign() today — walk_insight is delivered by
    // its own event-driven pass, which reads cat_walk in SQL. Present anyway
    // because without it the switch falls through and returns undefined, which
    // reads as "category off" and would drop the message while looking like a
    // deliberate opt-out. Same trap as 'direct' below.
    case 'walk': return c.cat_walk ?? true;
    // Transactional, and deliberately not user-mutable: a reply to something
    // someone personally wrote is not a campaign they can unsubscribe from
    // (see CAMPAIGN_CATEGORY in copy.ts). Unreachable today — the direct
    // campaigns are delivered by their own event-driven passes and never go
    // through selectCampaign() — but without this the switch falls through and
    // returns undefined, which reads as "category off" and would silently drop
    // the message while looking like a deliberate opt-out.
    case 'direct': return true;
  }
}

function toIntensity(value: string): NotificationIntensity {
  return value === 'minimal' || value === 'chatty' ? value : 'standard';
}

serve(async (req: Request) => {
  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  if (!(await isAuthorisedCronRequest(req, admin))) {
    return unauthorised();
  }

  const skipped: Record<string, number> = {};
  const note = (reason: string) => { skipped[reason] = (skipped[reason] ?? 0) + 1; };

  try {
    const { data: candidates, error } = await admin.rpc('get_notification_candidates');
    if (error) throw error;

    const rows = (candidates ?? []) as Candidate[];

    // Flattened out of `Candidate` so the rule-driven pass and the founder-reply
    // pass below can share one claim / send / receipt path. The reply pass has
    // no candidate row to carry — its owners may not be rule-eligible at all.
    interface Plan {
      userId: string;
      petId: string | null;
      campaign: CampaignKey;
      dedupeKey: string;
      message: ExpoMessage;
      /** Set only on vet_checkin, consumed after a successful claim. */
      checkinId?: string | null;
      /**
       * Set on founder_reply and support_reply, stamped after Expo accepts the
       * ticket. `replyKind` says which table to stamp — the two live in
       * different tables and must never be stamped through the wrong RPC, or a
       * reply would be marked delivered while its owner never hears about it.
       */
      replyId?: string;
      replyKind?: 'founder' | 'support';
      /**
       * Written to `notification_history.variant`. Defaults to 'a' for every
       * single-string campaign; walk_insight sets the insight kind, because
       * get_walk_insight_candidates reads this column back as `recent_kinds` to
       * drive the novelty guard. Leaving it 'a' would make every walk look like
       * the same shape and the guard would suppress everything after the first.
       */
      variant?: string;
    }

    const planned: Plan[] = [];

    for (const c of rows) {
      const clock = localClock(c.timezone);
      const intensity = toIntensity(c.notification_intensity);

      const ruleInput: RuleInput = {
        localHour: clock.hour,
        localWeekday: clock.weekday,
        hasPet: Boolean(c.pet_id),
        daysSinceSignup: c.days_since_signup,
        totalLogs: c.total_logs,
        daysSinceLastLog: c.days_since_last_log,
        daysSinceLastSession: c.days_since_last_session,
        calPercent: c.cal_percent,
        daysUnderTarget: c.days_under_target,
        hasWeightGoal: c.has_weight_goal,
        goalDirection: c.goal_direction,
        daysSinceLastWeighIn: c.days_since_last_weigh_in,
        minutesToNextMeal: minutesUntil(c.next_meal_time, clock.minutes),
        nextMealLabel: c.next_meal_label,
        leadMinutes: c.nudge_lead_minutes,
        currentStreakDays: c.current_streak_days,
        loggedToday: c.logged_today,
        pendingMilestone: Boolean(c.pending_milestone_id),
        pendingWalksign: Boolean(c.pending_walksign_key),
        pendingVetCheckin: Boolean(c.pending_vet_checkin),
        weekMealsLogged: c.week_meals_logged,
        weekWalksLogged: c.week_walks_logged,
      };

      const match = selectCampaign(ruleInput, clock.dateISO);
      if (!match) continue;

      // ── Eligibility gate ──────────────────────────────────────────────────
      if (!isAllowedForIntensity(match.campaign, intensity)) { note('intensity'); continue; }
      if (!categoryEnabled(c, CAMPAIGN_CATEGORY[match.campaign])) { note('category_off'); continue; }

      // Suppress rather than shift. A reminder that fires at the wrong time is
      // worse than no reminder — the same rule the local scheduler follows.
      // Milestones are held instead of dropped: their dedupe key is the
      // milestone id and the candidate query looks back 24 hours, so the same
      // celebration goes out on the next run after quiet hours end.
      if (fallsInQuietWindow(clock.minutes, c.quiet_hours_start, c.quiet_hours_end)) {
        note(DEFERRABLE_THROUGH_QUIET.includes(match.campaign) ? 'quiet_hours_held' : 'quiet_hours');
        continue;
      }

      const caps = INTENSITY_CAPS[intensity];
      if (c.sent_today >= caps.perDay) { note('daily_cap'); continue; }
      if (c.sent_this_week >= caps.perWeek) { note('weekly_cap'); continue; }

      // A campaign that names an animal is not worth sending without one.
      const petName = (c.pet_name ?? '').trim();
      if (!petName && match.campaign !== 'onboarding_incomplete') { note('no_pet_name'); continue; }

      const copy = renderCopy(match.campaign, {
        petName,
        petSex: (c.pet_sex as PetSex) ?? null,
        minutes: ruleInput.minutesToNextMeal ?? undefined,
        mealLabel: c.next_meal_label ?? undefined,
        days: c.days_since_last_weigh_in ?? undefined,
        streakDays: c.current_streak_days,
        mealsLogged: c.week_meals_logged,
        walksLogged: c.week_walks_logged,
      });

      // Event-driven campaigns key on the entity, not the date, so a wide
      // lookback window can never produce a second send for the same event.
      const entityKey =
        match.campaign === 'milestone' ? c.pending_milestone_id
        : match.campaign === 'walksign_confirmed' ? c.pending_walksign_key
        : match.campaign === 'vet_checkin' ? c.pending_vet_checkin
        : null;
      const dedupeKey = `${c.user_id}:${match.campaign}:${entityKey ?? match.window}`;

      planned.push({
        userId: c.user_id,
        petId: c.pet_id,
        campaign: match.campaign,
        dedupeKey,
        checkinId: c.pending_vet_checkin,
        message: {
          // Newest token first (get_notification_candidates orders by
          // last_seen_at), so a reinstalled device wins over a stale one.
          to: c.tokens[0],
          title: copy.title,
          body: copy.body,
          sound: 'default',
          channelId: 'default',
          data: {
            type: match.campaign,
            campaignKey: match.campaign,
            dedupeKey,
            entityId: c.pending_vet_checkin ?? c.pet_id ?? null,
            variant: 'a',
          },
        },
      });
    }

    // ── Founder replies ───────────────────────────────────────────────────────
    // A second, event-driven pass rather than a rule. Someone owed a reply to a
    // letter they personally wrote may not be in the candidate set at all — no
    // pet, gone quiet, already at their daily cap — and none of that should
    // stand between them and an answer they are waiting for.
    //
    // For the same reason this pass deliberately skips the intensity and
    // frequency caps: those exist to ration nudges we initiate, and this is not
    // one. Quiet hours still apply, and hold rather than drop, because the row
    // stays unsent in the database until the window closes.
    const { data: replyRows, error: replyError } = await admin.rpc('get_founder_reply_pushes');
    if (replyError) {
      // A failure here must not take the whole dispatch run down with it.
      console.error('[notify-dispatch] get_founder_reply_pushes:', replyError.message);
    }

    for (const r of (replyRows ?? []) as FounderReplyPush[]) {
      if (!r.tokens?.length) continue;

      const clock = localClock(r.timezone);
      if (fallsInQuietWindow(clock.minutes, r.quiet_hours_start, r.quiet_hours_end)) {
        note('quiet_hours_held');
        continue;
      }

      const copy = renderCopy('founder_reply', {});
      const dedupeKey = `${r.user_id}:founder_reply:${r.reply_id}`;
      const route = `/letter/${r.letter_id}?from=push`;

      planned.push({
        userId: r.user_id,
        petId: null,
        campaign: 'founder_reply',
        dedupeKey,
        replyId: r.reply_id,
        replyKind: 'founder',
        message: {
          to: r.tokens[0],
          title: copy.title,
          body: copy.body,
          sound: 'default',
          channelId: 'default',
          data: {
            type: 'founder_reply',
            campaignKey: 'founder_reply',
            dedupeKey,
            // Explicit route: landing on the letter list instead of the reply
            // would waste the one moment this notification exists for.
            route,
            entityId: r.letter_id,
            variant: 'a',
          },
        },
      });
    }

    // ── Support replies ───────────────────────────────────────────────────────
    // The same event-driven pass, for the structured channel. Identical
    // reasoning: an owner waiting on an answer to a bug they reported may be
    // nowhere near rule-eligible, and rationing this would be rationing the
    // thing they are actually waiting for.
    const { data: supportRows, error: supportError } =
      await admin.rpc('get_support_reply_pushes');
    if (supportError) {
      console.error('[notify-dispatch] get_support_reply_pushes:', supportError.message);
    }

    for (const r of (supportRows ?? []) as SupportReplyPush[]) {
      if (!r.tokens?.length) continue;

      const clock = localClock(r.timezone);
      if (fallsInQuietWindow(clock.minutes, r.quiet_hours_start, r.quiet_hours_end)) {
        note('quiet_hours_held');
        continue;
      }

      const copy = renderCopy('support_reply', {});
      const dedupeKey = `${r.user_id}:support_reply:${r.reply_id}`;
      const route = `/support/${r.ticket_id}?from=push`;

      planned.push({
        userId: r.user_id,
        petId: null,
        campaign: 'support_reply',
        dedupeKey,
        replyId: r.reply_id,
        replyKind: 'support',
        message: {
          to: r.tokens[0],
          title: copy.title,
          body: copy.body,
          sound: 'default',
          channelId: 'default',
          data: {
            type: 'support_reply',
            campaignKey: 'support_reply',
            dedupeKey,
            route,
            entityId: r.ticket_id,
            variant: 'a',
          },
        },
      });
    }

    // ── Post-walk insights ────────────────────────────────────────────────────
    // A third event-driven pass. Unlike the reply passes above this IS a nudge
    // we initiate, so intensity, quiet hours and the frequency caps all apply.
    //
    // Why after the walk and never before it: a dog owner already walks their
    // dog. The behaviour is not ours to create, and the moment before a walk —
    // leash, door, dog spinning — cannot be won by a notification. The moment
    // after can, because the phone is already in hand.
    //
    // The candidate query has already filtered on push_enabled, cat_walk, a live
    // token, and "no insight sent for this walk". What is left here is the
    // decision, which belongs to the mirrored engine so the app and the server
    // can never disagree about what counts as interesting.
    const { data: walkRows, error: walkError } =
      await admin.rpc('get_walk_insight_candidates');
    if (walkError) {
      console.error('[notify-dispatch] get_walk_insight_candidates:', walkError.message);
    }

    for (const w of (walkRows ?? []) as WalkInsightCandidate[]) {
      if (!w.tokens?.length) continue;

      const clock = localClock(w.timezone);
      const intensity = toIntensity(w.notification_intensity);

      // `minimal` means "stop nudging me". An observation about a walk is
      // exactly the kind of thing that setting is for.
      if (!isAllowedForIntensity('walk_insight', intensity)) { note('intensity'); continue; }

      // Held, not dropped: walk_insight is in DEFERRABLE_THROUGH_QUIET and the
      // candidate lookback is 10 hours, so a walk that ends inside the quiet
      // window goes out when it closes rather than being lost.
      if (fallsInQuietWindow(clock.minutes, w.quiet_hours_start, w.quiet_hours_end)) {
        note('quiet_hours_held');
        continue;
      }

      const caps = INTENSITY_CAPS[intensity];
      if (w.sent_today >= caps.perDay) { note('daily_cap'); continue; }
      if (w.sent_this_week >= caps.perWeek) { note('weekly_cap'); continue; }

      const petName = (w.pet_name ?? '').trim();
      if (!petName) { note('no_pet_name'); continue; }

      const match = selectWalkInsight({
        sniffCount: w.sniff_count,
        longestPauseSeconds: w.longest_pause_seconds,
        newStreetCount: w.new_street_count,
        daysSinceLongerWalk: w.days_since_longer_walk,
        risingWeeks: w.rising_weeks,
        routeRepeatsThisWeek: w.route_repeats_this_week,
        recentKinds: (w.recent_kinds ?? []) as WalkInsightKind[],
      });

      // The most important branch in this pass. A lap of the block with nothing
      // notable about it earns no interruption, and no ledger row either — the
      // walk stays eligible in case a later run has something to say about it.
      if (!match) { note('walk_not_notable'); continue; }

      const copy = renderCopy('walk_insight', {
        petName,
        petSex: (w.pet_gender as PetSex) ?? null,
        insightKind: match.kind,
        sniffCount: match.sniffCount,
        pauseMinutes: match.pauseMinutes,
        days: match.days,
        trendWeeks: match.trendWeeks,
        repeatCount: match.repeatCount,
      });

      // Keyed on the walk, not the day: the exact string the candidate query
      // checks. Two walks on one day can each earn their own insight, and no
      // walk can ever be notified twice.
      const dedupeKey = `walk_insight:${w.walk_id}`;

      planned.push({
        userId: w.owner_id,
        petId: w.pet_id,
        campaign: 'walk_insight',
        dedupeKey,
        variant: match.kind,
        message: {
          to: w.tokens[0],
          title: copy.title,
          body: copy.body,
          sound: 'default',
          channelId: 'default',
          data: {
            type: 'walk_insight',
            campaignKey: 'walk_insight',
            dedupeKey,
            entityId: w.walk_id,
            variant: match.kind,
          },
        },
      });
    }

    // ── Tell the team what came in ───────────────────────────────────────────
    // Runs before the early return below, because an inbox digest must go out
    // even on a run where nothing is owed a push. This is the one pass whose
    // failure a person is waiting on at the other end.
    const cronSecret = req.headers.get(CRON_SECRET_HEADER);
    await notifySupportInbox(admin, cronSecret, note);
    await notifyLetterInbox(admin, cronSecret, note);
    await notifyCalorieIntegrity(admin, cronSecret, note);

    if (planned.length === 0) {
      return json({ ok: true, candidates: rows.length, planned: 0, sent: 0, skipped });
    }

    // ── Claim before sending ─────────────────────────────────────────────────
    // The ledger row goes in first. The unique index on dedupe_key means a
    // concurrent or repeated run loses the race and sends nothing, rather than
    // double-pushing. Rows that lose the race are dropped from this batch.
    const claimRows = planned.map((p) => ({
      user_id: p.userId,
      pet_id: p.petId,
      event_type: p.campaign,
      campaign_key: p.campaign,
      variant: p.variant ?? 'a',
      channel: 'push',
      sent_at: new Date().toISOString(),
      push_token: p.message.to,
      dedupe_key: p.dedupeKey,
    }));

    const { data: claimed, error: claimError } = await admin
      .from('notification_history')
      .upsert(claimRows, { onConflict: 'dedupe_key', ignoreDuplicates: true })
      .select('id, dedupe_key');
    if (claimError) throw claimError;

    const claimedRows = (claimed ?? []) as { id: string; dedupe_key: string }[];
    const claimedKeys = new Set<string>(claimedRows.map((r) => r.dedupe_key));
    const idByKey = new Map<string, string>(claimedRows.map((r) => [r.dedupe_key, r.id]));
    const toSend = planned.filter((p) => claimedKeys.has(p.dedupeKey));
    if (planned.length > toSend.length) {
      skipped.already_sent = planned.length - toSend.length;
    }

    // Consume vet check-ins only for cases we actually claimed. The retired
    // vet-checkins function marked every due case as sent before knowing
    // whether a push existed, which would have eaten the backlog silently.
    const checkinIds = toSend
      .filter((p) => p.campaign === 'vet_checkin' && p.checkinId)
      .map((p) => p.checkinId as string);
    if (checkinIds.length > 0) {
      const { error: consumeError } = await admin.rpc('consume_vet_checkins', { p_ids: checkinIds });
      if (consumeError) console.error('[notify-dispatch] consume_vet_checkins:', consumeError.message);
    }

    const outcomes = await sendPushBatch(toSend.map((p) => p.message));

    // ── Record what Expo said ────────────────────────────────────────────────
    let accepted = 0;
    // Expo returns DeviceNotRegistered at SEND time, inside the ticket, not
    // only later in the receipt:
    //   {"data":[{"status":"error","details":{"error":"DeviceNotRegistered"}}]}
    // Handling it only in notify-receipts would leave those tokens live, and
    // they would be retried on every run forever — the same dead-token
    // accumulation this rebuild exists to stop.
    const deadTokens = new Set<string>();
    const deliveredReplyIds: string[] = [];
    const deliveredSupportReplyIds: string[] = [];

    await Promise.all(
      outcomes.map(async (outcome, i) => {
        const plan = toSend[i];
        const rowId = idByKey.get(plan.dedupeKey);
        if (!rowId) return;

        if (outcome.ticket?.status === 'ok' && outcome.ticket.id) {
          accepted++;
          // Only stamp a reply as pushed once Expo has taken it. A rejected
          // ticket leaves push_sent_at NULL so the next run tries again —
          // silently swallowing someone's reply is the one failure mode this
          // feature cannot afford.
          if (plan.replyId) {
            if (plan.replyKind === 'support') deliveredSupportReplyIds.push(plan.replyId);
            else deliveredReplyIds.push(plan.replyId);
          }
          await admin.from('notification_history')
            .update({ expo_ticket_id: outcome.ticket.id })
            .eq('id', rowId);
          return;
        }

        // Rejected at send time. Record it so the row is not left looking like
        // a successful send forever, which is precisely how the old pipeline
        // hid four months of total failure.
        const errorCode = outcome.ticket?.details?.error;
        if (isPermanentTokenFailure(errorCode)) {
          deadTokens.add(plan.message.to);
        }

        const reason =
          outcome.transportError ??
          errorCode ??
          outcome.ticket?.message ??
          'unknown_send_failure';
        await admin.from('notification_history')
          .update({ receipt_status: 'error', receipt_error: reason, receipt_checked_at: new Date().toISOString() })
          .eq('id', rowId);
      }),
    );

    if (deliveredReplyIds.length > 0) {
      const { error: stampError } = await admin
        .rpc('mark_founder_replies_pushed', { p_ids: deliveredReplyIds });
      if (stampError) {
        // Worst case this re-sends one reply on the next run. Preferable to the
        // alternative, where a stamp that ran before a failed send loses it.
        console.error('[notify-dispatch] mark_founder_replies_pushed:', stampError.message);
      }
    }

    if (deliveredSupportReplyIds.length > 0) {
      const { error: stampError } = await admin
        .rpc('mark_support_replies_pushed', { p_ids: deliveredSupportReplyIds });
      if (stampError) {
        console.error('[notify-dispatch] mark_support_replies_pushed:', stampError.message);
      }
    }

    if (deadTokens.size > 0) {
      const { error: disableError } = await admin
        .from('push_tokens')
        .update({ disabled_at: new Date().toISOString(), disabled_reason: 'DeviceNotRegistered' })
        .in('token', [...deadTokens])
        .is('disabled_at', null);
      if (disableError) {
        console.error('[notify-dispatch] could not disable tokens:', disableError.message);
      }
    }

    return json({
      ok: true,
      candidates: rows.length,
      planned: planned.length,
      sent: toSend.length,
      accepted,
      skipped,
    });
  } catch (e) {
    const detail = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
    console.error('[notify-dispatch]', detail);
    return json({ ok: false, error: 'dispatch_failed' }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Escape user-authored text before it goes into the digest's HTML. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Email the team about support requests they have not been told about yet.
 *
 * ── Why this lives in the dispatcher ────────────────────────────────────────
 *
 * A dedicated `notify-support-inbox` function would mean a second cron entry, a
 * second deploy target and a second place for delivery logic to drift. The
 * August 2026 audit's finding was that a forked notification path is how a
 * pipeline fails silently for four months, so the rule since has been one
 * dispatcher. This is a pass, not a fork.
 *
 * ── Why one digest rather than one email per ticket ─────────────────────────
 *
 * Batching is genuinely nicer to receive, and it means a busy hour produces one
 * notification rather than twenty. The ticket rows are stamped only after the
 * send is accepted, so a failure leaves them queued for the next run instead of
 * dropping them.
 *
 * Fails soft in every direction: no recipient configured, no secret to forward,
 * a rejected send — each returns quietly and leaves the rows unstamped. This is
 * a convenience layer over the Table Editor, and it must never be able to take
 * a dispatch run down with it.
 */
async function notifySupportInbox(
  admin: RpcClient,
  cronSecret: string | null,
  note: (reason: string) => void,
): Promise<void> {
  if (!SUPPORT_INBOX || !cronSecret) return;

  try {
    const { data, error } = await admin.rpc('get_unnotified_support_tickets');
    if (error) {
      console.error('[notify-dispatch] get_unnotified_support_tickets:', error.message);
      return;
    }

    const tickets = (data ?? []) as UnnotifiedTicket[];
    if (tickets.length === 0) return;

    const bugs = tickets.filter((t) => t.topic === 'bug').length;
    const subject =
      tickets.length === 1
        ? `Pawtchi support: 1 new ${tickets[0].topic}`
        : `Pawtchi support: ${tickets.length} new (${bugs} bug${bugs === 1 ? '' : 's'})`;

    const rows = tickets
      .map((t) => {
        const meta = [t.area, t.app_version, t.platform, t.has_attachment ? 'screenshot' : null]
          .filter(Boolean)
          .map((m) => esc(String(m)))
          .join(' · ');
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #E8EAF2;">
              <div style="font:600 13px system-ui;color:#1447f1;">
                ${esc(t.topic.toUpperCase())} — ${meta}
              </div>
              <div style="font:400 15px/1.5 system-ui;color:#0f172a;margin:4px 0;">
                ${esc(t.body_preview)}
              </div>
              <div style="font:400 12px system-ui;color:#64748b;">
                ${esc(t.owner_email ?? 'no email on file')} · ${esc(t.id)}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    const html = `
      <div style="max-width:560px;margin:0 auto;padding:24px;">
        <h1 style="font:700 20px system-ui;color:#07202A;margin:0 0 4px;">${esc(subject)}</h1>
        <p style="font:400 14px/1.5 system-ui;color:#64748b;margin:0 0 16px;">
          Reply by inserting a row into support_ticket_replies with the ticket id.
          The owner gets a push and reads it in the app.
        </p>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>`;

    if (!(await sendTeamDigest(subject, html, cronSecret))) {
      note('support_digest_failed');
      return;
    }

    const { error: stampError } = await admin.rpc('mark_support_tickets_notified', {
      p_ids: tickets.map((t) => t.id),
    });
    if (stampError) {
      // Worst case the next digest repeats these. Preferable to stamping first
      // and losing a request nobody ever hears about.
      console.error('[notify-dispatch] mark_support_tickets_notified:', stampError.message);
    }
  } catch (e) {
    console.error('[notify-dispatch] support digest:', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Post a digest to the team inbox.
 *
 * send-email only permits a non-self recipient for a cron-authorised caller, so
 * the dispatcher forwards the secret it was itself called with. No new secret,
 * and no widening of send-email's recipient rule.
 */
async function sendTeamDigest(
  subject: string,
  html: string,
  cronSecret: string,
): Promise<boolean> {
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/send-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [CRON_SECRET_HEADER]: cronSecret,
      Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
    },
    body: JSON.stringify({ to: SUPPORT_INBOX, subject, html }),
  });

  if (!res.ok) {
    console.error('[notify-dispatch] team digest send failed:', res.status);
    return false;
  }
  return true;
}

/**
 * Tell the team a letter arrived.
 *
 * Founder letters had no inbound notification from the day they shipped: a
 * letter landed in a table and stayed there until somebody thought to look.
 * That silently broke the promise printed on the letter screen — "We read every
 * letter that comes through here" — and it broke it worst for the cancel-intent
 * letters, which are the most useful thing anyone ever sends us.
 *
 * Sent as a SEPARATE email from the support digest, on purpose. The two
 * channels exist to feel different; collapsing them into one "you have 4 items"
 * message would put a bug report and someone explaining why they are leaving in
 * the same list, which is exactly the flattening the whole design avoids.
 */
async function notifyLetterInbox(
  admin: RpcClient,
  cronSecret: string | null,
  note: (reason: string) => void,
): Promise<void> {
  if (!SUPPORT_INBOX || !cronSecret) return;

  try {
    const { data, error } = await admin.rpc('get_unnotified_founder_letters');
    if (error) {
      console.error('[notify-dispatch] get_unnotified_founder_letters:', error.message);
      return;
    }

    const letters = (data ?? []) as UnnotifiedLetter[];
    if (letters.length === 0) return;

    const leaving = letters.filter((l) => l.entry_source === 'cancel_intent').length;
    const subject =
      letters.length === 1
        ? leaving === 1
          ? 'Pawtchi: a letter from someone leaving'
          : 'Pawtchi: a new letter'
        : `Pawtchi: ${letters.length} new letters${leaving > 0 ? ` (${leaving} leaving)` : ''}`;

    const rows = letters
      .map((l) => {
        const flag =
          l.entry_source === 'cancel_intent'
            ? '<span style="background:#FEF3C7;color:#92400E;font:700 11px system-ui;padding:2px 6px;border-radius:4px;">WRITTEN WHILE LEAVING</span> '
            : '';
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #E8EAF2;">
              <div style="margin-bottom:4px;">${flag}</div>
              <div style="font:400 15px/1.6 system-ui;color:#0f172a;">${esc(l.body_preview)}</div>
              <div style="font:400 12px system-ui;color:#64748b;margin-top:4px;">
                ${esc(l.owner_email ?? 'no email on file')} · ${esc(l.id)}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    const html = `
      <div style="max-width:560px;margin:0 auto;padding:24px;">
        <h1 style="font:700 20px system-ui;color:#07202A;margin:0 0 4px;">${esc(subject)}</h1>
        <p style="font:400 14px/1.5 system-ui;color:#64748b;margin:0 0 16px;">
          These are addressed to you personally. Answer as yourselves, not as support —
          and letters get one reply, so it is worth taking the time.
        </p>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>`;

    if (!(await sendTeamDigest(subject, html, cronSecret))) {
      note('letter_digest_failed');
      return;
    }

    const { error: stampError } = await admin.rpc('mark_founder_letters_notified', {
      p_ids: letters.map((l) => l.id),
    });
    if (stampError) {
      console.error('[notify-dispatch] mark_founder_letters_notified:', stampError.message);
    }
  } catch (e) {
    console.error('[notify-dispatch] letter digest:', e instanceof Error ? e.message : String(e));
  }
}

/** One row of get_calorie_integrity_digest(). */
interface CalorieIntegrityFinding {
  check_name: string;
  entity_key: string;
  severity: string;
  pet_name: string | null;
  summary: string;
  details: Record<string, unknown> | null;
  is_new: boolean;
}

const INTEGRITY_CHECK_LABEL: Record<string, string> = {
  aggregate_drift: 'Daily total disagrees with its meals',
  implausible_day: 'Impossible daily total',
  implausible_meal: 'Impossible single meal',
  label_inconsistent: 'Label figures contradict each other',
};

/**
 * Tell the team when the calorie pipeline produces something impossible.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * A gram-unit bug logged a 200 g meal as 24,000 kcal. It sat in production for
 * four days across three separate logs, and we found out because the owner
 * wrote in. Nothing watched. Every one of the checks behind
 * `audit_calorie_integrity()` would have caught it the same day.
 *
 * ── Why it reports and does not fix ─────────────────────────────────────────
 *
 * This is stage 2 of the integrity plan and it is deliberately inert. The
 * enforcement thresholds it will eventually feed have to be chosen from
 * observed false-positive rates, and you cannot observe those while also
 * blocking on them. So: measure first, enforce later, and never the reverse.
 *
 * Findings are deduped by a cooldown rather than a one-shot watermark, because
 * a problem that is still true a week later deserves one reminder — but not one
 * every run, which is how a digest becomes something people filter away.
 *
 * Fails soft in every direction, exactly like the support and letter passes: a
 * missing recipient, a missing secret or a rejected send each return quietly
 * and leave the findings unstamped for the next run. Monitoring must never be
 * able to take a dispatch run down with it.
 */
async function notifyCalorieIntegrity(
  admin: RpcClient,
  cronSecret: string | null,
  note: (reason: string) => void,
): Promise<void> {
  if (!SUPPORT_INBOX || !cronSecret) return;

  try {
    const { data, error } = await admin.rpc('get_calorie_integrity_digest');
    if (error) {
      // Expected until the migration is deployed — this pass is additive and
      // must not make an otherwise healthy run look broken.
      console.error('[notify-dispatch] get_calorie_integrity_digest:', error.message);
      return;
    }

    const findings = (data ?? []) as CalorieIntegrityFinding[];
    if (findings.length === 0) return;

    const critical = findings.filter((f) => f.severity === 'critical').length;
    const fresh = findings.filter((f) => f.is_new).length;
    const subject =
      critical > 0
        ? `Pawtchi calories: ${findings.length} integrity finding${findings.length === 1 ? '' : 's'} (${critical} critical)`
        : `Pawtchi calories: ${findings.length} integrity finding${findings.length === 1 ? '' : 's'}`;

    const rows = findings
      .map((f) => {
        const label = INTEGRITY_CHECK_LABEL[f.check_name] ?? f.check_name;
        const badge =
          f.severity === 'critical'
            ? '<span style="background:#FEE2E2;color:#991B1B;font:700 11px system-ui;padding:2px 6px;border-radius:4px;">CRITICAL</span> '
            : f.is_new
            ? '<span style="background:#FEF3C7;color:#92400E;font:700 11px system-ui;padding:2px 6px;border-radius:4px;">NEW</span> '
            : '';
        return `
          <tr>
            <td style="padding:12px 0;border-bottom:1px solid #E8EAF2;">
              <div style="font:600 13px system-ui;color:#1447f1;">
                ${badge}${esc(label)}
              </div>
              <div style="font:400 15px/1.5 system-ui;color:#0f172a;margin:4px 0;">
                ${esc(f.summary)}
              </div>
              <div style="font:400 12px system-ui;color:#64748b;">
                ${esc(f.check_name)} · ${esc(f.entity_key)}
              </div>
            </td>
          </tr>`;
      })
      .join('');

    const html = `
      <div style="max-width:560px;margin:0 auto;padding:24px;">
        <h1 style="font:700 20px system-ui;color:#07202A;margin:0 0 4px;">${esc(subject)}</h1>
        <p style="font:400 14px/1.5 system-ui;color:#64748b;margin:0 0 16px;">
          Report only — nothing was blocked or changed. ${fresh} of these are new since
          the last digest. Small "daily total disagrees" deltas can be a timezone
          artefact until scans carry their own log date; large ones cannot.
        </p>
        <table style="width:100%;border-collapse:collapse;">${rows}</table>
      </div>`;

    if (!(await sendTeamDigest(subject, html, cronSecret))) {
      note('calorie_integrity_digest_failed');
      return;
    }

    const { error: stampError } = await admin.rpc('mark_calorie_integrity_reported', {
      p_check_names: findings.map((f) => f.check_name),
      p_entity_keys: findings.map((f) => f.entity_key),
    });
    if (stampError) {
      // Worst case the next run repeats these. Preferable to stamping first and
      // losing a finding nobody ever hears about.
      console.error('[notify-dispatch] mark_calorie_integrity_reported:', stampError.message);
    }
  } catch (e) {
    console.error(
      '[notify-dispatch] calorie integrity digest:',
      e instanceof Error ? e.message : String(e),
    );
  }
}

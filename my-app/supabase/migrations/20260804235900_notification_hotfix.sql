-- Notification hotfix — safe to apply on its own, ahead of the rebuild.
--
-- This file exists so the actively harmful sends can stop today without
-- waiting on an app release or the dispatcher cutover. It touches data only,
-- and is independent of the three migrations that follow it.

-- ── 1. Stop pushing a developer test string to real owners ──────────────────
-- The live pet-reminders function renders copy from a TEMPLATES map that has
-- no 'hydration' key, so `getMessageForEvent('hydration', ...)` falls through
-- to TEMPLATES['test']:
--
--     "Testing, testing! 1, 2, 3 Dad!"
--     "Hey Dad! This is a test notification from my brain!"
--
-- notification_history records 170 of these across 3 owners, the most recent
-- dated today. There is no hydration template to fall back to and hydration
-- does not warrant a push at all (see below), so the schedule is retired.
UPDATE public.schedules
   SET is_active = FALSE
 WHERE event_type = 'hydration'
   AND is_active IS TRUE;

-- ── 2. Quarantine malformed push tokens ─────────────────────────────────────
-- Seven rows in push_tokens are JavaScript error strings that an older client
-- build stored as tokens ("Error: Error: No \"projectId\" found...", 153-385
-- chars). The client bug is already fixed in hooks/usePushNotifications.ts,
-- which now returns null instead of the thrown message, but the rows survived
-- and are still pushed to on every run.
--
-- Deleted rather than flagged here because 20260805000000 has not necessarily
-- run yet, so disabled_at may not exist. These rows carry no information worth
-- keeping — they are not tokens.
DELETE FROM public.push_tokens
 WHERE token NOT LIKE 'ExponentPushToken%';

-- ── 3. Optional: cap the water firehose before the cutover ──────────────────
-- nudge_water is 1,014 of 1,353 lifetime notifications (75%). It fires from
-- `waterPercent < 0.3 && hour >= 12` against a target the retired function
-- computes inline as weight*50 — a condition true for nearly every owner on
-- nearly every day, and one that disagrees with the ring shown in the app
-- (lib/hydration.ts scales the target by diet moisture).
--
-- pet-reminders skips its whole nudge branch when any 'nudge_%' row already
-- exists for the owner today. Seeding one suppresses the nudge firehose while
-- leaving the schedule-driven meal and walk reminders untouched, because those
-- run through a different branch.
--
-- ONLY NEEDED IF the notify-dispatch cutover is going to slip more than a day
-- or two — the cutover removes the rule entirely. Uncomment to enable, and
-- remember to unschedule it after cutover.
--
-- SELECT cron.schedule(
--   'suppress-legacy-nudges',
--   '1 0 * * *',
--   $$
--   INSERT INTO public.notification_history (user_id, event_type, sent_date, channel)
--   SELECT DISTINCT pt.user_id, 'nudge_suppressed_pending_cutover', CURRENT_DATE, 'internal'
--     FROM public.push_tokens pt
--    WHERE pt.token LIKE 'ExponentPushToken%';
--   $$
-- );

-- ── 4. Still outstanding after this file ────────────────────────────────────
-- pet-reminders is deployed with verify_jwt: false, has no secret check, and
-- honours `{ test_mode: true, user_id: "<uuid>" }` by firing five consecutive
-- pushes at whichever user id the caller names. Anyone who knows the URL can
-- push to any user. That cannot be closed from SQL — it needs the function
-- deleted or redeployed, which 20260805000002 handles by unscheduling it and
-- cutting over to notify-dispatch.

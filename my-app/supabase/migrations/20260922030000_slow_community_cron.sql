-- Retire the community notification cron. It was too fast for this database,
-- and on reflection it should not exist at all.
--
-- ── What happened ───────────────────────────────────────────────────────────
--
-- 20260922000000 scheduled `notify-dispatch-community` at `* * * * *` — every
-- minute — because the ask was near-instant trail invitations. On a t4g.nano
-- (2 burstable vCPU, 512 MB) that is not a cadence, it is a load test.
--
-- Postgres logs from 22 Sep show the shape of it: cron job 24 starting and
-- completing every single minute, checkpoints taking 8.5 seconds to write 83
-- buffers, and PostgREST repeatedly logging "Warp server error: Thread killed
-- by timeout manager". Database, PostgREST, Auth and Storage all reported
-- Unhealthy together, the SQL editor could not obtain a connection, and
-- ordinary app queries — fetchPet, fetchStreak, useRecentWalks, none of them
-- anything to do with Trails — timed out at 12 and 15 seconds.
--
-- Each run took longer than the sixty seconds until the next one, so they
-- stacked without bound until the connection pool was gone. That is the actual
-- mechanism: not steady overload, unbounded concurrency.
--
-- ── The compounding mistake ─────────────────────────────────────────────────
--
-- The cron posts `{"mode":"community"}` so the dispatcher runs only the
-- community pass. A deployed function that does not yet KNOW about that mode
-- ignores the body and runs the whole thing: the rule engine, the candidate
-- scan, founder replies, support replies, walk insights and the team digests.
-- So the schedule was written assuming a deploy that the schedule itself did
-- not wait for, and the failure mode of getting that order wrong is the full
-- dispatcher every sixty seconds.
--
-- A cron must be safe at the cadence it runs with the code currently DEPLOYED,
-- not with the code you intend to deploy. This one was not.
--
-- ── Why it is not simply slowed down ────────────────────────────────────────
--
-- The first version of this migration rescheduled it to */5. That would have
-- worked, and it would still have been the wrong shape: 288 calls a day asking
-- a queue whether anything had arrived, when the queue is written by triggers
-- that know the instant something does.
--
-- 20260922050000 puts a trigger on community_notification_events that posts to
-- notify-dispatch the moment a row lands — sub-second latency, and nothing at
-- all when nobody is using Together. So the community lane is removed here
-- rather than rescheduled.
--
-- `notify-dispatch` stays on */15 and keeps doing everything, which also makes
-- it the reaper if the trigger's post is ever lost.
--
-- ── The reminder sweep drops to */15 ────────────────────────────────────────
--
-- It stays on a clock because it has to: a walk approaching its start time is
-- the absence of a write, so there is nothing to trigger on. But it is pure
-- SQL with no HTTP call, and it only has to notice a walk inside a 30-minute
-- window, so running it every five minutes was precision nobody could perceive.

SELECT cron.unschedule('notify-dispatch-community')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-dispatch-community');

SELECT cron.unschedule('community-walk-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-walk-reminders');
SELECT cron.schedule(
  'community-walk-reminders',
  '*/15 * * * *',
  $cron$SELECT public.sweep_community_walk_reminders();$cron$
);

-- Stop the background jobs firing in the same minute (perf Train 1).
--
-- At :00 and :30 every hour, four or five jobs started together:
-- notify-dispatch (*/15), community-walk-reminders (*/15), notify-email-dispatch
-- (*/30), notify-receipts (*/30) and cleanup-rate-limits (hourly). The notify
-- jobs call edge functions, which call back into PostgREST with service-role
-- RPCs (get_notification_candidates averaged 862 ms, get_email_candidates
-- 600 ms). They share the same ~10 API connections the app uses, so every half
-- hour users queued behind a burst of background work.
--
-- Every job keeps its frequency; only the minute moves.
--   * notify-dispatch rules key on the local HOUR (`localHour === 11/18`) and
--     on lead windows re-evaluated every run; the dedupe key prevents repeats.
--     Four runs per hour remain, so every hour-keyed rule still gets its runs.
--   * community-walk-reminders use a 30-minute window ("a quarter-hour of
--     jitter still lands it", 20260922000000).
--   * notify-email-dispatch keys on the local hour plus a dedupe key.
--   * receipts and cleanup have no timing semantics.
-- notify-dispatch-community stays deleted (nano rule, 20260922000000).
-- Rollback: supabase/rollbacks/20261002020000_stagger_cron_jobs.down.sql

DO $$
DECLARE
  j RECORD;
BEGIN
  FOR j IN
    SELECT jobid, jobname FROM cron.job
     WHERE jobname IN ('notify-dispatch', 'community-walk-reminders',
                       'notify-email-dispatch', 'notify-receipts',
                       'cleanup-rate-limits')
  LOOP
    PERFORM cron.alter_job(
      j.jobid,
      schedule := CASE j.jobname
        WHEN 'notify-dispatch'          THEN '2,17,32,47 * * * *'
        WHEN 'community-walk-reminders' THEN '6,21,36,51 * * * *'
        WHEN 'notify-email-dispatch'    THEN '9,39 * * * *'
        WHEN 'notify-receipts'          THEN '12,42 * * * *'
        WHEN 'cleanup-rate-limits'      THEN '53 * * * *'
      END
    );
  END LOOP;
END
$$;

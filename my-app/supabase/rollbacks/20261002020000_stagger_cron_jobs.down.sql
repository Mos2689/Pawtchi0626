-- Undo 20261002020000_stagger_cron_jobs.sql: restore the schedules as they
-- were on 2026-10-01. Run in the SQL editor.
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
        WHEN 'notify-dispatch'          THEN '*/15 * * * *'
        WHEN 'community-walk-reminders' THEN '*/15 * * * *'
        WHEN 'notify-email-dispatch'    THEN '*/30 * * * *'
        WHEN 'notify-receipts'          THEN '*/30 * * * *'
        WHEN 'cleanup-rate-limits'      THEN '0 * * * *'
      END
    );
  END LOOP;
END
$$;

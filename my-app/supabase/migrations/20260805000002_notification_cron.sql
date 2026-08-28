-- Notification cron — repair and cutover.
--
-- What was wrong (verified against the live project, Aug 2026):
--
-- 1. Authorization. Both notification cron jobs sent
--       'Authorization: Bearer sb_publishable_...'
--    a publishable key, not a JWT, to functions deployed with verify_jwt: true.
--    Edge logs show a 401 on every run for both, going back months:
--       POST | 401 | .../check-reminders   2026-08-04 18:00 UTC
--       POST | 401 | .../vet-checkins      2026-08-04 17:00 UTC
--
-- 2. Observability. `cron.job_run_details` reported "succeeded" throughout,
--    because that only records that net.http_post was queued. The real status
--    lives in net._http_response, where every row read:
--       status_code: NULL, error_msg: "Timeout of 5000 ms reached"
--    pg_net's default timeout is 5 s and the dispatcher took 6-40 s, so the
--    response — including the 401 — was discarded before it could be recorded.
--    Raising the timeout is what makes the alerting in Part 6 possible at all.
--
-- 3. Secret handling. The key was pasted into the cron command in clear text,
--    where it is readable by anyone who can select from cron.job. The secret
--    now lives in Vault and is interpolated at call time.

-- ── Retire the broken jobs ──────────────────────────────────────────────────
-- unschedule() throws if the job is absent, so guard each one.
DO $$
DECLARE
  -- Named v_job, not job: a bare `job` is ambiguous against the cron.job table
  -- inside the EXISTS below and raises 42702.
  v_job TEXT;
BEGIN
  FOREACH v_job IN ARRAY ARRAY[
    'invoke-pet-reminders',   -- superseded by notify-dispatch
    'daily-reminder-check',   -- check-reminders: 401 since inception, retired
    'vet-checkins-daily',     -- folded into notify-dispatch
    'weekly-pet-emails'       -- run_weekly_summaries: 401 since inception, retired
  ] LOOP
    IF EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;
  END LOOP;
END;
$$;

-- ── The dispatcher ──────────────────────────────────────────────────────────
-- Every 15 minutes. The rule engine gates on the owner's local hour, so a
-- frequent tick is what makes per-timezone timing possible; it does not mean
-- frequent notifications (one campaign per user per run, then the caps apply).
SELECT cron.schedule(
  'notify-dispatch',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/notify-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- ── Receipts ────────────────────────────────────────────────────────────────
-- Expo keeps receipts about 24 hours; every 30 minutes resolves them well
-- inside that window without hammering the API.
SELECT cron.schedule(
  'notify-receipts',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/notify-receipts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- ── Weekly recap email ──────────────────────────────────────────────────────
-- Sunday 18:00 UTC. Gated on three or more logged days and the cat_digest
-- preference, so it reaches owners who have something to recap rather than the
-- 165 the retired run_weekly_summaries() looped over unconditionally.
SELECT cron.schedule(
  'notify-weekly-digest',
  '0 18 * * 0',
  $$
  SELECT net.http_post(
    url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/notify-weekly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- ── Monitoring ──────────────────────────────────────────────────────────────
-- Daily at 08:00 UTC. This is the job whose absence let a total outage run for
-- months. Its detection query, run against production before any of these
-- migrations were applied, returns 98 failed cron runs in 24 hours.
SELECT cron.schedule(
  'notify-monitor',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/notify-monitor',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
  $$
);

-- ── Health check ────────────────────────────────────────────────────────────
-- The audit's core failure was that nothing was watching. This view answers
-- "did the notification cron actually work?" in one query, and is what the
-- alerting should poll. Note the status_code IS NULL case — that is the exact
-- signature of the timeout that hid the 401s for months.
CREATE OR REPLACE VIEW public.notification_cron_health AS
  SELECT
    j.jobname,
    r.start_time,
    r.status                                   AS queue_status,
    resp.status_code                           AS http_status,
    resp.error_msg,
    CASE
      WHEN resp.status_code BETWEEN 200 AND 299 THEN 'ok'
      WHEN resp.status_code IS NULL AND resp.error_msg IS NOT NULL THEN 'no_response'
      WHEN resp.status_code IS NULL THEN 'pending'
      ELSE 'http_error'
    END                                        AS verdict
  FROM cron.job j
  JOIN cron.job_run_details r ON r.jobid = j.jobid
  LEFT JOIN net._http_response resp
    ON resp.id = NULLIF(regexp_replace(COALESCE(r.return_message, ''), '\D', '', 'g'), '')::BIGINT
  WHERE j.jobname IN ('notify-dispatch', 'notify-receipts')
    AND r.start_time > NOW() - INTERVAL '7 days'
  ORDER BY r.start_time DESC;

REVOKE ALL ON public.notification_cron_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_cron_health TO service_role;

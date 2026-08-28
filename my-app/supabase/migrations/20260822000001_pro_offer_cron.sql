-- Schedules pro-offer-sweep.
--
-- Same shape as notify-dispatch (20260805000002): the secret is read from Vault
-- at call time rather than pasted into cron.command in clear text, and the
-- pg_net timeout is set explicitly. Both of those are lessons from the August
-- 2026 audit, where two cron jobs 401'd on every run for months while
-- cron.job_run_details cheerfully reported "succeeded" — because that view only
-- records that net.http_post was queued, and the real 401 was discarded when
-- pg_net's default 5 s timeout fired first.
--
-- ── Why every six hours ─────────────────────────────────────────────────────
--
-- Eligibility is measured in days, not minutes. The tightest input is
-- `days_since_last_dismissal >= 5`; a six-hour tick resolves that to well
-- inside a day, which is far finer than the rule needs. Running it more often
-- would just be a full scan of auth.users for no additional grants.
--
-- Offset to :07 so it does not contend with the notification dispatcher on the
-- quarter hour.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobname = 'pro-offer-sweep') THEN
    PERFORM cron.unschedule('pro-offer-sweep');
  END IF;
END;
$$;

SELECT cron.schedule(
  'pro-offer-sweep',
  '7 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/pro-offer-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    -- Well above the sweep's expected runtime, and above pg_net's 5 s default,
    -- so a non-200 is actually recorded in net._http_response instead of being
    -- thrown away as a timeout.
    timeout_milliseconds := 25000
  );
  $$
);

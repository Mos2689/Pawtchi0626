-- Correlate cron runs to their HTTP responses, properly.
--
-- Bug this fixes (found while verifying the cutover): the first version of
-- notification_cron_health joined cron runs to net._http_response with
--
--   resp.id = regexp_replace(r.return_message, '\D', '', 'g')::BIGINT
--
-- on the assumption that `return_message` carries the pg_net request id. It
-- does not — for `SELECT net.http_post(...)` it is the row count, literally
-- "1 row", so the expression always evaluated to 1 and the join never matched
-- the real response.
--
-- The consequence was worse than a broken dashboard: get_notification_alerts()
-- used the same join, so every cron run looked like a failure. It reported "98
-- failed runs in 24h" against the pre-fix database, which happened to be the
-- right conclusion for the wrong reason, and would have kept firing a critical
-- alert forever once the pipeline was healthy. An alert that is always on is
-- the same as no alert at all — precisely the failure mode this whole exercise
-- exists to eliminate.
--
-- Fix: capture the request id at call time. `net.http_post` returns it, so the
-- cron command writes it to a table alongside the job name, and the view joins
-- on a real key.

CREATE TABLE IF NOT EXISTS public.notification_cron_runs (
  id BIGSERIAL PRIMARY KEY,
  jobname TEXT NOT NULL,
  request_id BIGINT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.notification_cron_runs ENABLE ROW LEVEL SECURITY;
-- Service role only; nothing client-facing reads operational state.

CREATE INDEX IF NOT EXISTS notification_cron_runs_started_idx
  ON public.notification_cron_runs (started_at DESC);

-- Keep it small. pg_net purges _http_response after a few hours anyway, so
-- rows older than a week carry no joinable outcome.
CREATE OR REPLACE FUNCTION public.prune_notification_cron_runs()
RETURNS VOID LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM notification_cron_runs WHERE started_at < NOW() - INTERVAL '7 days';
$$;

-- ── Reschedule every job to record its request id ───────────────────────────
DO $do$
DECLARE
  v_job TEXT;
  v_schedule TEXT;
  v_jobs TEXT[][] := ARRAY[
    ARRAY['notify-dispatch',      '*/15 * * * *'],
    ARRAY['notify-receipts',      '*/30 * * * *'],
    ARRAY['notify-weekly-digest', '0 18 * * 0'],
    ARRAY['notify-monitor',       '0 8 * * *']
  ];
  i INT;
BEGIN
  FOR i IN 1 .. array_length(v_jobs, 1) LOOP
    v_job := v_jobs[i][1];
    v_schedule := v_jobs[i][2];

    IF EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobname = v_job) THEN
      PERFORM cron.unschedule(v_job);
    END IF;

    PERFORM cron.schedule(
      v_job,
      v_schedule,
      format(
        $cmd$
        INSERT INTO public.notification_cron_runs (jobname, request_id)
        VALUES (
          %L,
          net.http_post(
            url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/%s',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
            ),
            body := '{}'::jsonb,
            timeout_milliseconds := 25000
          )
        );
        $cmd$,
        v_job, v_job
      )
    );
  END LOOP;
END;
$do$;

-- ── Health view, now joining on a real key ──────────────────────────────────
-- Dropped rather than replaced: CREATE OR REPLACE VIEW cannot rename a column,
-- and this version renames start_time to started_at.
DROP VIEW IF EXISTS public.notification_cron_health;

CREATE VIEW public.notification_cron_health AS
  SELECT
    ncr.jobname,
    ncr.started_at,
    resp.status_code AS http_status,
    resp.error_msg,
    left(coalesce(resp.content, ''), 300) AS response_body,
    CASE
      WHEN resp.status_code BETWEEN 200 AND 299 THEN 'ok'
      WHEN resp.status_code IS NOT NULL THEN 'http_error'
      WHEN resp.error_msg IS NOT NULL THEN 'no_response'
      -- pg_net writes the response asynchronously, and purges it after a few
      -- hours. Young rows are genuinely pending; old ones have simply aged out.
      WHEN ncr.started_at > NOW() - INTERVAL '2 minutes' THEN 'pending'
      ELSE 'expired'
    END AS verdict
  FROM public.notification_cron_runs ncr
  LEFT JOIN net._http_response resp ON resp.id = ncr.request_id
  WHERE ncr.started_at > NOW() - INTERVAL '7 days'
  ORDER BY ncr.started_at DESC;

REVOKE ALL ON public.notification_cron_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_cron_health TO service_role;

-- ── Alert detection, corrected ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_notification_alerts()
RETURNS TABLE (code TEXT, severity TEXT, detail TEXT, metric NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $fn$
DECLARE
  v_reachable INTEGER; v_sent_24h INTEGER; v_resolved_24h INTEGER;
  v_failed_24h INTEGER; v_disabled_24h INTEGER; v_bad_cron INTEGER; v_cron_runs INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_reachable
    FROM push_tokens WHERE disabled_at IS NULL AND token LIKE 'ExponentPushToken%';

  SELECT COUNT(*) INTO v_sent_24h
    FROM notification_history WHERE sent_at > NOW() - INTERVAL '24 hours' AND channel = 'push';

  SELECT COUNT(*) FILTER (WHERE receipt_status IS NOT NULL),
         COUNT(*) FILTER (WHERE receipt_status = 'error')
    INTO v_resolved_24h, v_failed_24h
    FROM notification_history WHERE sent_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_disabled_24h
    FROM push_tokens WHERE disabled_at > NOW() - INTERVAL '24 hours';

  -- Only the last 3 hours: pg_net purges _http_response after a few hours, so
  -- a wider window would count aged-out rows as failures. notify-dispatch runs
  -- 12 times in 3 hours, which is ample signal — a genuinely broken pipeline
  -- shows up as 12 bad runs, not one flaky one.
  SELECT COUNT(*) FILTER (WHERE resp.status_code IS NULL OR resp.status_code NOT BETWEEN 200 AND 299),
         COUNT(*)
    INTO v_bad_cron, v_cron_runs
    FROM notification_cron_runs ncr
    LEFT JOIN net._http_response resp ON resp.id = ncr.request_id
   WHERE ncr.started_at > NOW() - INTERVAL '3 hours'
     -- Give pg_net time to record the response before judging it.
     AND ncr.started_at < NOW() - INTERVAL '2 minutes';

  -- Require more than one bad run so a single transient blip stays quiet.
  IF v_bad_cron > 1 THEN
    RETURN QUERY SELECT 'cron_not_responding'::TEXT, 'critical'::TEXT,
      format('%s of %s notification cron run(s) in the last 3h returned no response or a non-2xx status. Check net._http_response: status_code IS NULL means a pg_net timeout, 401 means the cron secret was rejected.', v_bad_cron, v_cron_runs),
      v_bad_cron::NUMERIC;
  END IF;

  -- The scheduler itself has stopped.
  IF v_cron_runs = 0 THEN
    RETURN QUERY SELECT 'cron_not_running'::TEXT, 'critical'::TEXT,
      'No notification cron run recorded in the last 3 hours. Check that the pg_cron jobs are still scheduled and active.'::TEXT,
      0::NUMERIC;
  END IF;

  IF v_reachable = 0 THEN
    RETURN QUERY SELECT 'no_reachable_users'::TEXT, 'critical'::TEXT,
      'No live push tokens exist. Either registration is broken or every token has been disabled.'::TEXT, 0::NUMERIC;
  ELSIF v_sent_24h = 0 THEN
    RETURN QUERY SELECT 'zero_sends'::TEXT, 'critical'::TEXT,
      format('No push sent in 24h despite %s reachable user(s). Invoke notify-dispatch by hand and read its skipped{} counters.', v_reachable),
      v_reachable::NUMERIC;
  END IF;

  IF v_resolved_24h >= 10 AND v_failed_24h::NUMERIC / v_resolved_24h > 0.05 THEN
    RETURN QUERY SELECT 'receipt_failure_rate'::TEXT, 'warning'::TEXT,
      format('%s of %s resolved receipts failed in 24h. Check notification_history.receipt_error for the dominant code.', v_failed_24h, v_resolved_24h),
      ROUND(100.0 * v_failed_24h / v_resolved_24h, 1);
  END IF;

  IF v_reachable > 0 AND v_disabled_24h > GREATEST(3, v_reachable * 0.2) THEN
    RETURN QUERY SELECT 'token_attrition'::TEXT, 'warning'::TEXT,
      format('%s token(s) disabled in 24h against a live pool of %s. A spike usually means a bad build or a credential change, not organic uninstalls.', v_disabled_24h, v_reachable),
      v_disabled_24h::NUMERIC;
  END IF;

  RETURN QUERY
    SELECT 'low_open_rate'::TEXT, 'warning'::TEXT,
      format('Campaign "%s" was opened %s time(s) from %s delivered in 7 days. Below the 3%% floor — rewrite it or retire it.', c.campaign_key, c.opened, c.delivered),
      ROUND(100.0 * c.opened / NULLIF(c.delivered, 0), 1)
    FROM (
      SELECT nh.campaign_key,
             COUNT(*) FILTER (WHERE nh.receipt_status = 'ok') AS delivered,
             COUNT(*) FILTER (WHERE nh.opened_at IS NOT NULL) AS opened
        FROM notification_history nh
       WHERE nh.sent_at > NOW() - INTERVAL '7 days' AND nh.campaign_key IS NOT NULL
       GROUP BY nh.campaign_key
    ) c
   WHERE c.delivered >= 20 AND 100.0 * c.opened / c.delivered < 3.0;

  RETURN QUERY
    SELECT 'opt_out_rate'::TEXT, 'warning'::TEXT,
      format('%s owner(s) have turned push off entirely. Sustained growth here means the content is wrong, not the plumbing.', o.n),
      o.n::NUMERIC
    FROM (SELECT COUNT(*) AS n FROM owner_preferences WHERE push_enabled IS FALSE) o
   WHERE o.n >= 5;

  RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_notification_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_alerts() TO service_role;

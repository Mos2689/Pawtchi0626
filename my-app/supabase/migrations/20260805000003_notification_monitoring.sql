-- Notification monitoring — make silent failure impossible.
--
-- The whole point. Pawtchi's push pipeline failed totally for months and every
-- signal available said it was healthy:
--   * cron.job_run_details reported "succeeded" (it only records that
--     net.http_post was queued, never the response);
--   * net._http_response held NULL status codes, because pg_net's 5 s default
--     timeout expired before the 401 came back;
--   * check-reminders returned {"success": true} after sending zero
--     notifications, because it swallowed its own query error as a warning.
--
-- Detection lives in SQL rather than in the edge function so it can be run and
-- verified with a single read-only query, by a human, at any time.

CREATE TABLE IF NOT EXISTS public.notification_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')),
  detail TEXT NOT NULL,
  metric NUMERIC,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notified_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ
);

ALTER TABLE public.notification_alerts ENABLE ROW LEVEL SECURITY;
-- No policies: service role only. Nothing client-facing reads operational state.

-- One open alert per code at a time; re-detection bumps last_seen_at rather
-- than filling the table with duplicates of the same ongoing problem.
CREATE UNIQUE INDEX IF NOT EXISTS notification_alerts_open_code
  ON public.notification_alerts (code)
  WHERE resolved_at IS NULL;

/**
 * Current findings, computed fresh. Returns zero rows when healthy.
 *
 * Run it by hand any time:
 *   SELECT * FROM public.get_notification_alerts();
 */
CREATE OR REPLACE FUNCTION public.get_notification_alerts()
RETURNS TABLE (code TEXT, severity TEXT, detail TEXT, metric NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_reachable INTEGER;
  v_sent_24h INTEGER;
  v_resolved_24h INTEGER;
  v_failed_24h INTEGER;
  v_disabled_24h INTEGER;
  v_bad_cron INTEGER;
BEGIN
  SELECT COUNT(DISTINCT user_id) INTO v_reachable
    FROM push_tokens
   WHERE disabled_at IS NULL AND token LIKE 'ExponentPushToken%';

  SELECT COUNT(*) INTO v_sent_24h
    FROM notification_history
   WHERE sent_at > NOW() - INTERVAL '24 hours' AND channel = 'push';

  SELECT COUNT(*) FILTER (WHERE receipt_status IS NOT NULL),
         COUNT(*) FILTER (WHERE receipt_status = 'error')
    INTO v_resolved_24h, v_failed_24h
    FROM notification_history
   WHERE sent_at > NOW() - INTERVAL '24 hours';

  SELECT COUNT(*) INTO v_disabled_24h
    FROM push_tokens
   WHERE disabled_at > NOW() - INTERVAL '24 hours';

  -- ── 1. Cron reached the function, and the function answered ──────────────
  -- This is the check that would have caught the original incident on day one.
  -- A NULL status_code means pg_net never saw a response: either the timeout is
  -- too low again, or the function is hanging.
  SELECT COUNT(*) INTO v_bad_cron
    FROM cron.job j
    JOIN cron.job_run_details r ON r.jobid = j.jobid
    LEFT JOIN net._http_response resp
      ON resp.id = NULLIF(regexp_replace(COALESCE(r.return_message, ''), '\D', '', 'g'), '')::BIGINT
   WHERE j.jobname IN ('notify-dispatch', 'notify-receipts', 'notify-weekly-digest')
     AND r.start_time > NOW() - INTERVAL '24 hours'
     AND (resp.status_code IS NULL OR resp.status_code NOT BETWEEN 200 AND 299);

  IF v_bad_cron > 0 THEN
    RETURN QUERY SELECT
      'cron_not_responding'::TEXT,
      'critical'::TEXT,
      format('%s notification cron run(s) in the last 24h returned no response or a non-2xx status. This is the signature of the Aug 2026 outage: check net._http_response for status_code IS NULL (pg_net timeout) or 401 (cron secret rejected).', v_bad_cron),
      v_bad_cron::NUMERIC;
  END IF;

  -- ── 2. The pipeline is reaching nobody ────────────────────────────────────
  IF v_reachable = 0 THEN
    RETURN QUERY SELECT
      'no_reachable_users'::TEXT,
      'critical'::TEXT,
      'No live push tokens exist. Either registration is broken or every token has been disabled.'::TEXT,
      0::NUMERIC;
  ELSIF v_sent_24h = 0 THEN
    RETURN QUERY SELECT
      'zero_sends'::TEXT,
      'critical'::TEXT,
      format('No push sent in 24h despite %s reachable user(s). Invoke notify-dispatch by hand and read its skipped{} counters.', v_reachable),
      v_reachable::NUMERIC;
  END IF;

  -- ── 3. Expo is accepting but not delivering ───────────────────────────────
  IF v_resolved_24h >= 10 AND v_failed_24h::NUMERIC / v_resolved_24h > 0.05 THEN
    RETURN QUERY SELECT
      'receipt_failure_rate'::TEXT,
      'warning'::TEXT,
      format('%s of %s resolved receipts failed in 24h. Check notification_history.receipt_error for the dominant code.', v_failed_24h, v_resolved_24h),
      ROUND(100.0 * v_failed_24h / v_resolved_24h, 1);
  END IF;

  -- ── 4. Tokens dying faster than they are replaced ─────────────────────────
  IF v_reachable > 0 AND v_disabled_24h > GREATEST(3, v_reachable * 0.2) THEN
    RETURN QUERY SELECT
      'token_attrition'::TEXT,
      'warning'::TEXT,
      format('%s token(s) disabled in 24h against a live pool of %s. A spike usually means a bad build or a credential change, not organic uninstalls.', v_disabled_24h, v_reachable),
      v_disabled_24h::NUMERIC;
  END IF;

  -- ── 5. A campaign nobody wants ────────────────────────────────────────────
  -- Deliberately generous sample size: killing a campaign on noise is worse
  -- than carrying it a week longer.
  RETURN QUERY
    SELECT
      'low_open_rate'::TEXT,
      'warning'::TEXT,
      format('Campaign "%s" was opened %s time(s) from %s delivered in 7 days. Below the 3%% floor — rewrite it or retire it.',
             c.campaign_key, c.opened, c.delivered),
      ROUND(100.0 * c.opened / NULLIF(c.delivered, 0), 1)
    FROM (
      SELECT nh.campaign_key,
             COUNT(*) FILTER (WHERE nh.receipt_status = 'ok') AS delivered,
             COUNT(*) FILTER (WHERE nh.opened_at IS NOT NULL) AS opened
        FROM notification_history nh
       WHERE nh.sent_at > NOW() - INTERVAL '7 days'
         AND nh.campaign_key IS NOT NULL
       GROUP BY nh.campaign_key
    ) c
   WHERE c.delivered >= 20
     AND 100.0 * c.opened / c.delivered < 3.0;

  -- ── 6. Owners are switching us off ────────────────────────────────────────
  RETURN QUERY
    SELECT
      'opt_out_rate'::TEXT,
      'warning'::TEXT,
      format('%s owner(s) have turned push off entirely. Sustained growth here means the content is wrong, not the plumbing.', o.n),
      o.n::NUMERIC
    FROM (SELECT COUNT(*) AS n FROM owner_preferences WHERE push_enabled IS FALSE) o
   WHERE o.n >= 5;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.get_notification_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_alerts() TO service_role;

-- ── Weekly digest candidates ────────────────────────────────────────────────
-- Replaces run_weekly_summaries(), which looped EVERY pet unconditionally with
-- no engagement filter, no unsubscribe check, a hardcoded waterIntakeScore of
-- 'Good', and a legacy anon JWT in the function body. That JWT could never
-- satisfy send-email's verifyAuth, so the digest has never delivered either —
-- send-email 401s are visible in the edge logs.
CREATE OR REPLACE FUNCTION public.get_weekly_digest_candidates()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  owner_name TEXT,
  pet_id UUID,
  pet_name TEXT,
  pet_sex TEXT,
  calories_consumed BIGINT,
  calorie_goal BIGINT,
  days_logged INTEGER,
  walks_logged INTEGER,
  weight_change_kg NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH primary_pet AS (
    SELECT DISTINCT ON (p.owner_id)
           p.owner_id, p.id, p.name, p.gender, p.target_daily_calories
      FROM pets p ORDER BY p.owner_id, p.created_at ASC
  ),
  week AS (
    SELECT dl.pet_id,
           COALESCE(SUM(dl.calories_consumed), 0) AS calories,
           COUNT(*) FILTER (WHERE dl.calories_consumed > 0)::INTEGER AS days_logged,
           COALESCE(SUM(dl.walks_count), 0)::INTEGER AS walks
      FROM daily_logs dl
     WHERE dl.log_date >= CURRENT_DATE - 7
     GROUP BY dl.pet_id
  ),
  weight_delta AS (
    SELECT wl.pet_id,
           MAX(wl.weight_kg) FILTER (WHERE wl.rn_new = 1)
             - MAX(wl.weight_kg) FILTER (WHERE wl.rn_old = 1) AS delta
      FROM (
        SELECT w.pet_id, w.weight_kg,
               ROW_NUMBER() OVER (PARTITION BY w.pet_id ORDER BY w.logged_at DESC) AS rn_new,
               ROW_NUMBER() OVER (PARTITION BY w.pet_id ORDER BY w.logged_at ASC) AS rn_old
          FROM weight_logs w
         WHERE w.logged_at >= NOW() - INTERVAL '7 days'
      ) wl
     GROUP BY wl.pet_id
  )
  SELECT
    u.id,
    u.email::TEXT,
    COALESCE(pr.full_name, 'there'),
    pp.id,
    pp.name,
    pp.gender,
    wk.calories,
    (COALESCE(pp.target_daily_calories, 0) * 7)::BIGINT,
    wk.days_logged,
    wk.walks,
    ROUND(COALESCE(wd.delta, 0)::NUMERIC, 1)
  FROM primary_pet pp
  JOIN auth.users u ON u.id = pp.owner_id
  JOIN week wk      ON wk.pet_id = pp.id
  LEFT JOIN profiles pr ON pr.id = pp.owner_id
  LEFT JOIN owner_preferences op ON op.owner_id = pp.owner_id
  LEFT JOIN weight_delta wd ON wd.pet_id = pp.id
  -- A recap of a week with nothing in it is not a recap.
  WHERE wk.days_logged >= 3
    -- Honour the unsubscribe. There was previously no way to opt out at all.
    AND COALESCE(op.cat_digest, TRUE) IS TRUE
    AND COALESCE(op.push_enabled, TRUE) IS TRUE
    AND u.email IS NOT NULL
    -- Never twice for the same week.
    AND NOT EXISTS (
      SELECT 1 FROM notification_history nh
       WHERE nh.user_id = u.id
         AND nh.campaign_key = 'weekly_digest_email'
         AND nh.sent_at > NOW() - INTERVAL '6 days'
    );
$$;

REVOKE ALL ON FUNCTION public.get_weekly_digest_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_digest_candidates() TO service_role;

-- Retire the old one so it cannot be scheduled again by accident.
DROP FUNCTION IF EXISTS public.run_weekly_summaries();

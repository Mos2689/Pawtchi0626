-- Email dispatcher cron, and the alerting that keeps it honest.
--
-- ── Why the weekly-digest job goes away ─────────────────────────────────────
--
-- notify-weekly-digest was a second sender with its own schedule. The August
-- audit's finding was that a forked notification path is how a pipeline fails
-- silently for four months, and this is the same fork in a new channel. The
-- digest is now a campaign inside notify-email-dispatch, decided by the same
-- rule engine as every other email, and subject to the same weekly cap.
--
-- It also has to go for a correctness reason. '0 18 * * 0' is 18:00 UTC on
-- Sunday, which is roughly 04:00 on Monday in Australia/Sydney. The digest was
-- a "Sunday evening" email that would have arrived before dawn on Monday for
-- essentially the entire user base. The dispatcher runs every 30 minutes and
-- gates on the owner's local hour, which is the only way per-timezone timing
-- works.
--
-- ── Why every 30 minutes ────────────────────────────────────────────────────
--
-- A frequent tick is what makes local-hour gating possible; it does not mean
-- frequent email. One campaign per owner per run, then the two-per-week cap
-- applies. Half-hourly rather than the push dispatcher's quarter-hourly because
-- no email rule needs minute-level precision — the tightest is "11:00 local".

-- ── Retire the forked sender ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobname = 'notify-weekly-digest') THEN
    PERFORM cron.unschedule('notify-weekly-digest');
  END IF;
END;
$$;

-- ── Schedule the email dispatcher ───────────────────────────────────────────
-- Same shape as the other jobs: the request id from net.http_post is captured
-- into notification_cron_runs so notification_cron_health can join on a real
-- key, and timeout_milliseconds is set because pg_net's 5 s default is shorter
-- than the function's runtime and silently discards the response — which is
-- how 401s stayed invisible for months.
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job cj WHERE cj.jobname = 'notify-email-dispatch') THEN
    PERFORM cron.unschedule('notify-email-dispatch');
  END IF;

  PERFORM cron.schedule(
    'notify-email-dispatch',
    '*/30 * * * *',
    $cmd$
    INSERT INTO public.notification_cron_runs (jobname, request_id)
    VALUES (
      'notify-email-dispatch',
      net.http_post(
        url := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/notify-email-dispatch',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      )
    );
    $cmd$
  );
END;
$do$;

-- ── Email health, added to the one alert query ──────────────────────────────
-- Deliberately appended to get_notification_alerts() rather than given its own
-- function. `SELECT * FROM get_notification_alerts();` is the one-query health
-- check for the whole messaging system, and a second function is a second thing
-- somebody has to remember to run.
--
-- The thresholds are not arbitrary. Google requires a spam rate below 0.30% and
-- recommends below 0.10%; past 0.30% it rejects rather than delays, and the
-- domain stays ineligible for delivery support until seven consecutive clean
-- days. So the warning fires at 0.1% and the critical at 0.3%, which gives us
-- room to stop sending before the reputation damage is done.
CREATE OR REPLACE FUNCTION public.get_email_alerts()
RETURNS TABLE (code TEXT, severity TEXT, detail TEXT, metric NUMERIC)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE
AS $fn$
DECLARE
  v_sent_7d INTEGER;
  v_delivered_7d INTEGER;
  v_complained_7d INTEGER;
  v_bounced_7d INTEGER;
  v_unsub_7d INTEGER;
  v_reachable INTEGER;
BEGIN
  SELECT COUNT(*) FILTER (WHERE TRUE),
         COUNT(*) FILTER (WHERE receipt_status = 'delivered'),
         COUNT(*) FILTER (WHERE receipt_status = 'complained'),
         COUNT(*) FILTER (WHERE receipt_status = 'bounced')
    INTO v_sent_7d, v_delivered_7d, v_complained_7d, v_bounced_7d
    FROM notification_history
   WHERE channel = 'email' AND sent_at > NOW() - INTERVAL '7 days';

  SELECT COUNT(*) INTO v_unsub_7d
    FROM owner_preferences
   WHERE email_unsubscribed_at > NOW() - INTERVAL '7 days';

  SELECT COUNT(*) INTO v_reachable
    FROM auth.users u
    JOIN owner_preferences op ON op.owner_id = u.id
   WHERE u.email IS NOT NULL AND u.email_confirmed_at IS NOT NULL
     AND op.email_enabled IS TRUE;

  -- Complaint rate is the metric that decides whether this channel survives.
  IF v_sent_7d >= 50 AND v_complained_7d::NUMERIC / v_sent_7d >= 0.003 THEN
    RETURN QUERY SELECT 'email_complaint_critical'::TEXT, 'critical'::TEXT,
      format('%s spam complaint(s) from %s emails in 7 days. At or above Google''s 0.3%% ceiling — STOP SENDING campaigns until this is understood.', v_complained_7d, v_sent_7d),
      ROUND(100.0 * v_complained_7d / v_sent_7d, 3);
  ELSIF v_sent_7d >= 50 AND v_complained_7d::NUMERIC / v_sent_7d >= 0.001 THEN
    RETURN QUERY SELECT 'email_complaint_warning'::TEXT, 'warning'::TEXT,
      format('%s spam complaint(s) from %s emails in 7 days, above the 0.1%% target. Usually cadence or relevance, not plumbing.', v_complained_7d, v_sent_7d),
      ROUND(100.0 * v_complained_7d / v_sent_7d, 3);
  END IF;

  -- A bounce spike means the list is stale or the domain is misconfigured.
  IF v_sent_7d >= 20 AND v_bounced_7d::NUMERIC / v_sent_7d > 0.05 THEN
    RETURN QUERY SELECT 'email_bounce_rate'::TEXT, 'warning'::TEXT,
      format('%s of %s emails bounced in 7 days. Check SPF, DKIM and DMARC on pawtchi.com before sending more.', v_bounced_7d, v_sent_7d),
      ROUND(100.0 * v_bounced_7d / v_sent_7d, 1);
  END IF;

  -- Unsubscribes are not inherently bad — one-click exists precisely to divert
  -- people away from the spam button — but a spike still means the content is
  -- wrong.
  IF v_reachable > 0 AND v_unsub_7d > GREATEST(3, v_reachable * 0.05) THEN
    RETURN QUERY SELECT 'email_opt_out_rate'::TEXT, 'warning'::TEXT,
      format('%s owner(s) unsubscribed in 7 days against a reachable list of %s. Sustained growth here means the content is wrong, not the plumbing.', v_unsub_7d, v_reachable),
      v_unsub_7d::NUMERIC;
  END IF;

  -- Nothing is being recorded as delivered. Either the Resend webhook is not
  -- wired up, or nothing is actually arriving. Both are worth knowing, and the
  -- whole point of the August rebuild was that silence is not evidence of
  -- health.
  IF v_sent_7d >= 20 AND v_delivered_7d = 0 THEN
    RETURN QUERY SELECT 'email_no_receipts'::TEXT, 'warning'::TEXT,
      format('%s emails sent in 7 days and not one recorded as delivered. Check that the Resend webhook is pointed at the email-events function.', v_sent_7d),
      v_sent_7d::NUMERIC;
  END IF;

  RETURN;
END;
$fn$;

REVOKE ALL ON FUNCTION public.get_email_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_alerts() TO service_role;

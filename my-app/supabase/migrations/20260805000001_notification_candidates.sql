-- get_notification_candidates — one row per user the dispatcher might message.
--
-- Replaces the retired pet-reminders access pattern, which looped every push
-- token and ran four sequential queries inside the loop. At 34 tokens that
-- already took 6-40 s per run (edge logs), overran pg_net's 5 s timeout on
-- every single invocation, and would have collapsed well before 1,000 users.
--
-- Everything the rule engine needs is assembled here in one pass. The function
-- deliberately returns *candidates*, not decisions: eligibility (quiet hours,
-- caps, category opt-outs) is applied in TypeScript so it is unit-testable
-- against lib/notifications/rules.ts.

CREATE OR REPLACE FUNCTION public.get_notification_candidates()
RETURNS TABLE (
  user_id UUID,
  timezone TEXT,
  tokens TEXT[],
  pet_id UUID,
  pet_name TEXT,
  pet_sex TEXT,
  days_since_signup INTEGER,
  push_enabled BOOLEAN,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  nudge_lead_minutes INTEGER,
  notification_intensity TEXT,
  cat_care_reminders BOOLEAN,
  cat_health_insights BOOLEAN,
  cat_milestones BOOLEAN,
  cat_digest BOOLEAN,
  cat_lifecycle BOOLEAN,
  total_logs INTEGER,
  days_since_last_log INTEGER,
  days_since_last_session INTEGER,
  cal_percent INTEGER,
  days_under_target INTEGER,
  logged_today BOOLEAN,
  current_streak_days INTEGER,
  has_weight_goal BOOLEAN,
  goal_direction TEXT,
  days_since_last_weigh_in INTEGER,
  next_meal_time TIME,
  next_meal_label TEXT,
  week_meals_logged INTEGER,
  week_walks_logged INTEGER,
  pending_milestone_id UUID,
  pending_walksign_key TEXT,
  pending_vet_checkin UUID,
  sent_today INTEGER,
  sent_this_week INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH live_tokens AS (
    SELECT pt.user_id, array_agg(pt.token ORDER BY pt.last_seen_at DESC NULLS LAST) AS tokens
      FROM push_tokens pt
     WHERE pt.disabled_at IS NULL
       AND pt.token LIKE 'ExponentPushToken%'
     GROUP BY pt.user_id
  ),
  -- One pet per owner: the dispatcher speaks about a single animal, and every
  -- account in production has exactly one. Oldest wins so it is deterministic.
  primary_pet AS (
    SELECT DISTINCT ON (p.owner_id)
           p.owner_id, p.id, p.name, p.gender, p.target_daily_calories,
           p.weight_plan_status, p.current_weight_kg, p.target_weight_kg,
           p.ideal_weight_kg, p.current_weight_logged_at, p.walksign_status,
           p.walksign_assigned_at
      FROM pets p
     ORDER BY p.owner_id, p.created_at ASC
  ),
  today_log AS (
    SELECT dl.pet_id, dl.calories_consumed, dl.walks_count
      FROM daily_logs dl
     WHERE dl.log_date = CURRENT_DATE
  ),
  log_stats AS (
    SELECT dl.pet_id,
           COUNT(*)::INTEGER AS total_logs,
           MAX(dl.log_date) AS last_log_date,
           COUNT(*) FILTER (WHERE dl.log_date >= CURRENT_DATE - 6)::INTEGER AS week_meals,
           COALESCE(SUM(dl.walks_count) FILTER (WHERE dl.log_date >= CURRENT_DATE - 6), 0)::INTEGER AS week_walks
      FROM daily_logs dl
     WHERE dl.calories_consumed > 0
     GROUP BY dl.pet_id
  ),
  -- Days in the last three that came in under 70% of target. Mirrors the
  -- nudgeEngine P4.5 signal rather than inventing a second definition.
  under_target AS (
    SELECT dl.pet_id, COUNT(*)::INTEGER AS days_under
      FROM daily_logs dl
      JOIN primary_pet pp ON pp.id = dl.pet_id
     WHERE dl.log_date BETWEEN CURRENT_DATE - 3 AND CURRENT_DATE - 1
       AND COALESCE(pp.target_daily_calories, 0) > 0
       AND dl.calories_consumed < pp.target_daily_calories * 0.7
     GROUP BY dl.pet_id
  ),
  -- Next unlogged feeding slot today. `activities` is the schedule of record;
  -- the retired function read a table named activity_logs that has never
  -- existed, so its walk reminders always believed nothing was logged.
  next_meal AS (
    SELECT DISTINCT ON (a.pet_id) a.pet_id, a.scheduled_time, a.title
      FROM activities a
     WHERE a.scheduled_date = CURRENT_DATE
       AND a.status = 'pending'
       AND a.activity_type = 'feeding'
     ORDER BY a.pet_id, a.scheduled_time ASC
  ),
  -- 24-hour lookback, not a single dispatch window. A milestone reached at
  -- 02:00 sits inside the owner's quiet hours; a short window would drop it
  -- permanently. Idempotency comes from the milestone id in the dedupe key,
  -- so a wide window cannot produce a repeat.
  fresh_milestone AS (
    SELECT DISTINCT ON (pm.owner_id) pm.owner_id, pm.id
      FROM pet_milestones pm
     WHERE pm.reached_at > NOW() - INTERVAL '24 hours'
     ORDER BY pm.owner_id, pm.reached_at DESC
  ),
  due_checkin AS (
    SELECT DISTINCT ON (vq.user_id) vq.user_id, vq.id
      FROM vet_questions vq
     WHERE vq.checkin_due_at <= NOW()
       AND vq.checkin_sent_at IS NULL
       AND vq.status = 'open'
     ORDER BY vq.user_id, vq.checkin_due_at ASC
  ),
  send_counts AS (
    SELECT nh.user_id,
           COUNT(*) FILTER (WHERE nh.sent_at >= CURRENT_DATE)::INTEGER AS sent_today,
           COUNT(*) FILTER (WHERE nh.sent_at >= CURRENT_DATE - 6)::INTEGER AS sent_week
      FROM notification_history nh
     WHERE nh.sent_at >= CURRENT_DATE - 6
     GROUP BY nh.user_id
  )
  SELECT
    lt.user_id,
    pr.timezone,
    lt.tokens,
    pp.id,
    pp.name,
    pp.gender,
    GREATEST(0, EXTRACT(DAY FROM NOW() - u.created_at)::INTEGER),
    COALESCE(op.push_enabled, TRUE),
    op.quiet_hours_start,
    op.quiet_hours_end,
    COALESCE(op.nudge_lead_minutes, 10),
    COALESCE(op.notification_intensity, 'standard'),
    COALESCE(op.cat_care_reminders, TRUE),
    COALESCE(op.cat_health_insights, TRUE),
    COALESCE(op.cat_milestones, TRUE),
    COALESCE(op.cat_digest, TRUE),
    COALESCE(op.cat_lifecycle, TRUE),
    COALESCE(ls.total_logs, 0),
    CASE WHEN ls.last_log_date IS NULL THEN NULL
         ELSE (CURRENT_DATE - ls.last_log_date)::INTEGER END,
    CASE WHEN u.last_sign_in_at IS NULL THEN NULL
         ELSE EXTRACT(DAY FROM NOW() - u.last_sign_in_at)::INTEGER END,
    CASE WHEN COALESCE(pp.target_daily_calories, 0) > 0
         THEN ROUND(COALESCE(tl.calories_consumed, 0)::NUMERIC * 100 / pp.target_daily_calories)::INTEGER
         ELSE 0 END,
    COALESCE(ut.days_under, 0),
    COALESCE(tl.calories_consumed, 0) > 0,
    COALESCE(st.current_streak, 0),
    pp.weight_plan_status IN ('active', 'maintenance'),
    CASE
      WHEN pp.weight_plan_status = 'maintenance' THEN 'maintain'
      WHEN pp.ideal_weight_kg IS NOT NULL AND pp.current_weight_kg IS NOT NULL
           AND pp.current_weight_kg > pp.ideal_weight_kg THEN 'lose'
      WHEN pp.ideal_weight_kg IS NOT NULL AND pp.current_weight_kg IS NOT NULL
           AND pp.current_weight_kg < pp.ideal_weight_kg THEN 'gain'
      ELSE NULL
    END,
    CASE WHEN pp.current_weight_logged_at IS NULL THEN NULL
         ELSE EXTRACT(DAY FROM NOW() - pp.current_weight_logged_at)::INTEGER END,
    nm.scheduled_time,
    nm.title,
    COALESCE(ls.week_meals, 0),
    COALESCE(ls.week_walks, 0),
    fm.id,
    -- A Walksign confirmed in the last day is worth celebrating. Keyed on the
    -- confirmation timestamp so the dedupe key is stable across runs.
    CASE
      WHEN pp.walksign_status = 'confirmed'
       AND pp.walksign_assigned_at > NOW() - INTERVAL '24 hours'
      THEN to_char(pp.walksign_assigned_at, 'YYYY-MM-DD"T"HH24:MI')
      ELSE NULL
    END,
    dc.id,
    COALESCE(sc.sent_today, 0),
    COALESCE(sc.sent_week, 0)
  FROM live_tokens lt
  JOIN auth.users u        ON u.id = lt.user_id
  LEFT JOIN profiles pr    ON pr.id = lt.user_id
  LEFT JOIN primary_pet pp ON pp.owner_id = lt.user_id
  LEFT JOIN owner_preferences op ON op.owner_id = lt.user_id
  LEFT JOIN today_log tl   ON tl.pet_id = pp.id
  LEFT JOIN log_stats ls   ON ls.pet_id = pp.id
  LEFT JOIN under_target ut ON ut.pet_id = pp.id
  LEFT JOIN next_meal nm   ON nm.pet_id = pp.id
  LEFT JOIN streaks st     ON st.owner_id = lt.user_id
  LEFT JOIN fresh_milestone fm ON fm.owner_id = lt.user_id
  LEFT JOIN due_checkin dc ON dc.user_id = lt.user_id
  LEFT JOIN send_counts sc ON sc.user_id = lt.user_id
  -- A user who has opted out entirely never leaves the database.
  WHERE COALESCE(op.push_enabled, TRUE) IS TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_notification_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_notification_candidates() TO service_role;

COMMENT ON FUNCTION public.get_notification_candidates() IS
  'One row per user eligible for a push, with everything lib/notifications/rules.ts needs. Service role only.';

-- ── Consuming a vet check-in ────────────────────────────────────────────────
-- The retired `vet-checkins` function marked EVERY due case as sent before it
-- knew whether a push had been built, so unblocking its 401 would have
-- silently consumed the whole backlog with nothing delivered. Here the mark
-- happens only for cases the dispatcher successfully claimed and sent, and the
-- count increments atomically rather than through a read-modify-write race.
CREATE OR REPLACE FUNCTION public.consume_vet_checkins(p_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected INTEGER;
BEGIN
  UPDATE vet_questions
     SET checkin_sent_at = NOW(),
         checkin_due_at = NULL,
         checkin_count = COALESCE(checkin_count, 0) + 1
   WHERE id = ANY(p_ids)
     AND checkin_sent_at IS NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_vet_checkins(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_vet_checkins(UUID[]) TO service_role;

-- ── Marking a notification as opened ────────────────────────────────────────
-- Called by the app when a user taps a push. Scoped to the caller so one user
-- cannot mark another user's notifications.
CREATE OR REPLACE FUNCTION public.mark_notification_opened(p_dedupe_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR p_dedupe_key IS NULL THEN
    RETURN;
  END IF;

  UPDATE notification_history
     SET opened_at = COALESCE(opened_at, NOW())
   WHERE dedupe_key = p_dedupe_key
     AND user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_opened(TEXT) TO authenticated;

-- ── Operational view ────────────────────────────────────────────────────────
-- The audit's central problem was that total failure looked like healthy
-- operation. This is the one place to look to see whether that is true.
CREATE OR REPLACE VIEW public.notification_health AS
  SELECT
    date_trunc('day', nh.sent_at)::DATE               AS day,
    COALESCE(nh.campaign_key, nh.event_type)          AS campaign,
    nh.variant,
    COUNT(*)                                          AS sent,
    COUNT(*) FILTER (WHERE nh.receipt_status = 'ok')  AS delivered,
    COUNT(*) FILTER (WHERE nh.receipt_status = 'error') AS failed,
    COUNT(*) FILTER (WHERE nh.receipt_status IS NULL AND nh.expo_ticket_id IS NOT NULL)
                                                      AS awaiting_receipt,
    COUNT(*) FILTER (WHERE nh.opened_at IS NOT NULL)  AS opened,
    ROUND(
      100.0 * COUNT(*) FILTER (WHERE nh.opened_at IS NOT NULL)
      / NULLIF(COUNT(*) FILTER (WHERE nh.receipt_status = 'ok'), 0),
      1
    )                                                 AS open_rate_pct
  FROM notification_history nh
  WHERE nh.sent_at IS NOT NULL
  GROUP BY 1, 2, 3
  ORDER BY 1 DESC, sent DESC;

REVOKE ALL ON public.notification_health FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_health TO service_role;

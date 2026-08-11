-- Weekly digest candidates, corrected for the email channel.
--
-- Three things were wrong with the version in 20260805000003:
--
-- 1. It gated on push_enabled. An owner who declined the OS push prompt got no
--    email either, which is the exact inverse of why the channel exists. Email
--    consent now lives in its own columns (20260809000000) and is read here.
--
-- 2. It had no timezone in its output, and its cron fired at a fixed
--    '0 18 * * 0' UTC. For the Australian user base that is roughly 04:00 on
--    Monday. The push pipeline has been strictly owner-local since the August
--    rebuild and the email path was still using a server clock. This function
--    no longer decides *when* at all: it returns the owner's timezone and the
--    dispatcher gates on their local hour, exactly as notify-dispatch does with
--    get_notification_candidates.
--
-- 3. The engagement gate was days_logged >= 3, which against the current
--    database returns three owners. Meal logging is not where behaviour is;
--    walks are. The gate is now "two logged days OR a walk", which is still a
--    real gate — an empty week still earns no email — but it stops defining
--    engagement solely as the one behaviour almost nobody performs.
--
-- The return type changes, so this is DROP then CREATE. CREATE OR REPLACE
-- cannot change a function's return type, and per the August audit adding
-- overloads rather than replacing is how register_push_token ended up with two
-- signatures and a 42725 on every call.

DROP FUNCTION IF EXISTS public.get_weekly_digest_candidates();

CREATE FUNCTION public.get_weekly_digest_candidates()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  owner_name TEXT,
  timezone TEXT,
  unsubscribe_token UUID,
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
    pr.timezone,
    op.email_unsubscribe_token,
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
  -- Not LEFT: the backfill in 20260809000000 gave every owner a row, and the
  -- unsubscribe token is not optional. An owner with no row is a data bug and
  -- should drop out rather than be emailed with a null token in the footer.
  JOIN owner_preferences op ON op.owner_id = pp.owner_id
  LEFT JOIN weight_delta wd ON wd.pet_id = pp.id
  -- A recap of a week with nothing in it is still not a recap.
  WHERE (wk.days_logged >= 2 OR wk.walks >= 1)
    -- Email consent, and only email consent. push_enabled is deliberately not
    -- consulted: see the header.
    AND op.email_enabled IS TRUE
    AND op.cat_email_digest IS TRUE
    AND u.email IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
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

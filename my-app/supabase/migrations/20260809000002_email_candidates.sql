-- get_email_candidates — one row per owner the email dispatcher might write to.
--
-- The structural difference from get_notification_candidates, and the reason
-- this channel exists at all: that function begins `FROM live_tokens`, so an
-- owner without a push token is invisible to it. Against production that is 169
-- of 182 people. This one begins `FROM auth.users`, because every account has a
-- confirmed address.
--
-- Same division of labour as the push side: this returns *candidates*, not
-- decisions. Timing, caps, category gating and cross-channel suppression are
-- applied in TypeScript against lib/email/rules.ts, where they are unit-tested.

CREATE OR REPLACE FUNCTION public.get_email_candidates()
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  owner_name TEXT,
  timezone TEXT,
  unsubscribe_token UUID,

  pet_id UUID,
  pet_name TEXT,
  pet_sex TEXT,
  hours_since_pet_created NUMERIC,
  days_since_signup INTEGER,

  -- Preferences. Email only: push_enabled is deliberately not consulted here.
  email_enabled BOOLEAN,
  cat_email_lifecycle BOOLEAN,
  cat_email_digest BOOLEAN,
  cat_email_insights BOOLEAN,
  cat_email_walk BOOLEAN,

  total_logs INTEGER,
  days_since_last_session INTEGER,
  reassessment_due_days INTEGER,

  -- The Reading. Everything onboarding already captured, which is the whole
  -- point of that campaign: it needs no logging to be worth sending.
  breed TEXT,
  current_weight_kg NUMERIC,
  ideal_weight_kg NUMERIC,
  healthy_band_low_kg NUMERIC,
  healthy_band_high_kg NUMERIC,
  body_condition_score INTEGER,
  target_daily_calories INTEGER,
  age_years NUMERIC,
  species TEXT,
  -- Returned raw, including the onboarding placeholders. The sender decides
  -- what counts as a real photograph: 85 of 168 rows are images.unsplash.com
  -- URLs left over from setup, and using one under "here is your dog's week"
  -- would be a stock photo of somebody else's animal.
  image_url TEXT,

  sent_this_week INTEGER,
  already_sent TEXT[],
  recent_push_hours JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH primary_pet AS (
    SELECT DISTINCT ON (p.owner_id)
           p.owner_id, p.id, p.name, p.gender, p.created_at,
           p.breed, p.species, p.age_years,
           p.current_weight_kg, p.ideal_weight_kg,
           p.healthy_band_low_kg, p.healthy_band_high_kg,
           p.body_condition_score, p.target_daily_calories, p.image_url,
           p.weight_plan_status, p.current_weight_logged_at
      FROM pets p
     ORDER BY p.owner_id, p.created_at ASC
  ),
  log_stats AS (
    SELECT dl.pet_id, COUNT(*)::INTEGER AS total_logs
      FROM daily_logs dl
     WHERE dl.calories_consumed > 0
     GROUP BY dl.pet_id
  ),
  -- Email-only counters. The push pipeline has its own caps against the same
  -- table; mixing the two would let a chatty push week silently starve the
  -- email channel, and vice versa.
  email_counts AS (
    SELECT nh.user_id,
           COUNT(*) FILTER (WHERE nh.sent_at >= CURRENT_DATE - 6)::INTEGER AS sent_week
      FROM notification_history nh
     WHERE nh.channel = 'email'
       AND nh.sent_at >= CURRENT_DATE - 6
     GROUP BY nh.user_id
  ),
  -- Lifetime, so "once ever" rules stay once ever across redeploys.
  email_history AS (
    SELECT nh.user_id, array_agg(DISTINCT nh.campaign_key) AS campaigns
      FROM notification_history nh
     WHERE nh.channel = 'email' AND nh.campaign_key IS NOT NULL
     GROUP BY nh.user_id
  ),
  -- Feeds the cross-channel suppression rule: an owner who was pushed about
  -- their weigh-in two hours ago should not also be emailed about it.
  --
  -- Returns hours-since rather than a pre-filtered list, and looks back further
  -- than the threshold on purpose. The threshold itself is
  -- CROSS_CHANNEL_SUPPRESSION_HOURS in lib/email/rules.ts, where it is
  -- unit-tested; baking 24 hours into this query as well would put the same
  -- constant in two languages and let them drift.
  recent_push AS (
    SELECT nh.user_id,
           jsonb_object_agg(nh.campaign_key, nh.hours_ago) AS campaigns
      FROM (
        SELECT DISTINCT ON (n.user_id, n.campaign_key)
               n.user_id,
               n.campaign_key,
               ROUND(EXTRACT(EPOCH FROM NOW() - n.sent_at) / 3600.0, 2) AS hours_ago
          FROM notification_history n
         WHERE n.channel = 'push'
           AND n.campaign_key IS NOT NULL
           AND n.sent_at > NOW() - INTERVAL '48 hours'
         ORDER BY n.user_id, n.campaign_key, n.sent_at DESC
      ) nh
     GROUP BY nh.user_id
  ),
  -- The 21-day floor between reassessment emails. Enforced here rather than in
  -- the rule engine because the rule engine has no history to consult, and a
  -- plan can sit in needs_reassessment for months.
  recent_reassessment AS (
    SELECT DISTINCT nh.user_id
      FROM notification_history nh
     WHERE nh.channel = 'email'
       AND nh.campaign_key = 'reassessment'
       AND nh.sent_at > NOW() - INTERVAL '21 days'
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
    CASE WHEN pp.created_at IS NULL THEN NULL
         ELSE EXTRACT(EPOCH FROM NOW() - pp.created_at) / 3600.0 END,
    GREATEST(0, EXTRACT(DAY FROM NOW() - u.created_at)::INTEGER),

    op.email_enabled,
    op.cat_email_lifecycle,
    op.cat_email_digest,
    op.cat_email_insights,
    op.cat_email_walk,

    COALESCE(ls.total_logs, 0),
    CASE WHEN u.last_sign_in_at IS NULL THEN NULL
         ELSE EXTRACT(DAY FROM NOW() - u.last_sign_in_at)::INTEGER END,
    -- Days since the weight the plan was actually built on. The table has no
    -- "became stale at" timestamp, and this is the honest proxy — it is also
    -- literally the number the email prints.
    CASE
      WHEN pp.weight_plan_status = 'needs_reassessment'
       AND pp.current_weight_logged_at IS NOT NULL
       AND rr.user_id IS NULL
      THEN EXTRACT(DAY FROM NOW() - pp.current_weight_logged_at)::INTEGER
      ELSE NULL
    END,

    pp.breed,
    pp.current_weight_kg,
    pp.ideal_weight_kg,
    pp.healthy_band_low_kg,
    pp.healthy_band_high_kg,
    pp.body_condition_score,
    pp.target_daily_calories,
    pp.age_years,
    pp.species,
    pp.image_url,

    COALESCE(ec.sent_week, 0),
    COALESCE(eh.campaigns, ARRAY[]::TEXT[]),
    COALESCE(rp.campaigns, '{}'::JSONB)
  FROM auth.users u
  LEFT JOIN profiles pr    ON pr.id = u.id
  LEFT JOIN primary_pet pp ON pp.owner_id = u.id
  -- Not LEFT: the backfill guarantees a row, and the unsubscribe token is not
  -- optional. A missing row is a data bug and must drop out rather than send
  -- an email whose footer cannot be honoured.
  JOIN owner_preferences op ON op.owner_id = u.id
  LEFT JOIN log_stats ls   ON ls.pet_id = pp.id
  LEFT JOIN email_counts ec ON ec.user_id = u.id
  LEFT JOIN email_history eh ON eh.user_id = u.id
  LEFT JOIN recent_push rp ON rp.user_id = u.id
  LEFT JOIN recent_reassessment rr ON rr.user_id = u.id
  WHERE u.email IS NOT NULL
    AND u.email_confirmed_at IS NOT NULL
    -- An owner who has opted out entirely never leaves the database.
    AND op.email_enabled IS TRUE;
$$;

REVOKE ALL ON FUNCTION public.get_email_candidates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_email_candidates() TO service_role;

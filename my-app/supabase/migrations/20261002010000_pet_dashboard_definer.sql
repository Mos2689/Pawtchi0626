-- get_pet_dashboard: authorise once, not once per row (perf Train 1).
--
-- Measured 2026-10-01 for an owner's pet (22 logs, 49 scans, 211 activities),
-- warm: 53 ms and 2,597 buffers through RLS, against 8.6 ms run as the table
-- owner. Each of the 15 subqueries reads daily_logs / food_scans / activities /
-- weight_logs, and every row they touch is checked by
--   EXISTS (SELECT 1 FROM pets WHERE pets.id = <row>.pet_id AND owner_id = auth.uid())
-- That inner read of `pets` is itself filtered by pets' four permissive
-- policies, three of them community checks with subqueries of their own. So
-- the owner's dashboard paid the community-sharing machinery once per row.
-- Under load this RPC averaged 1,046 ms and hit the 8 s statement timeout,
-- which drops the client into its 15-request fallback and widens the
-- launch-time burst.
--
-- Now SECURITY DEFINER (owner postgres; RLS is not forced on these tables, so
-- the policies are skipped), with the same rule stated once at the top:
-- `me.pid` is the pet id ONLY when the caller owns that pet, otherwise NULL.
-- Every subquery filters `pet_id = me.pid`, so a caller who does not own the
-- pet gets exactly the document RLS gave them before: null today_log and
-- empty arrays. The child tables' policies only ever admitted the pet's owner
-- (one owner policy each, verified 2026-10-01), so this is the same rule, not a
-- wider one.
--
-- The body is otherwise byte-for-byte the 20260827150001 version.
-- EXECUTE is revoked from PUBLIC/anon, because the function now bypasses RLS.
-- Rollback: supabase/rollbacks/20261002010000_pet_dashboard_definer.down.sql

CREATE OR REPLACE FUNCTION public.get_pet_dashboard(
  p_pet_id uuid,
  p_today date,
  p_seven_ago date,
  p_fourteen_ago date,
  p_twenty_eight_ago date,
  p_day_start_utc timestamptz,
  p_seven_ago_utc timestamptz,
  p_twenty_eight_ago_utc timestamptz
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
select jsonb_build_object(
  -- refreshToday ── 1. today's daily_log (maybeSingle)
  'today_log', (
    select to_jsonb(t) from (
      select calories_consumed, water_ml, walks_count, treats_consumed
        from public.daily_logs
       where pet_id = me.pid and log_date = p_today
       limit 1
    ) t
  ),
  -- 2. today's food scans (newest first; cap high enough to total the day)
  'today_scans', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select id, ai_identified_food, ai_estimated_calories, created_at,
             is_treat, protein_g, carbs_g, fat_g, image_url
        from public.food_scans
       where pet_id = me.pid and created_at >= p_day_start_utc
       order by created_at desc
       limit 50
    ) t
  ),
  -- 3. next pending activity (maybeSingle)
  'next_activity', (
    select to_jsonb(t) from (
      select id, activity_type, title, scheduled_time, status,
             duration_minutes, intensity, distance_km, notes
        from public.activities
       where pet_id = me.pid and scheduled_date = p_today and status = 'pending'
       order by scheduled_time asc
       limit 1
    ) t
  ),
  -- 4. today's walk/play/training rows (any status)
  'today_activities', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select duration_minutes, status
        from public.activities
       where pet_id = me.pid and scheduled_date = p_today
         and activity_type in ('walk', 'play', 'training')
    ) t
  ),
  -- refreshTrends ── 5. 7-day calorie logs
  'logs7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select calories_consumed, log_date
        from public.daily_logs
       where pet_id = me.pid and log_date >= p_seven_ago and log_date <= p_today
    ) t
  ),
  -- 6. completed activity minutes, this week
  'acts_this', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select duration_minutes
        from public.activities
       where pet_id = me.pid and status = 'completed'
         and activity_type in ('walk', 'play', 'training')
         and scheduled_date >= p_seven_ago and scheduled_date <= p_today
    ) t
  ),
  -- 7. completed activity, previous week
  'acts_last', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select duration_minutes, intensity, scheduled_date
        from public.activities
       where pet_id = me.pid and status = 'completed'
         and activity_type in ('walk', 'play', 'training')
         and scheduled_date >= p_fourteen_ago and scheduled_date < p_seven_ago
    ) t
  ),
  -- 8. 7-day water logs
  'water7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select water_ml
        from public.daily_logs
       where pet_id = me.pid and log_date >= p_seven_ago and log_date <= p_today
    ) t
  ),
  -- 9. latest two weight logs
  'weight2', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select weight_kg, logged_at
        from public.weight_logs
       where pet_id = me.pid
       order by logged_at desc
       limit 2
    ) t
  ),
  -- 10. 7-day treat counts
  'treats7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select treats_consumed
        from public.daily_logs
       where pet_id = me.pid and log_date >= p_seven_ago and log_date <= p_today
    ) t
  ),
  -- 11. 7-day treat scans (UTC-boundary timestamptz filter, as the client used)
  'treat_scans7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select ai_estimated_calories, is_treat
        from public.food_scans
       where pet_id = me.pid and is_treat = true and created_at >= p_seven_ago_utc
    ) t
  ),
  -- 12. 7-day completed-activity intensity rows
  'acts_intensity', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select intensity, duration_minutes, scheduled_date
        from public.activities
       where pet_id = me.pid and status = 'completed'
         and activity_type in ('walk', 'play', 'training')
         and scheduled_date >= p_seven_ago and scheduled_date <= p_today
    ) t
  ),
  -- 13. most recent food scan (churn detection)
  'food_last', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select created_at
        from public.food_scans
       where pet_id = me.pid
       order by created_at desc
       limit 1
    ) t
  ),
  -- 14. 28-day calorie logs (observed-MER back-fit)
  'logs28', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select calories_consumed, log_date
        from public.daily_logs
       where pet_id = me.pid and log_date >= p_twenty_eight_ago and log_date <= p_today
    ) t
  ),
  -- 15. 28-day weight time series (ascending)
  'weight_logs28', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select weight_kg, logged_at
        from public.weight_logs
       where pet_id = me.pid and logged_at >= p_twenty_eight_ago_utc
       order by logged_at asc
    ) t
  )
)
from (
  -- THE check, stated once. Same rule the four child tables' owner policies
  -- enforced per row: the caller owns this pet.
  select case
           when exists (
             select 1 from public.pets p
              where p.id = p_pet_id and p.owner_id = (select auth.uid())
           ) then p_pet_id
         end as pid
) me;
$$;

REVOKE ALL ON FUNCTION public.get_pet_dashboard(
  uuid, date, date, date, date, timestamptz, timestamptz, timestamptz
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pet_dashboard(
  uuid, date, date, date, date, timestamptz, timestamptz, timestamptz
) TO authenticated;

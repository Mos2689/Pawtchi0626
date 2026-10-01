-- Undo 20261002010000_pet_dashboard_definer.sql. Run in the SQL editor.
-- Restores the SECURITY INVOKER (RLS-checked) definition from
-- 20260827150001_dashboard_today_scans_limit.sql, verbatim, and its grants.

create or replace function public.get_pet_dashboard(
  p_pet_id uuid,
  p_today date,
  p_seven_ago date,
  p_fourteen_ago date,
  p_twenty_eight_ago date,
  p_day_start_utc timestamptz,
  p_seven_ago_utc timestamptz,
  p_twenty_eight_ago_utc timestamptz
) returns jsonb
language sql
stable
security invoker
as $$
select jsonb_build_object(
  -- refreshToday ── 1. today's daily_log (maybeSingle)
  'today_log', (
    select to_jsonb(t) from (
      select calories_consumed, water_ml, walks_count, treats_consumed
        from public.daily_logs
       where pet_id = p_pet_id and log_date = p_today
       limit 1
    ) t
  ),
  -- 2. today's food scans (newest first; cap high enough to total the day)
  'today_scans', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select id, ai_identified_food, ai_estimated_calories, created_at,
             is_treat, protein_g, carbs_g, fat_g, image_url
        from public.food_scans
       where pet_id = p_pet_id and created_at >= p_day_start_utc
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
       where pet_id = p_pet_id and scheduled_date = p_today and status = 'pending'
       order by scheduled_time asc
       limit 1
    ) t
  ),
  -- 4. today's walk/play/training rows (any status)
  'today_activities', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select duration_minutes, status
        from public.activities
       where pet_id = p_pet_id and scheduled_date = p_today
         and activity_type in ('walk', 'play', 'training')
    ) t
  ),
  -- refreshTrends ── 5. 7-day calorie logs
  'logs7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select calories_consumed, log_date
        from public.daily_logs
       where pet_id = p_pet_id and log_date >= p_seven_ago and log_date <= p_today
    ) t
  ),
  -- 6. completed activity minutes, this week
  'acts_this', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select duration_minutes
        from public.activities
       where pet_id = p_pet_id and status = 'completed'
         and activity_type in ('walk', 'play', 'training')
         and scheduled_date >= p_seven_ago and scheduled_date <= p_today
    ) t
  ),
  -- 7. completed activity, previous week
  'acts_last', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select duration_minutes, intensity, scheduled_date
        from public.activities
       where pet_id = p_pet_id and status = 'completed'
         and activity_type in ('walk', 'play', 'training')
         and scheduled_date >= p_fourteen_ago and scheduled_date < p_seven_ago
    ) t
  ),
  -- 8. 7-day water logs
  'water7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select water_ml
        from public.daily_logs
       where pet_id = p_pet_id and log_date >= p_seven_ago and log_date <= p_today
    ) t
  ),
  -- 9. latest two weight logs
  'weight2', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select weight_kg, logged_at
        from public.weight_logs
       where pet_id = p_pet_id
       order by logged_at desc
       limit 2
    ) t
  ),
  -- 10. 7-day treat counts
  'treats7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select treats_consumed
        from public.daily_logs
       where pet_id = p_pet_id and log_date >= p_seven_ago and log_date <= p_today
    ) t
  ),
  -- 11. 7-day treat scans (UTC-boundary timestamptz filter, as the client used)
  'treat_scans7', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select ai_estimated_calories, is_treat
        from public.food_scans
       where pet_id = p_pet_id and is_treat = true and created_at >= p_seven_ago_utc
    ) t
  ),
  -- 12. 7-day completed-activity intensity rows
  'acts_intensity', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select intensity, duration_minutes, scheduled_date
        from public.activities
       where pet_id = p_pet_id and status = 'completed'
         and activity_type in ('walk', 'play', 'training')
         and scheduled_date >= p_seven_ago and scheduled_date <= p_today
    ) t
  ),
  -- 13. most recent food scan (churn detection)
  'food_last', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select created_at
        from public.food_scans
       where pet_id = p_pet_id
       order by created_at desc
       limit 1
    ) t
  ),
  -- 14. 28-day calorie logs (observed-MER back-fit)
  'logs28', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select calories_consumed, log_date
        from public.daily_logs
       where pet_id = p_pet_id and log_date >= p_twenty_eight_ago and log_date <= p_today
    ) t
  ),
  -- 15. 28-day weight time series (ascending)
  'weight_logs28', (
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (
      select weight_kg, logged_at
        from public.weight_logs
       where pet_id = p_pet_id and logged_at >= p_twenty_eight_ago_utc
       order by logged_at asc
    ) t
  )
);
$$;

grant execute on function public.get_pet_dashboard(
  uuid, date, date, date, date, timestamptz, timestamptz, timestamptz
) to authenticated;

-- The original relied on default PUBLIC execute plus this grant; restore both.
grant execute on function public.get_pet_dashboard(
  uuid, date, date, date, date, timestamptz, timestamptz, timestamptz
) to public, anon;

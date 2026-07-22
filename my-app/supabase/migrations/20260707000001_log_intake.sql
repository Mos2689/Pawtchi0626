-- Atomic daily-log increment.
--
-- The clients used to SELECT calories_consumed, add the meal in JS, then
-- UPDATE — two quick logs (double-tap, retry, second device) could interleave
-- and silently lose calories/water/treats. This function makes the increment
-- a single atomic statement. SECURITY INVOKER so the caller's RLS policies on
-- daily_logs apply exactly as they do to the direct writes today.
--
-- The app calls this via supabase.rpc('log_intake', …) and falls back to the
-- original read-modify-write path when the function is missing, so deploying
-- this migration is safe in any order relative to the app release.

create or replace function public.log_intake(
  p_pet_id uuid,
  p_log_date date,
  p_kcal_delta integer default 0,
  p_treat_delta integer default 0,
  p_water_delta integer default 0,
  p_walk_delta integer default 0
) returns setof public.daily_logs
language plpgsql
security invoker
as $$
declare
  v_row public.daily_logs;
begin
  -- Atomic in-place increment (x = x + delta happens inside one statement).
  update public.daily_logs
     set calories_consumed = coalesce(calories_consumed, 0) + p_kcal_delta,
         treats_consumed   = coalesce(treats_consumed, 0)   + p_treat_delta,
         water_ml          = coalesce(water_ml, 0)          + p_water_delta,
         walks_count       = coalesce(walks_count, 0)       + p_walk_delta,
         updated_at        = now()
   where pet_id = p_pet_id
     and log_date = p_log_date
  returning * into v_row;

  if not found then
    begin
      insert into public.daily_logs
        (pet_id, log_date, calories_consumed, treats_consumed, water_ml, walks_count)
      values
        (p_pet_id, p_log_date, p_kcal_delta, p_treat_delta, p_water_delta, p_walk_delta)
      returning * into v_row;
    exception when unique_violation then
      -- Raced another first-log-of-the-day insert — increment the winner.
      update public.daily_logs
         set calories_consumed = coalesce(calories_consumed, 0) + p_kcal_delta,
             treats_consumed   = coalesce(treats_consumed, 0)   + p_treat_delta,
             water_ml          = coalesce(water_ml, 0)          + p_water_delta,
             walks_count       = coalesce(walks_count, 0)       + p_walk_delta,
             updated_at        = now()
       where pet_id = p_pet_id
         and log_date = p_log_date
      returning * into v_row;
    end;
  end if;

  return next v_row;
end
$$;

grant execute on function public.log_intake(uuid, date, integer, integer, integer, integer)
  to authenticated;

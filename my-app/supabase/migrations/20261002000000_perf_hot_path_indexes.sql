-- Indexes for the two hot read paths measured on 2026-10-01 (perf Train 1).
--
-- `activities` has 6,938 rows and no index usable by a per-pet query: its only
-- composite index is partial (`WHERE is_ai_generated = true`). Six of the 15
-- subqueries in get_pet_dashboard filter on (pet_id, scheduled_date), so every
-- dashboard call scanned the whole table six times (pg_stat_user_tables:
-- 2,550 sequential scans against 20 index scans). That dashboard runs on every
-- launch and averaged 1,046 ms on the server, with statement timeouts at 8 s.
--
-- `food_scans` is read per pet by created_at ("today's scans", "last scan"),
-- but its only per-pet indexes lead with log_date or is_treat.
--
-- The partial feeding index serves notify-dispatch's `next_meal` lookup, which
-- filters on the date alone and so cannot use an index that leads with pet_id.
--
-- Indexes only: no query, policy or result changes. The tables are small
-- (3.7 MB and 0.9 MB), so a plain CREATE INDEX takes milliseconds.
-- Rollback: supabase/rollbacks/20261002000000_perf_hot_path_indexes.down.sql

CREATE INDEX IF NOT EXISTS activities_pet_date_idx
  ON public.activities (pet_id, scheduled_date);

CREATE INDEX IF NOT EXISTS food_scans_pet_created_idx
  ON public.food_scans (pet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS activities_feeding_pending_date_idx
  ON public.activities (scheduled_date, pet_id, scheduled_time)
  WHERE status = 'pending' AND activity_type = 'feeding';

-- Fresh statistics for the planner. pet_milestones had never been analysed.
ANALYZE public.activities;
ANALYZE public.food_scans;
ANALYZE public.pet_milestones;

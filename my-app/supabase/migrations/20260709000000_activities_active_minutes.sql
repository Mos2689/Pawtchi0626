-- Tracked walks: minutes the dog actually MOVED (GPS moving time), distinct
-- from duration_minutes (elapsed wall-clock, what timelines display).
-- Calorie derivations must prefer active_minutes when present — a stationary
-- or drift-heavy session elapses time without burning anything.
-- Null for manual logs and non-walk rows.
alter table public.activities
  add column if not exists active_minutes integer;

comment on column public.activities.active_minutes is
  'Tracked walks only: GPS moving time in minutes. Prefer over duration_minutes for kcal math; duration_minutes stays elapsed time for display.';

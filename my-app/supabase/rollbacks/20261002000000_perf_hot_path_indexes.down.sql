-- Undo 20261002000000_perf_hot_path_indexes.sql. Run in the SQL editor.
DROP INDEX IF EXISTS public.activities_pet_date_idx;
DROP INDEX IF EXISTS public.food_scans_pet_created_idx;
DROP INDEX IF EXISTS public.activities_feeding_pending_date_idx;

-- Undo 20261002030000_stale_walk_watch.sql. Run in the SQL editor.
SELECT cron.unschedule('community-stale-walk-watch');
DROP FUNCTION IF EXISTS public.watch_stale_community_walks();
DROP TABLE IF EXISTS public.community_stale_walk_watch;

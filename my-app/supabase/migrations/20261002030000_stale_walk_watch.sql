-- Watch for meetups that stay "active" after everyone has stopped (perf Train 1,
-- LOG-ONLY). Nothing here changes a walk.
--
-- A walk becomes `completed` only when the host's close request reaches the
-- server. If that request never lands (dead phone, uninstall, network gone),
-- nothing server-side ever closes it. `community_trails_for_me` then shows it
-- as "WALKING NOW" to the whole pack indefinitely.
--
-- Before any automatic close, this records what a closer WOULD close, so a
-- week of real data can confirm the threshold does not catch genuine long
-- walks: active walks with no live position, attendance change or start in the
-- last 3 hours. An hourly job (minute 27, off the notification minutes)
-- upserts them into `community_stale_walk_watch`. Turning it into a real
-- close is a separate, later migration.
--
-- Rollback: supabase/rollbacks/20261002030000_stale_walk_watch.down.sql

CREATE TABLE IF NOT EXISTS public.community_stale_walk_watch (
  walk_id          UUID PRIMARY KEY REFERENCES public.community_walks(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ NOT NULL,
  first_flagged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_flagged_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  times_flagged    INTEGER NOT NULL DEFAULT 1,
  resolved_at      TIMESTAMPTZ
);

COMMENT ON TABLE public.community_stale_walk_watch IS
  'Log-only watch: active community walks with no activity for 3 h, recorded hourly before any automatic close exists. RLS on with no policies on purpose: service role only.';

ALTER TABLE public.community_stale_walk_watch ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.watch_stale_community_walks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flagged INTEGER;
BEGIN
  WITH activity AS (
    SELECT w.id, w.started_at,
           GREATEST(
             COALESCE(w.started_at, w.updated_at, w.created_at),
             COALESCE((SELECT max(l.recorded_at) FROM community_live_locations l WHERE l.walk_id = w.id), '-infinity'),
             COALESCE((SELECT max(a.updated_at)  FROM community_walk_attendance a WHERE a.walk_id = w.id), '-infinity')
           ) AS last_activity_at
      FROM community_walks w
     WHERE w.state = 'active'
  )
  INSERT INTO community_stale_walk_watch AS s (walk_id, started_at, last_activity_at)
  SELECT id, started_at, last_activity_at
    FROM activity
   WHERE last_activity_at < now() - interval '3 hours'
  ON CONFLICT (walk_id) DO UPDATE
     SET last_activity_at = EXCLUDED.last_activity_at,
         last_flagged_at  = now(),
         times_flagged    = s.times_flagged + 1,
         resolved_at      = NULL;
  GET DIAGNOSTICS flagged = ROW_COUNT;

  -- A flagged walk that has since closed or woken up is marked resolved, so
  -- the log shows how long stuck walks actually stay stuck.
  UPDATE community_stale_walk_watch s
     SET resolved_at = now()
   WHERE s.resolved_at IS NULL
     AND s.last_flagged_at < now() - interval '50 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM community_walks w
        WHERE w.id = s.walk_id AND w.state = 'active'
     );

  RETURN flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.watch_stale_community_walks() FROM PUBLIC, anon, authenticated;

-- Hourly, on a minute no other job uses (see 20261002020000).
SELECT cron.schedule(
  'community-stale-walk-watch',
  '27 * * * *',
  $cron$SELECT public.watch_stale_community_walks();$cron$
);

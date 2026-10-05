-- Undo 20261004000000_live_walk_privacy_and_rpc.sql — PARTIALLY, on purpose.
-- Run in the SQL editor.
--
-- What this removes: the two cleanup triggers (if deleting positions on
-- close/finish ever misbehaves) and the watcher's switch to heard_at.
--
-- What it deliberately KEEPS:
--   * the corrected policies and the private helpers. Restoring the old
--     policies would reopen the privacy bug (any pack member attending any
--     active walk could read every walk's live positions in their pack);
--   * begin_live_session, publish_live_location, live_walk_positions, the new
--     columns, private.live_sessions and private.live_session_tokens. A build
--     that publishes through the RPC breaks without them. Remove them only
--     after every such build is retired (the plan's "teardown").
--
-- The heard_at stamping trigger stays too: it only keeps a column honest.

BEGIN;

DROP TRIGGER IF EXISTS community_walk_live_cleanup ON public.community_walks;
DROP TRIGGER IF EXISTS community_attendance_live_cleanup ON public.community_walk_attendance;
DROP TRIGGER IF EXISTS community_attendance_live_cleanup_delete ON public.community_walk_attendance;
DROP FUNCTION IF EXISTS private.clear_live_walk();
DROP FUNCTION IF EXISTS private.clear_live_attendee();

-- The watcher as 20261002030000 left it (GPS recorded_at as the live signal).
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

COMMIT;

-- ── Full teardown (NOT part of a rollback) ─────────────────────────────────
-- Only once no installed build calls the RPCs. Even then, keep the corrected
-- policies; never restore the 20260917000000 versions.
--
--   DROP FUNCTION IF EXISTS public.live_walk_positions(UUID);
--   DROP FUNCTION IF EXISTS public.publish_live_location(UUID, INTEGER, BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, JSONB);
--   DROP FUNCTION IF EXISTS public.begin_live_session(UUID, UUID);
--   DROP FUNCTION IF EXISTS private.live_refusal(UUID);
--   DROP TABLE IF EXISTS private.live_session_tokens;
--   DROP TABLE IF EXISTS private.live_sessions;
--   ALTER TABLE public.community_live_locations
--     DROP CONSTRAINT IF EXISTS community_live_locations_gen_seq,
--     DROP CONSTRAINT IF EXISTS community_live_locations_gen_range,
--     DROP CONSTRAINT IF EXISTS community_live_locations_seq_range,
--     DROP CONSTRAINT IF EXISTS community_live_locations_route_version_range,
--     DROP COLUMN IF EXISTS live_gen, DROP COLUMN IF EXISTS seq,
--     DROP COLUMN IF EXISTS fix_at, DROP COLUMN IF EXISTS obs_at,
--     DROP COLUMN IF EXISTS sent_at, DROP COLUMN IF EXISTS route_version;

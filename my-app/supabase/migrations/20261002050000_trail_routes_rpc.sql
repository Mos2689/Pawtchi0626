-- community_trail_routes: Home's trail lines in one request (perf Train 2, audit E4).
--
-- Home draws one line per meetup: a route from its most recent completed walk.
-- That took three requests in series (completed walks → their linked sessions
-- → the sessions' routes), downloaded EVERY walker's route for each of those
-- walks when one per trail is drawn, and capped the first hop at the 60 most
-- recent completed walks across all trails — so a quiet trail behind busier
-- ones simply lost its line.
--
-- Same answer, one request: the latest completed walk per pack (DISTINCT ON),
-- then the first linked session on it with more than one point.
--
-- SECURITY INVOKER on purpose: the caller's own RLS applies to all three
-- tables exactly as it did to the three client reads (walks: pack members;
-- links: can_access_community_walk; routes: the owner, or someone who took
-- part — 20260923000000). No new authorisation surface, so nothing to restate.
--
-- ADDITIVE: a new function only. The app calls it and falls back to the three
-- reads on any error (lib/communityWalks.ts listTrailRoutes), so either order
-- of deploy is safe.
--
-- Rollback: supabase/rollbacks/20261002050000_trail_routes_rpc.down.sql

CREATE OR REPLACE FUNCTION public.community_trail_routes(p_pack_ids UUID[])
RETURNS TABLE (pack_id UUID, route JSONB)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH latest AS (
    SELECT DISTINCT ON (w.pack_id) w.pack_id, w.id
      FROM public.community_walks w
     WHERE w.pack_id = ANY (p_pack_ids)
       AND w.state = 'completed'
     ORDER BY w.pack_id, w.ended_at DESC NULLS LAST, w.id
  )
  SELECT latest.pack_id, chosen.route
    FROM latest
    CROSS JOIN LATERAL (
      SELECT ws.route
        FROM public.community_walk_sessions linked
        JOIN public.walk_sessions ws ON ws.id = linked.walk_session_id
       WHERE linked.walk_id = latest.id
         -- CASE, not AND: SQL does not promise to test the type first, and
         -- jsonb_array_length raises on anything that is not an array.
         AND CASE WHEN jsonb_typeof(ws.route) = 'array' THEN jsonb_array_length(ws.route) ELSE 0 END > 1
       ORDER BY linked.linked_at, linked.walk_session_id
       LIMIT 1
    ) chosen;
$$;

REVOKE ALL ON FUNCTION public.community_trail_routes(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_trail_routes(UUID[]) TO authenticated;

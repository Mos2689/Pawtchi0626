-- Meetup screen, "Our walks" as cards (Oct 2026).
--
-- One read for the whole archive section: each completed walk of a meetup,
-- newest first, with what its card draws — a cover photo, how many photos and
-- walkers, the longest leg's distance and duration, and one thinned route per
-- walker (≤60 points each; walk_sessions.route is already ≤200).
--
-- SECURITY INVOKER, like community_trail_routes: everything is read under the
-- caller's own RLS, so a non-member gets nothing and a member sees exactly the
-- photos and routes they could already open in the walk's memory. Additive and
-- read-only; the client falls back to plain rows when this is missing.
-- Rollback: supabase/rollbacks/20261007000000_pack_walk_cards.down.sql

CREATE OR REPLACE FUNCTION public.community_pack_walk_cards(p_pack_id UUID, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
  walk_id UUID,
  cover_path TEXT,
  photo_count INTEGER,
  walker_count INTEGER,
  distance_m NUMERIC,
  duration_s INTEGER,
  routes JSONB
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH done AS (
    SELECT w.id, w.ended_at
      FROM public.community_walks w
     WHERE w.pack_id = p_pack_id
       AND w.state = 'completed'
     ORDER BY w.ended_at DESC NULLS LAST, w.id
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 40)
  )
  SELECT
    d.id,
    (SELECT m.display_path
       FROM public.community_shared_media m
      WHERE m.walk_id = d.id
        AND m.removed_at IS NULL
        AND m.display_path IS NOT NULL
      ORDER BY m.captured_at, m.id
      LIMIT 1),
    (SELECT count(*)::INTEGER
       FROM public.community_shared_media m
      WHERE m.walk_id = d.id
        AND m.removed_at IS NULL),
    (SELECT count(DISTINCT a.user_id)::INTEGER
       FROM public.community_walk_attendance a
      WHERE a.walk_id = d.id
        AND a.status IN ('walking', 'finished')),
    legs.distance_m,
    legs.duration_s,
    COALESCE(legs.routes, '[]'::JSONB)
  FROM done d
  LEFT JOIN LATERAL (
    SELECT max(ws.distance_m) AS distance_m,
           max(ws.duration_s) AS duration_s,
           jsonb_agg(thin.route ORDER BY ws.started_at, ws.id) FILTER (WHERE thin.route IS NOT NULL) AS routes
      FROM (
        -- One leg per walker: the first they linked.
        SELECT DISTINCT ON (linked.user_id) linked.user_id, linked.walk_session_id
          FROM public.community_walk_sessions linked
         WHERE linked.walk_id = d.id
         ORDER BY linked.user_id, linked.linked_at, linked.walk_session_id
         LIMIT 8
      ) leg
      JOIN public.walk_sessions ws ON ws.id = leg.walk_session_id
      CROSS JOIN LATERAL (
        SELECT CASE WHEN jsonb_typeof(ws.route) = 'array' THEN ws.route ELSE '[]'::JSONB END AS r
      ) src
      CROSS JOIN LATERAL (
        SELECT jsonb_array_length(src.r) AS n
      ) len
      CROSS JOIN LATERAL (
        -- Every k-th point plus the last, so a card's line ends where the walk did.
        SELECT CASE WHEN len.n > 1 THEN jsonb_agg(p.elem ORDER BY p.idx) END AS route
          FROM jsonb_array_elements(src.r) WITH ORDINALITY AS p(elem, idx)
         WHERE (p.idx - 1) % GREATEST(1, ceil(len.n / 60.0)::INTEGER) = 0
            OR p.idx = len.n
      ) thin
  ) legs ON true
  ORDER BY d.ended_at DESC NULLS LAST, d.id;
$$;

REVOKE ALL ON FUNCTION public.community_pack_walk_cards(UUID, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_pack_walk_cards(UUID, INTEGER) TO authenticated;

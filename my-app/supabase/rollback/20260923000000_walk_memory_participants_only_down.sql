-- Down for 20260923000000_walk_memory_participants_only.
--
-- Restores pack-wide access to routes, shared photos and the memory screen.
-- Bodies copied verbatim from 20260917000000 and 20260922010000.
--
-- Note what reverting means: every member of a pack can again read the full
-- `walk_sessions` row — polyline, pace, stops, place names — for every walk
-- that pack has taken, including ones they were not on. Revert only if the
-- narrower rule is actually breaking something, and prefer fixing the rule.

DROP POLICY IF EXISTS community_members_read_linked_personal_walks ON public.walk_sessions;
CREATE POLICY community_members_read_linked_personal_walks ON public.walk_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_walk_sessions linked
      WHERE linked.walk_session_id = walk_sessions.id
        AND public.can_access_community_walk(linked.walk_id, (select auth.uid()))
    )
  );

DROP POLICY IF EXISTS community_media_read_pack ON public.community_shared_media;
CREATE POLICY community_media_read_pack ON public.community_shared_media
  FOR SELECT TO authenticated
  USING (
    (public.can_access_community_walk(walk_id, (select auth.uid())) AND removed_at IS NULL) OR
    contributor_id = (select auth.uid())
  );

CREATE OR REPLACE FUNCTION public.community_memory(p_walk_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT public.can_access_community_walk(p_walk_id, v_user) THEN
    RAISE EXCEPTION 'walk_access_denied';
  END IF;

  RETURN jsonb_build_object(
    'outing', public.community_outing(p_walk_id),
    'moments', (
      SELECT coalesce(jsonb_agg(to_jsonb(sm) || jsonb_build_object(
        'heartCount', (
          SELECT count(*) FROM public.community_media_hearts h WHERE h.media_id = sm.id
        ),
        'heartedByMe', EXISTS (
          SELECT 1 FROM public.community_media_hearts h
          WHERE h.media_id = sm.id AND h.user_id = v_user
        )
      ) ORDER BY sm.captured_at), '[]'::jsonb)
      FROM public.community_shared_media sm
      WHERE sm.walk_id = p_walk_id AND sm.removed_at IS NULL
    ),
    'sessions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'user_id', cws.user_id,
        'walk_session_id', cws.walk_session_id,
        'route', ws.route,
        'distance_m', ws.distance_m,
        'duration_s', ws.duration_s,
        'sniff_points', ws.sniff_points
      )), '[]'::jsonb)
      FROM public.community_walk_sessions cws
      LEFT JOIN public.walk_sessions ws ON ws.id = cws.walk_session_id
      WHERE cws.walk_id = p_walk_id
    )
  );
END;
$$;

DROP FUNCTION IF EXISTS public.took_part_in_community_walk(UUID, UUID);

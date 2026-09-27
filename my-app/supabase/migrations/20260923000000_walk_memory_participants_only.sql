-- A walk's memory belongs to the people who walked it, not to the whole pack.
--
-- ── What changes ───────────────────────────────────────────────────────────
--
-- Being in a pack currently grants you every linked route and every shared
-- photo from every walk that pack has ever taken, whether or not you were
-- there. `can_access_community_walk` is pure pack membership, and the memory
-- path leans on it in three places.
--
-- A recorded route is not a light thing to hand over. Through
-- `community_members_read_linked_personal_walks` it carries the whole
-- `walk_sessions` row: the polyline, the pace, where the walker stopped and for
-- how long, and the reverse-geocoded names of where they started and finished.
-- Somebody who did not come on the walk has no particular claim to that.
--
-- After this migration, three reads require having TAKEN PART:
--
--   1. linked personal walks  (the routes)
--   2. community_shared_media (the photos)
--   3. community_memory()     (the screen that shows both)
--
-- ── What deliberately does NOT change ──────────────────────────────────────
--
-- Walk existence, the meeting point, the time and the roster stay readable by
-- the pack. That is not an oversight. `create_community_walk` notifies every
-- member that a walk has been planned, and the product is that anyone in a
-- private pack can see it and decide to come. Narrowing visibility would mean
-- telling five people about a walk that four of them cannot then open.
--
-- The sensitive data is the route and the photographs. That is what moves.
--
-- ── Why this predicate ─────────────────────────────────────────────────────
--
-- `community_locations_read_attendees` already decides who may watch live
-- positions, and it uses exactly this status set. Reusing it means there is one
-- definition of "took part in this walk" rather than two that can drift.
--
-- 'coming' counts. Somebody who said they were coming and whose phone died on
-- the way still took part in the arrangement, and excluding them would make the
-- rule about whether the recorder worked rather than whether they were there.
--
-- 'invited' and 'cant_make_it' do not count. The host is covered: an attendance
-- row of 'coming' is written for them by `create_community_walk`.

CREATE OR REPLACE FUNCTION public.took_part_in_community_walk(
  p_walk_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Served by community_walk_attendance's primary key (walk_id, user_id), so
  -- this is an index lookup no matter how large the table gets.
  SELECT EXISTS (
    SELECT 1
    FROM public.community_walk_attendance a
    WHERE a.walk_id = p_walk_id
      AND a.user_id = p_user_id
      AND a.status IN ('coming', 'checked_in', 'walking', 'finished')
  );
$$;

REVOKE ALL ON FUNCTION public.took_part_in_community_walk(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.took_part_in_community_walk(UUID, UUID) TO authenticated;

-- ── 1. The routes ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS community_members_read_linked_personal_walks ON public.walk_sessions;
CREATE POLICY community_members_read_linked_personal_walks ON public.walk_sessions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_walk_sessions linked
      WHERE linked.walk_session_id = walk_sessions.id
        AND public.took_part_in_community_walk(linked.walk_id, (select auth.uid()))
    )
  );

-- ── 2. The photos ──────────────────────────────────────────────────────────
--
-- The `contributor_id` arm stays. Your own photograph is yours to see whatever
-- else is true, including after you leave the pack.
DROP POLICY IF EXISTS community_media_read_pack ON public.community_shared_media;
CREATE POLICY community_media_read_pack ON public.community_shared_media
  FOR SELECT TO authenticated
  USING (
    (public.took_part_in_community_walk(walk_id, (select auth.uid())) AND removed_at IS NULL) OR
    contributor_id = (select auth.uid())
  );

-- ── 3. The memory screen ───────────────────────────────────────────────────
--
-- SECURITY DEFINER, so RLS does not apply to it and it has to make the same
-- decision itself. Raises a DISTINCT error from `walk_access_denied`: a pack
-- member who simply did not come on this walk is not an authorisation failure
-- to be shown as one, and the client turns this into a sentence rather than an
-- error. See app/community/walk/[walkId]/memory.tsx.
-- Body copied VERBATIM from 20260922010000. The only edit is the second IF.
-- Retyping a function body from memory is how you silently rename `sessions` to
-- `traces` and break every screen that reads it.
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
  -- ADDED: the walk's memory is for the people who were on it.
  IF NOT public.took_part_in_community_walk(p_walk_id, v_user) THEN
    RAISE EXCEPTION 'walk_not_attended';
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

REVOKE ALL ON FUNCTION public.community_memory(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_memory(UUID) TO authenticated;

-- Invite part of the pack to one walk.
--
-- ── What this adds ─────────────────────────────────────────────────────────
--
-- A trail's pack is who you walk with. A walk's attendance is who is coming
-- *this time*, and the two were never the same thing — not everyone is free
-- every week. The schema already knew this: community_walk_attendance.status
-- has carried an `invited` value since day one, and it is even the column
-- default. Nothing has ever written it. create_community_walk inserts exactly
-- one row, for the organiser, as `coming`.
--
-- The reason nothing wrote it is RLS. `community_attendance_write_self` allows
-- an INSERT only where `user_id = auth.uid()`, which is correct — nobody should
-- be able to mark someone else as coming — but it also means a host cannot ask
-- anyone. This function is the narrow exception: it writes `invited` and only
-- `invited`, only for people already in the pack, and only for the organiser of
-- that walk.
--
-- ── Invitation is an ask, not a gate ───────────────────────────────────────
--
-- An uninvited pack member still sees the walk on their trail and can still
-- join it. Being invited means "we asked you", not "you are allowed" — a trail
-- is a group of friends, and a walk that some of them cannot see would be a
-- strange thing to find in one. The RLS below is unchanged and still scopes
-- every walk to the whole pack.
--
-- ── Who gets told ──────────────────────────────────────────────────────────
--
-- Only the people invited. create_community_walk is replaced here to drop its
-- blanket notification to the entire pack: with a subset invited, that
-- notification would double up on everyone asked and pester everyone not. You
-- hear about a walk when someone asks you to come; otherwise it is simply on
-- the trail next time you look.
--
-- Every column reference is table-qualified — see the 42702 ambiguity that took
-- lookup_community_username out of service for every user.

CREATE OR REPLACE FUNCTION public.invite_to_community_walk(p_walk_id UUID, p_user_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_walk public.community_walks;
  v_pack_name TEXT;
  v_new UUID[];
BEGIN
  SELECT * INTO v_walk FROM public.community_walks w WHERE w.id = p_walk_id;
  IF NOT FOUND OR v_walk.organizer_id <> v_user THEN
    RAISE EXCEPTION 'walk_organizer_required';
  END IF;
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  SELECT p.name INTO v_pack_name FROM public.community_packs p WHERE p.id = v_walk.pack_id;

  -- ON CONFLICT DO NOTHING is load-bearing: re-inviting must never overwrite an
  -- answer. Someone who already said they cannot make it stays that way rather
  -- than being quietly reset to unanswered.
  WITH eligible AS (
    SELECT m.user_id
    FROM public.community_pack_members m
    WHERE m.pack_id = v_walk.pack_id
      AND m.user_id = ANY(p_user_ids)
      AND m.user_id <> v_user
  ), inserted AS (
    INSERT INTO public.community_walk_attendance (walk_id, user_id, status)
    SELECT p_walk_id, e.user_id, 'invited' FROM eligible e
    ON CONFLICT (walk_id, user_id) DO NOTHING
    RETURNING community_walk_attendance.user_id
  )
  SELECT array_agg(inserted.user_id) INTO v_new FROM inserted;

  IF v_new IS NULL THEN
    RETURN 0;
  END IF;

  PERFORM public.enqueue_community_notification(
    target.user_id,
    'community_walk_change',
    v_walk.pack_id,
    v_walk.id,
    coalesce(v_pack_name, 'Your trail') || ' has a walk for you',
    v_walk.title || ' · ' || v_walk.meeting_label,
    '/community/walk/' || v_walk.id::TEXT,
    'community_walk_invited:' || v_walk.id::TEXT || ':' || target.user_id::TEXT
  )
  FROM unnest(v_new) AS target(user_id);

  RETURN array_length(v_new, 1);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.invite_to_community_walk(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_to_community_walk(UUID, UUID[]) TO authenticated;

-- Replaced only to remove the blanket notification; the rest is byte-identical
-- to 20260917000000. The organiser is still seated as `coming`, because the
-- person planning a walk is coming to it.
CREATE OR REPLACE FUNCTION public.create_community_walk(
  p_pack_id UUID,
  p_title TEXT,
  p_scheduled_for TIMESTAMPTZ,
  p_meeting_label TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.community_walks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_walk public.community_walks;
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, v_user) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  INSERT INTO public.community_walks (pack_id, organizer_id, title, scheduled_for, meeting_label, note)
    VALUES (p_pack_id, v_user, trim(p_title), p_scheduled_for, trim(p_meeting_label), nullif(trim(p_note), ''))
    RETURNING * INTO v_walk;
  INSERT INTO public.community_walk_attendance (walk_id, user_id, status)
    VALUES (v_walk.id, v_user, 'coming');
  -- No pack-wide notification. invite_to_community_walk tells the people who
  -- were actually asked; anyone else finds the walk on the trail.
  RETURN v_walk;
END;
$$;

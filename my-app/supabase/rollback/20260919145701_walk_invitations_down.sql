-- Teardown for 20260919145701_walk_invitations.
--
-- ⚠ NOT A MIGRATION. Lives outside supabase/migrations/ so `supabase db push`
-- can never pick it up. Run it deliberately.
--
-- Two things to undo, and only one of them is a drop.
--
-- 1. invite_to_community_walk goes entirely. Attendance rows it created are
--    left alone: they are real answers from real people, and `invited` is a
--    valid status that predates this migration. The walk screen renders them
--    as "waiting for an answer" either way.
--
-- 2. create_community_walk is restored to its 20260917000000 body, which
--    notifies the whole pack when a walk is created. Without this the function
--    would keep its trimmed version while nothing existed to invite anyone,
--    and a new walk would notify nobody at all.

BEGIN;

DROP FUNCTION IF EXISTS public.invite_to_community_walk(UUID, UUID[]);

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
  PERFORM public.enqueue_community_notification(
    member.user_id,
    'community_walk_change',
    p_pack_id,
    v_walk.id,
    (SELECT name FROM public.community_packs WHERE id = p_pack_id) || ' has a new walk',
    trim(p_title) || ' · ' || trim(p_meeting_label),
    '/community/walk/' || v_walk.id::TEXT,
    'community_walk_created:' || v_walk.id::TEXT || ':' || member.user_id::TEXT
  )
  FROM public.community_pack_members member
  WHERE member.pack_id = p_pack_id AND member.user_id <> v_user;
  RETURN v_walk;
END;
$$;

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect 0 for the first, 1 for the second.
--
--   SELECT
--     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--        WHERE n.nspname='public' AND p.proname='invite_to_community_walk') AS dropped,
--     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--        WHERE n.nspname='public' AND p.proname='create_community_walk')    AS restored;

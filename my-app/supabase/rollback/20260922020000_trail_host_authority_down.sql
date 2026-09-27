-- Teardown for 20260922020000_trail_host_authority.
--
-- ⚠ NOT A MIGRATION. Lives outside supabase/migrations/ so `supabase db push`
-- can never pick it up. Run it deliberately.
--
-- This restores the OLD permission model: any pack member could plan a walk,
-- start it, end it, edit the plan and invite people, and a member could rejoin
-- a walk after it closed. That is a genuine widening of who can do what — if
-- you are running this to fix a bug, be sure the bug is worth it.
--
-- The four function bodies below are the pre-20260922020000 versions, restored
-- verbatim. Only their gate differs from the current ones.

BEGIN;

-- ── Policies ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS community_walks_update_host ON public.community_walks;
CREATE POLICY community_walks_update_organizer ON public.community_walks
  FOR UPDATE TO authenticated
  USING (organizer_id = (select auth.uid()))
  WITH CHECK (
    organizer_id = (select auth.uid())
    AND public.is_community_pack_member(pack_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS community_attendance_update_self ON public.community_walk_attendance;
CREATE POLICY community_attendance_update_self ON public.community_walk_attendance
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.can_access_community_walk(walk_id, (select auth.uid()))
  );

DROP POLICY IF EXISTS community_attendance_write_self ON public.community_walk_attendance;
CREATE POLICY community_attendance_write_self ON public.community_walk_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.can_access_community_walk(walk_id, (select auth.uid()))
  );

-- Dropped after the policies that read it, not before.
DROP FUNCTION IF EXISTS public.community_walk_is_open(UUID);

-- ── RPCs, back to the membership gate ───────────────────────────────────────
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
  RETURN v_walk;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_community_username(p_pack_id UUID, p_username TEXT)
RETURNS public.community_pack_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inviter UUID := auth.uid();
  v_invitee UUID;
  v_invite public.community_pack_invitations;
  v_recent INTEGER;
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, v_inviter) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  SELECT id INTO v_invitee FROM public.profiles
    WHERE lower(username) = lower(trim(leading '@' from trim(p_username)));
  IF v_invitee IS NULL OR v_invitee = v_inviter THEN RAISE EXCEPTION 'username_not_found'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.community_user_blocks b
    WHERE (b.blocker_id = v_inviter AND b.blocked_id = v_invitee)
       OR (b.blocker_id = v_invitee AND b.blocked_id = v_inviter)
  ) THEN RAISE EXCEPTION 'username_not_found'; END IF;
  IF public.is_community_pack_member(p_pack_id, v_invitee) THEN RAISE EXCEPTION 'already_a_member'; END IF;
  SELECT count(*) INTO v_recent FROM public.community_pack_invitations
    WHERE inviter_id = v_inviter AND created_at > now() - interval '1 hour';
  IF v_recent >= 12 THEN RAISE EXCEPTION 'invite_rate_limited'; END IF;
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE pack_id = p_pack_id AND invitee_id = v_invitee AND state = 'pending' AND expires_at > now()
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN RETURN v_invite; END IF;
  INSERT INTO public.community_pack_invitations (pack_id, inviter_id, invitee_id)
    VALUES (p_pack_id, v_inviter, v_invitee) RETURNING * INTO v_invite;
  PERFORM public.enqueue_community_notification(
    v_invitee,
    'community_invite',
    p_pack_id,
    NULL,
    coalesce((SELECT full_name FROM public.profiles WHERE id = v_inviter), 'A friend') || ' invited you',
    'Meet the dogs in ' || (SELECT name FROM public.community_packs WHERE id = p_pack_id) || ' and decide whether to join.',
    '/(tabs)/community',
    'community_invite:' || v_invite.id::TEXT
  );
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_external_community_invite(p_pack_id UUID)
RETURNS public.community_pack_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_inviter UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, v_inviter) THEN RAISE EXCEPTION 'pack_access_denied'; END IF;
  INSERT INTO public.community_pack_invitations (pack_id, inviter_id)
    VALUES (p_pack_id, v_inviter) RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

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

COMMIT;

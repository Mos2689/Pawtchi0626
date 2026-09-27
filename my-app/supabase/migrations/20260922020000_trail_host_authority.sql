-- A trail has a host, and the host runs it.
--
-- ── What changes ────────────────────────────────────────────────────────────
--
-- Planning a walk, starting it, ending it, editing the plan, and inviting
-- people were all open to ANY pack member. They now belong to the trail's
-- owner alone. What stays with a member is everything that is genuinely about
-- them: answering whether they are coming, joining a walk that is live,
-- recording their own leg of it, and finishing it.
--
-- ── Why owner rather than organiser ─────────────────────────────────────────
--
-- The old rule was `organizer_id = auth.uid()` — whoever created the walk
-- controlled it. With creation restricted to the owner those two collapse into
-- one thing going forward, but they are NOT the same for walks that already
-- exist, so the checks below are all written against the pack's owner rather
-- than the walk's organiser. Ownership is the durable fact; who happened to
-- press the button is not.
--
-- Production has exactly one walk organised by a member and it is completed,
-- so nothing in flight changes hands. `organizer_id` on that row is left
-- alone: it is a true record of who planned it, and rewriting history to tidy
-- an invariant would make the memory screen say something that did not happen.
--
-- ── The one thing deliberately NOT gated on walk state ─────────────────────
--
-- Shared photos. Captures upload when the CONTRIBUTOR's own recording saves,
-- which is routinely after the host has closed the walk — 7 of the 8 photos in
-- production landed after their walk's `ended_at`, up to 13.6 seconds later.
-- Requiring the walk to be open in order to publish would have rejected almost
-- every real photo. The existing contributor check is what matters there and
-- it is untouched.

-- ── Is this walk still running? ─────────────────────────────────────────────
--
-- A helper rather than an inline EXISTS, because it is read from a policy on
-- every attendance write and one definition is easier to keep honest than
-- three copies. 'cancelled' counts as closed for the same reason 'completed'
-- does: there is nothing left to join.
CREATE OR REPLACE FUNCTION public.community_walk_is_open(p_walk_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.community_walks w
    WHERE w.id = p_walk_id AND w.state IN ('planned', 'active')
  );
$$;
REVOKE ALL ON FUNCTION public.community_walk_is_open(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_walk_is_open(UUID) TO authenticated;

-- ── 1. Start, end and edit the plan ─────────────────────────────────────────
--
-- These are direct table updates from the client rather than RPCs, so this
-- policy IS the permission. Renamed as well as rewritten: a policy called
-- `_update_organizer` that checks the owner would send the next reader looking
-- for a bug that is not there.
DROP POLICY IF EXISTS community_walks_update_organizer ON public.community_walks;
DROP POLICY IF EXISTS community_walks_update_host ON public.community_walks;
CREATE POLICY community_walks_update_host ON public.community_walks
  FOR UPDATE TO authenticated
  USING (public.is_community_pack_owner(pack_id, (select auth.uid())))
  WITH CHECK (public.is_community_pack_owner(pack_id, (select auth.uid())));

-- ── 2. A member cannot rejoin a walk that is over ───────────────────────────
--
-- `finished` is deliberately still allowed after the close, and that exception
-- is load-bearing: when the host ends the walk, every member still recording
-- auto-finishes, and that write lands AFTER the state changed. Without this
-- their leg would be stuck on `walking` for ever and the roster would show
-- somebody still out there.
--
-- Everything else — checking in, going back to `walking`, re-RSVPing — is
-- refused once the walk is closed. That is the "they cannot continue" rule,
-- enforced where it cannot be talked out of.
DROP POLICY IF EXISTS community_attendance_update_self ON public.community_walk_attendance;
CREATE POLICY community_attendance_update_self ON public.community_walk_attendance
  FOR UPDATE TO authenticated
  USING (user_id = (select auth.uid()))
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.can_access_community_walk(walk_id, (select auth.uid()))
    AND (public.community_walk_is_open(walk_id) OR status = 'finished')
  );

-- The same rule on INSERT. Attendance rows are created lazily, so somebody who
-- never answered has no row at all — without this they could insert themselves
-- straight into `walking` on a walk that finished last week.
DROP POLICY IF EXISTS community_attendance_write_self ON public.community_walk_attendance;
CREATE POLICY community_attendance_write_self ON public.community_walk_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (select auth.uid())
    AND public.can_access_community_walk(walk_id, (select auth.uid()))
    AND (public.community_walk_is_open(walk_id) OR status = 'finished')
  );

-- ── 3, 4, 5. The three RPCs that gated on membership ───────────────────────
--
-- Each body below is the DEPLOYED body, copied verbatim from
-- pg_get_functiondef, with exactly one line changed:
--
--     is_community_pack_member(...)  →  is_community_pack_owner(...)
--     'pack_access_denied'           →  'pack_host_required'
--
-- Written out in full rather than reconstructed from the older migration
-- files, because reconstructing is how you lose a clause. A first draft of
-- this migration rebuilt invite_community_username from memory and silently
-- dropped its idempotency check — the SELECT that returns an existing pending
-- invitation instead of issuing a second one — and rewrote its notification
-- copy and route along the way. Nothing would have failed; it would just have
-- started sending people duplicate invitations.

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
  IF NOT public.is_community_pack_owner(p_pack_id, v_user) THEN RAISE EXCEPTION 'pack_host_required'; END IF;
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
  IF NOT public.is_community_pack_owner(p_pack_id, v_inviter) THEN RAISE EXCEPTION 'pack_host_required'; END IF;
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
  IF NOT public.is_community_pack_owner(p_pack_id, v_inviter) THEN RAISE EXCEPTION 'pack_host_required'; END IF;
  INSERT INTO public.community_pack_invitations (pack_id, inviter_id)
    VALUES (p_pack_id, v_inviter) RETURNING * INTO v_invite;
  RETURN v_invite;
END;
$$;

-- ── 6. Asking pack members to a specific walk ───────────────────────────────
-- Body otherwise identical to 20260919145701; the organiser check becomes an
-- owner check, which for every walk created from now on is the same person.
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
  IF NOT FOUND OR NOT public.is_community_pack_owner(v_walk.pack_id, v_user) THEN
    RAISE EXCEPTION 'pack_host_required';
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

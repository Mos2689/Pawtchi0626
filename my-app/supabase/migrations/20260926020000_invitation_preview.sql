-- A look inside a meetup before saying yes to it.
--
-- Someone invited to a meetup could only Accept or Decline from a name and
-- "Sam invited you". The member, walk, profile and pet policies all require a
-- membership — which is exactly what an invitation has not created yet — so the
-- app had nothing else it was allowed to show (user report, 2026-09-26).
--
-- This returns a preview for ONE invitation, to the ONE person it was sent to,
-- only while it is still pending and unexpired: who hosts, who is in it, their
-- dogs, and the next walk — including where it meets. Showing the meeting
-- point before acceptance was the user's explicit choice (2026-09-26): the host
-- chose to invite this person by exact username, and meeting a stranger's dog
-- somewhere you cannot see first is the worse trade.
--
-- Nothing here is readable by anyone else: an invitation id you were not sent
-- is refused exactly like an expired one, so the function cannot be used to
-- probe which invitations exist.

CREATE OR REPLACE FUNCTION public.community_invitation_preview(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_invite public.community_pack_invitations;
  v_pack public.community_packs;
  v_walk public.community_walks;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE id = p_invitation_id
      AND invitee_id = v_user
      AND state = 'pending'
      AND expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_available'; END IF;

  SELECT * INTO v_pack FROM public.community_packs WHERE id = v_invite.pack_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation_not_available'; END IF;

  -- The next walk, by the same rules as community_trails_for_me: a running
  -- walk first, then the soonest plan still ahead (or under 3 h late), then
  -- an undated one.
  SELECT * INTO v_walk FROM public.community_walks w
    WHERE w.pack_id = v_pack.id
      AND (w.state = 'active'
           OR (w.state = 'planned'
               AND (w.scheduled_for IS NULL OR w.scheduled_for >= now() - interval '3 hours')))
    ORDER BY (w.state = 'active') DESC, w.scheduled_for ASC NULLS LAST
    LIMIT 1;

  RETURN jsonb_build_object(
    'packName', v_pack.name,
    'hostName', (
      SELECT coalesce(
        nullif(split_part(trim(pr.full_name), ' ', 1), ''),
        CASE WHEN pr.username IS NULL THEN NULL ELSE '@' || pr.username END
      )
      FROM public.profiles pr WHERE pr.id = v_pack.owner_id
    ),
    'memberCount', (SELECT count(*) FROM public.community_pack_members m WHERE m.pack_id = v_pack.id),
    'dogs', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', pe.id, 'name', pe.name, 'image_url', pe.image_url
      ) ORDER BY pe.created_at), '[]'::jsonb)
      FROM public.community_pack_members m
      JOIN public.pets pe ON pe.owner_id = m.user_id AND pe.species = 'dog'
      WHERE m.pack_id = v_pack.id
    ),
    'nextWalk', CASE WHEN v_walk.id IS NULL THEN NULL ELSE jsonb_build_object(
      'title', v_walk.title,
      'state', v_walk.state,
      'scheduledFor', v_walk.scheduled_for,
      'meetingLabel', v_walk.meeting_label,
      'note', v_walk.note,
      'goingCount', (
        SELECT count(*) FROM public.community_walk_attendance a
        WHERE a.walk_id = v_walk.id
          AND a.status IN ('coming', 'checked_in', 'walking', 'finished')
      )
    ) END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_invitation_preview(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_invitation_preview(UUID) TO authenticated;

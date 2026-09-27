-- Previous invitees: a host can re-invite, in a tap, the people they have
-- invited before — and nobody else.
--
-- ── Why this does not break "private means private" ────────────────────────
--
-- The invite screen has no search and no suggestions on purpose: a meetup that
-- could be browsed into is not private. This list does not change that, because
-- nobody can appear on it who the host did not already reach themselves — by
-- typing their exact username, or by approving them through an invitation link.
-- It is the host's own history, handed back to them. It never widens who they
-- can find.
--
-- So the rule is enforced HERE, not in the app: both functions derive the set
-- from `community_pack_invitations` rows where `inviter_id = auth.uid()`. An app
-- that passed any other user id to the send function would be refused.
--
-- ── Who is left out, and why ───────────────────────────────────────────────
--
--   * Anyone already in this meetup — there is nothing to invite them to.
--   * Anyone blocked, in either direction — the same rule as a username invite.
--   * Anyone whose LATEST answer to this host was "decline". A no is not
--     re-suggested; the host can still type their username if things change.
--   * Deleted accounts fall out on their own (ON DELETE CASCADE on invitee_id).
--
-- Link invitations count once the host approved them: the approve step writes
-- `invitee_id = claimed_by`, so an approved link invite is an ordinary row here.
-- Unclaimed or unapproved links have no invitee and are never listed.
--
-- ── Host only ──────────────────────────────────────────────────────────────
--
-- Both functions require `is_community_pack_owner(p_pack_id)` — the same check
-- as `invite_community_username` (see 20260922020000_trail_host_authority).
-- A member opening the invite screen gets the error, and the app shows nothing.

-- The rate-limit count in invite_community_username and the history read below
-- both filter on inviter_id and recency. There was no index on inviter_id at all.
CREATE INDEX IF NOT EXISTS community_invitations_inviter_idx
  ON public.community_pack_invitations (inviter_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.community_previous_invitees(p_pack_id UUID)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  dogs JSONB,
  last_invited_at TIMESTAMPTZ,
  pending_here BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host UUID := auth.uid();
BEGIN
  IF v_host IS NULL OR NOT public.is_community_pack_owner(p_pack_id, v_host) THEN
    RAISE EXCEPTION 'pack_host_required';
  END IF;

  RETURN QUERY
  WITH latest AS (
    -- One row per person this host has ever invited: their most recent
    -- invitation from this host, across every meetup.
    SELECT DISTINCT ON (i.invitee_id)
      i.invitee_id, i.state, i.created_at
    FROM public.community_pack_invitations i
    WHERE i.inviter_id = v_host
      AND i.invitee_id IS NOT NULL
      AND i.invitee_id <> v_host
    ORDER BY i.invitee_id, i.created_at DESC
  )
  SELECT pr.id, pr.username, pr.full_name, pr.avatar_url,
    coalesce(jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb),
    l.created_at,
    EXISTS (
      SELECT 1 FROM public.community_pack_invitations here
      WHERE here.pack_id = p_pack_id AND here.invitee_id = pr.id
        AND here.state = 'pending' AND here.expires_at > now()
    )
  FROM latest l
  JOIN public.profiles pr ON pr.id = l.invitee_id
  LEFT JOIN public.pets pet ON pet.owner_id = pr.id AND pet.species = 'dog'
  WHERE l.state <> 'declined'
    AND NOT public.is_community_pack_member(p_pack_id, pr.id)
    AND NOT EXISTS (
      SELECT 1 FROM public.community_user_blocks b
      WHERE (b.blocker_id = v_host AND b.blocked_id = pr.id)
         OR (b.blocker_id = pr.id AND b.blocked_id = v_host)
    )
  GROUP BY pr.id, pr.username, pr.full_name, pr.avatar_url, l.created_at
  ORDER BY l.created_at DESC
  LIMIT 50;
END;
$$;

-- Invite several previous invitees at once. Returns how many were newly
-- invited (someone with a live invitation to this meetup already is skipped,
-- not re-sent — the same idempotence as invite_community_username).
CREATE OR REPLACE FUNCTION public.invite_previous_community_invitees(p_pack_id UUID, p_user_ids UUID[])
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host UUID := auth.uid();
  v_allowed UUID[];
  v_fresh UUID[];
  v_recent INTEGER;
  v_host_name TEXT;
  v_pack_name TEXT;
  v_invite public.community_pack_invitations;
  v_user UUID;
  v_sent INTEGER := 0;
BEGIN
  IF v_host IS NULL OR NOT public.is_community_pack_owner(p_pack_id, v_host) THEN
    RAISE EXCEPTION 'pack_host_required';
  END IF;
  IF p_user_ids IS NULL OR cardinality(p_user_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_user_ids) > 12 THEN
    RAISE EXCEPTION 'invite_rate_limited';
  END IF;

  -- The whole security property of this function: every id must be someone
  -- this host has invited before and who is still eligible. Anything else in
  -- the array is refused outright rather than silently dropped, so a tampered
  -- call fails loudly instead of half-succeeding.
  SELECT array_agg(p.user_id) INTO v_allowed
  FROM public.community_previous_invitees(p_pack_id) p
  WHERE p.user_id = ANY (p_user_ids);

  IF coalesce(cardinality(v_allowed), 0) <> cardinality(ARRAY(SELECT DISTINCT unnest(p_user_ids))) THEN
    RAISE EXCEPTION 'not_a_previous_invitee';
  END IF;

  -- Already holding a live invitation to this meetup: nothing to send.
  SELECT array_agg(u) INTO v_fresh
  FROM unnest(v_allowed) AS u
  WHERE NOT EXISTS (
    SELECT 1 FROM public.community_pack_invitations here
    WHERE here.pack_id = p_pack_id AND here.invitee_id = u
      AND here.state = 'pending' AND here.expires_at > now()
  );
  IF v_fresh IS NULL THEN
    RETURN 0;
  END IF;

  -- The same hourly budget as a typed invitation, counted as one pool. Checked
  -- for the whole batch before anything is written, so it is all or nothing.
  SELECT count(*) INTO v_recent FROM public.community_pack_invitations
    WHERE inviter_id = v_host AND created_at > now() - interval '1 hour';
  IF v_recent + cardinality(v_fresh) > 12 THEN
    RAISE EXCEPTION 'invite_rate_limited';
  END IF;

  SELECT full_name INTO v_host_name FROM public.profiles WHERE id = v_host;
  SELECT name INTO v_pack_name FROM public.community_packs WHERE id = p_pack_id;

  FOREACH v_user IN ARRAY v_fresh LOOP
    INSERT INTO public.community_pack_invitations (pack_id, inviter_id, invitee_id)
      VALUES (p_pack_id, v_host, v_user) RETURNING * INTO v_invite;
    -- Word for word the push invite_community_username sends, so a tapped
    -- invitation and a typed one arrive looking the same.
    PERFORM public.enqueue_community_notification(
      v_user,
      'community_invite',
      p_pack_id,
      NULL,
      coalesce(v_host_name, 'A friend') || ' invited you',
      'Meet the dogs in ' || v_pack_name || ' and decide whether to join.',
      '/(tabs)/community',
      'community_invite:' || v_invite.id::TEXT
    );
    v_sent := v_sent + 1;
  END LOOP;

  RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.community_previous_invitees(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_previous_invitees(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.invite_previous_community_invitees(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_previous_community_invitees(UUID, UUID[]) TO authenticated;

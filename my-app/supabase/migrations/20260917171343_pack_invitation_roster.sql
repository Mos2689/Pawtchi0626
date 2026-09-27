-- Let a trail show who has been invited, and where that invitation got to.
--
-- ── The gap ────────────────────────────────────────────────────────────────
--
-- A host invites @someone by exact username, and then the trail shows nothing:
-- the invited person is not a member yet, so they appear nowhere, and the
-- invitation itself is invisible. Hosts reported it as "the invitation never
-- sent". It had sent — there was just no surface that admitted it existed.
--
-- The host CAN already read the invitation row (community_invites_read_involved
-- covers inviter and pack owner). What they cannot read is the invitee's
-- profile: every profiles policy requires a SHARED PACK, and a pending invitee
-- is by definition not in the pack yet. Verified against production — the host
-- sees 3 invitation rows and 0 of the profiles they point at.
--
-- So the trail could say "someone is invited" but never who, which is useless
-- in a feature whose entire premise is that you know exactly who is in it.
--
-- ── Why an RPC and not a wider policy ──────────────────────────────────────
--
-- Widening the profiles policy to "anyone you have an open invitation with"
-- would make a profile readable by sending an invitation — an unsolicited
-- invite would become a lookup primitive, which is the one thing the
-- exact-username design exists to prevent. A SECURITY DEFINER function scoped
-- to one pack leaks nothing extra: the caller must already be a member of that
-- pack, and gets back only the small confirmation profile they saw when they
-- typed the username in the first place.
--
-- Mirrors list_external_community_claims exactly, which does the same job for
-- invitations that arrived through a forwarded link.
--
-- Expired invitations are returned rather than filtered, so the host can see
-- that one lapsed and send it again. Accepted ones are not: that person is a
-- member now and belongs in the member list, with their dogs.
--
-- Every column reference below is table-qualified. This function declares OUT
-- parameters named `username`, `state` and `created_at`, and an unqualified
-- reference to any of them is the 42702 ambiguity bug that took
-- lookup_community_username out of service for every user.

CREATE OR REPLACE FUNCTION public.list_pack_invitations(p_pack_id UUID)
RETURNS TABLE (
  invitation_id UUID,
  invitee_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  dogs JSONB,
  state TEXT,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_community_pack_member(p_pack_id, auth.uid()) THEN
    RAISE EXCEPTION 'pack_access_denied';
  END IF;
  RETURN QUERY
  SELECT i.id, i.invitee_id, pr.username, pr.full_name, pr.avatar_url,
    coalesce(jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb),
    i.state, i.created_at, i.expires_at
  FROM public.community_pack_invitations i
  JOIN public.profiles pr ON pr.id = i.invitee_id
  LEFT JOIN public.pets pet ON pet.owner_id = i.invitee_id AND pet.species = 'dog'
  WHERE i.pack_id = p_pack_id
    AND i.invitee_id IS NOT NULL
    AND i.state IN ('pending', 'declined')
  GROUP BY i.id, i.invitee_id, pr.username, pr.full_name, pr.avatar_url,
    i.state, i.created_at, i.expires_at
  ORDER BY i.created_at DESC;
END;
$$;

-- Both, deliberately. REVOKE ... FROM PUBLIC alone does not remove the direct
-- grant Supabase's default privileges hand to anon at creation time — the trap
-- that left all nineteen community functions anon-callable.
REVOKE EXECUTE ON FUNCTION public.list_pack_invitations(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_pack_invitations(UUID) TO authenticated;

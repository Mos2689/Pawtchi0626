-- Undo 20261005000000_invite_claim_notifications.sql. Run in the SQL editor.
-- Restores the claim and approve functions of 20260917000000 (no pushes, and
-- an inviter opening their own link claims it again). The two event types stay
-- allowed so already-queued rows remain valid; nothing new enqueues them.

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_external_community_invite(p_code UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE invite_code = p_code AND invitee_id IS NULL AND state = 'pending' AND expires_at > now()
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid_or_expired'; END IF;
  UPDATE public.community_pack_invitations
    SET claimed_by = v_user, state = 'pending_host', responded_at = now()
    WHERE id = v_invite.id;
  RETURN 'host_confirmation_required';
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_external_community_invite(p_invitation_id UUID, p_approve BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID := auth.uid(); v_invite public.community_pack_invitations;
BEGIN
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE id = p_invitation_id AND state = 'pending_host' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_community_pack_owner(v_invite.pack_id, v_owner) THEN RETURN 'not_available'; END IF;
  IF p_approve AND v_invite.claimed_by IS NOT NULL THEN
    INSERT INTO public.community_pack_members (pack_id, user_id, role, archive_from)
      VALUES (v_invite.pack_id, v_invite.claimed_by, 'member', now()) ON CONFLICT DO NOTHING;
    UPDATE public.community_pack_invitations SET invitee_id = claimed_by, state = 'accepted', responded_at = now()
      WHERE id = v_invite.id;
    RETURN 'accepted';
  END IF;
  UPDATE public.community_pack_invitations SET state = 'revoked', responded_at = now() WHERE id = v_invite.id;
  RETURN 'revoked';
END;
$$;

COMMIT;

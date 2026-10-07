-- Undo 20261008000000_reusable_invite_links.sql. Run in the SQL editor.
-- Closes every open reusable link, restores the one-person claim of
-- 20261005000000, and drops the admin helpers. Requests already waiting with a
-- host stay as ordinary `pending_host` claims and can still be confirmed.
-- The three columns, the constraints and the index are left in place: they are
-- additive, and dropping them would only discard which link a claim came from.

BEGIN;

UPDATE public.community_pack_invitations
  SET state = 'revoked', responded_at = now()
  WHERE reusable AND state = 'pending';

CREATE OR REPLACE FUNCTION public.claim_external_community_invite(p_code UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_invite  public.community_pack_invitations;
  v_host    UUID;
  v_pack    TEXT;
  v_who     TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE invite_code = p_code
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid_or_expired'; END IF;

  -- Checked before the state, so these answers hold for an invite in any
  -- state, and neither one changes the invite.
  IF v_invite.inviter_id = v_user THEN RETURN 'own_invite'; END IF;
  IF public.is_community_pack_member(v_invite.pack_id, v_user) THEN RETURN 'already_member'; END IF;

  IF v_invite.state = 'pending_host' AND v_invite.claimed_by = v_user THEN
    RETURN 'host_confirmation_required';
  END IF;
  IF v_invite.invitee_id IS NOT NULL OR v_invite.state <> 'pending' OR v_invite.expires_at <= now() THEN
    RETURN 'invalid_or_expired';
  END IF;

  UPDATE public.community_pack_invitations
    SET claimed_by = v_user, state = 'pending_host', responded_at = now()
    WHERE id = v_invite.id;

  SELECT p.owner_id, p.name INTO v_host, v_pack
    FROM public.community_packs p WHERE p.id = v_invite.pack_id;
  SELECT coalesce(nullif(trim(pr.full_name), ''), '@' || nullif(pr.username, ''), 'Someone')
    INTO v_who FROM public.profiles pr WHERE pr.id = v_user;

  IF v_host IS NOT NULL THEN
    PERFORM public.enqueue_community_notification(
      v_host,
      'community_join_request',
      v_invite.pack_id,
      NULL,
      coalesce(v_who, 'Someone') || ' wants to join ' || coalesce(v_pack, 'your meetup'),
      'They opened an invite link from this meetup. Check it is them, then confirm.',
      '/community/' || v_invite.pack_id::TEXT,
      'community_join_request:' || v_invite.id::TEXT || ':' || v_user::TEXT
    );
  END IF;

  RETURN 'host_confirmation_required';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_external_community_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_external_community_invite(UUID) TO authenticated;

DROP FUNCTION IF EXISTS private.make_community_link(UUID, TIMESTAMPTZ, INT);
DROP FUNCTION IF EXISTS private.end_community_link(UUID);

COMMIT;

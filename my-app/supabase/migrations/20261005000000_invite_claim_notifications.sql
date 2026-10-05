-- Invite links: tell the host, tell the person, and stop a link burning itself.
--
-- ── 1. The host was never told ──────────────────────────────────────────────
--
-- Someone who opens a shared invite link becomes a "claim" waiting for the
-- host (state `pending_host`), and nothing told the host. The request sat on
-- the meetup's page until they happened to open it. Now a claim enqueues a
-- `community_join_request` push to the meetup's host — the only person who
-- can confirm it (approve_external_community_invite checks ownership).
--
-- ── 2. The person was never told either ─────────────────────────────────────
--
-- The confirmation screen now promises "we'll let you know as soon as they've
-- approved you". That promise needs a sender: approving enqueues a
-- `community_join_approved` push to the person who claimed. A refusal ("not
-- them") sends nothing — by definition it goes to someone the host did not
-- mean to invite.
--
-- ── 3. Opening your own link spent it ───────────────────────────────────────
--
-- A host who tapped their own link in a chat (to check it, or by accident)
-- claimed it themselves: the invite moved to `pending_host` under their own
-- name, and the friend it was meant for then got "invalid or expired". Now:
--
--   inviter opens own link        → 'own_invite'       (link untouched)
--   a member opens a pack's link  → 'already_member'   (link untouched)
--   the same person opens it again→ 'host_confirmation_required' (idempotent;
--                                    a retry after a lost response no longer
--                                    reads as "invalid")
--
-- The noise budget: dedupe keys make each push once per claim and once per
-- approval, whatever retries happen.
--
-- Rollback: supabase/rollbacks/20261005000000_invite_claim_notifications.down.sql

-- ── Event types ─────────────────────────────────────────────────────────────
ALTER TABLE public.community_notification_events
  DROP CONSTRAINT IF EXISTS community_notification_events_event_type_check;
ALTER TABLE public.community_notification_events
  ADD CONSTRAINT community_notification_events_event_type_check
  CHECK (event_type IN (
    'community_invite',
    'community_walk_change',
    'community_memory_ready',
    'community_rsvp',
    'community_moment',
    'community_walk_soon',
    'community_join_request',
    'community_join_approved'
  ));

-- ── Claim ───────────────────────────────────────────────────────────────────
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

-- ── Approve ─────────────────────────────────────────────────────────────────
-- The body of 20260917000000, plus the push on approval.
CREATE OR REPLACE FUNCTION public.approve_external_community_invite(p_invitation_id UUID, p_approve BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner  UUID := auth.uid();
  v_invite public.community_pack_invitations;
  v_pack   TEXT;
  v_host   TEXT;
BEGIN
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE id = p_invitation_id AND state = 'pending_host' FOR UPDATE;
  IF NOT FOUND OR NOT public.is_community_pack_owner(v_invite.pack_id, v_owner) THEN RETURN 'not_available'; END IF;
  IF p_approve AND v_invite.claimed_by IS NOT NULL THEN
    INSERT INTO public.community_pack_members (pack_id, user_id, role, archive_from)
      VALUES (v_invite.pack_id, v_invite.claimed_by, 'member', now()) ON CONFLICT DO NOTHING;
    UPDATE public.community_pack_invitations SET invitee_id = claimed_by, state = 'accepted', responded_at = now()
      WHERE id = v_invite.id;

    SELECT p.name INTO v_pack FROM public.community_packs p WHERE p.id = v_invite.pack_id;
    SELECT coalesce(nullif(trim(pr.full_name), ''), '@' || nullif(pr.username, ''), 'The host')
      INTO v_host FROM public.profiles pr WHERE pr.id = v_owner;
    PERFORM public.enqueue_community_notification(
      v_invite.claimed_by,
      'community_join_approved',
      v_invite.pack_id,
      NULL,
      'You’re in ' || coalesce(v_pack, 'the meetup'),
      coalesce(v_host, 'The host') || ' confirmed you. Open the meetup to see the next walk.',
      '/community/' || v_invite.pack_id::TEXT,
      'community_join_approved:' || v_invite.id::TEXT
    );
    RETURN 'accepted';
  END IF;
  UPDATE public.community_pack_invitations SET state = 'revoked', responded_at = now() WHERE id = v_invite.id;
  RETURN 'revoked';
END;
$$;

-- CREATE OR REPLACE keeps the existing grants (authenticated only, see
-- 20260917133459); restated so this file stands on its own.
REVOKE ALL ON FUNCTION public.claim_external_community_invite(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_external_community_invite(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_external_community_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_external_community_invite(UUID, BOOLEAN) TO authenticated;

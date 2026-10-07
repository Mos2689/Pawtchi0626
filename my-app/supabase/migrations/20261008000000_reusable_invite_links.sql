-- Reusable invite links: one link a partner can post to their whole community.
--
-- Until now an invite link admitted one person: the first claim moved the
-- invitation to `pending_host` under that person's name, and everyone after
-- them was told "invalid or expired". That suits a host texting a friend; it
-- cannot serve a club posting one link to its followers (Salty Dog Social ×
-- Pawtchi, 17 Oct 2026).
--
-- A reusable link is an ordinary invitation with `reusable = true`. It is a
-- template and is never claimed itself: each person who opens it gets their
-- OWN `pending_host` row (a "claim", pointing back through
-- `parent_invite_id`). From there nothing is new — the host is told, the host
-- confirms or refuses each person with approve_external_community_invite, the
-- person is told when confirmed. So the host still decides who sees the
-- meetup's live map; the link only removes the one-person limit.
--
-- No app change: the app already shows "the host will confirm you" for the
-- answer a claim returns. Turning a link reusable is an admin step for now
-- (private.make_community_link, SQL editor only); there is no in-app control.
--
-- Rules for a reusable link:
--   • one claim per person per link (unique index); asking again is idempotent
--   • a person the host refused stays refused on that link
--   • optional cap (max_claims) and its own expiry (≤ 31 days out)
--   • ending it (private.end_community_link) refuses new claims; requests
--     already waiting stay with the host
--
-- Rollback: supabase/rollbacks/20261008000000_reusable_invite_links.down.sql

ALTER TABLE public.community_pack_invitations
  ADD COLUMN IF NOT EXISTS reusable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS max_claims INT,
  ADD COLUMN IF NOT EXISTS parent_invite_id UUID
    REFERENCES public.community_pack_invitations(id) ON DELETE CASCADE;

ALTER TABLE public.community_pack_invitations
  DROP CONSTRAINT IF EXISTS community_pack_invitations_max_claims_check,
  DROP CONSTRAINT IF EXISTS community_pack_invitations_reusable_is_template;
ALTER TABLE public.community_pack_invitations
  ADD CONSTRAINT community_pack_invitations_max_claims_check
    CHECK (max_claims IS NULL OR max_claims BETWEEN 1 AND 1000),
  -- A template is never claimed and is never itself a claim.
  ADD CONSTRAINT community_pack_invitations_reusable_is_template
    CHECK (NOT reusable OR (invitee_id IS NULL AND claimed_by IS NULL AND parent_invite_id IS NULL));

-- One claim per person per link; also the lookup for "have they asked already".
CREATE UNIQUE INDEX IF NOT EXISTS community_pack_invitations_one_claim_per_link
  ON public.community_pack_invitations (parent_invite_id, claimed_by)
  WHERE parent_invite_id IS NOT NULL;

-- ── Claim ───────────────────────────────────────────────────────────────────
-- The body of 20261005000000 for ordinary links, unchanged in behaviour, plus
-- the reusable branch. Both end in the same host notification.
CREATE OR REPLACE FUNCTION public.claim_external_community_invite(p_code UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user    UUID := auth.uid();
  v_invite  public.community_pack_invitations;
  v_claim   public.community_pack_invitations;
  v_claim_id UUID;
  v_body    TEXT;
  v_host    UUID;
  v_pack    TEXT;
  v_who     TEXT;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'authentication_required'; END IF;

  -- The row lock also serialises concurrent claims on one reusable link, so
  -- the cap below cannot be overshot.
  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE invite_code = p_code
    FOR UPDATE;
  IF NOT FOUND THEN RETURN 'invalid_or_expired'; END IF;

  -- Checked before the state, so these answers hold for an invite in any
  -- state, and neither one changes the invite.
  IF v_invite.inviter_id = v_user THEN RETURN 'own_invite'; END IF;
  IF public.is_community_pack_member(v_invite.pack_id, v_user) THEN RETURN 'already_member'; END IF;

  IF v_invite.reusable THEN
    SELECT * INTO v_claim FROM public.community_pack_invitations
      WHERE parent_invite_id = v_invite.id AND claimed_by = v_user;
    IF FOUND THEN
      -- Asking again: same answer while waiting; a refusal stands.
      RETURN CASE WHEN v_claim.state = 'pending_host'
        THEN 'host_confirmation_required' ELSE 'invalid_or_expired' END;
    END IF;
    IF v_invite.state <> 'pending' OR v_invite.expires_at <= now() THEN
      RETURN 'invalid_or_expired';
    END IF;
    IF v_invite.max_claims IS NOT NULL AND (
      SELECT count(*) FROM public.community_pack_invitations c
      WHERE c.parent_invite_id = v_invite.id
    ) >= v_invite.max_claims THEN
      RETURN 'invalid_or_expired';
    END IF;

    INSERT INTO public.community_pack_invitations
      (pack_id, inviter_id, claimed_by, state, responded_at, expires_at, parent_invite_id)
    VALUES
      (v_invite.pack_id, v_invite.inviter_id, v_user, 'pending_host', now(), v_invite.expires_at, v_invite.id)
    RETURNING id INTO v_claim_id;
    v_body := 'They opened this meetup’s community link. Confirm them to let them in.';
  ELSE
    IF v_invite.state = 'pending_host' AND v_invite.claimed_by = v_user THEN
      RETURN 'host_confirmation_required';
    END IF;
    IF v_invite.invitee_id IS NOT NULL OR v_invite.state <> 'pending' OR v_invite.expires_at <= now() THEN
      RETURN 'invalid_or_expired';
    END IF;

    UPDATE public.community_pack_invitations
      SET claimed_by = v_user, state = 'pending_host', responded_at = now()
      WHERE id = v_invite.id;
    v_claim_id := v_invite.id;
    v_body := 'They opened an invite link from this meetup. Check it is them, then confirm.';
  END IF;

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
      v_body,
      '/community/' || v_invite.pack_id::TEXT,
      'community_join_request:' || v_claim_id::TEXT || ':' || v_user::TEXT
    );
  END IF;

  RETURN 'host_confirmation_required';
END;
$$;

REVOKE ALL ON FUNCTION public.claim_external_community_invite(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_external_community_invite(UUID) TO authenticated;

-- ── Admin: turn a link reusable, and end it ─────────────────────────────────
-- SQL editor only. The host shares an invite link from the meetup as usual;
-- the code is the `code=` part of https://pawtchi.com/app/community-invite?code=…
CREATE OR REPLACE FUNCTION private.make_community_link(
  p_code UUID,
  p_until TIMESTAMPTZ,
  p_max_claims INT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invite public.community_pack_invitations;
BEGIN
  IF p_code IS NULL OR p_until IS NULL THEN RAISE EXCEPTION 'code_and_until_required'; END IF;
  IF p_until <= now() OR p_until > now() + interval '31 days' THEN
    RAISE EXCEPTION 'until_must_be_within_31_days';
  END IF;

  SELECT * INTO v_invite FROM public.community_pack_invitations
    WHERE invite_code = p_code FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invite_not_found'; END IF;
  IF v_invite.parent_invite_id IS NOT NULL OR v_invite.invitee_id IS NOT NULL
     OR v_invite.claimed_by IS NOT NULL OR v_invite.state <> 'pending' THEN
    RAISE EXCEPTION 'invite_already_used — share a fresh link from the meetup';
  END IF;

  UPDATE public.community_pack_invitations
    SET reusable = true, expires_at = p_until, max_claims = p_max_claims
    WHERE id = v_invite.id;

  RETURN 'https://pawtchi.com/app/community-invite?code=' || p_code::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION private.end_community_link(p_code UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_waiting INT;
BEGIN
  UPDATE public.community_pack_invitations
    SET state = 'revoked', responded_at = now()
    WHERE invite_code = p_code AND reusable AND state = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'no_open_community_link'; END IF;
  -- Requests already waiting stay with the host; report how many.
  SELECT count(*)::INT INTO v_waiting FROM public.community_pack_invitations c
    JOIN public.community_pack_invitations l ON l.id = c.parent_invite_id
    WHERE l.invite_code = p_code AND c.state = 'pending_host';
  RETURN v_waiting;
END;
$$;

REVOKE ALL ON FUNCTION private.make_community_link(UUID, TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.end_community_link(UUID) FROM PUBLIC, anon, authenticated;

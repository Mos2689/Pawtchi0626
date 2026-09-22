-- Close the community functions that Supabase's default privileges left open.
--
-- ── What went wrong ────────────────────────────────────────────────────────
--
-- 20260917000000_community_walks ends every internal function with
--
--   REVOKE ALL ON FUNCTION public.<fn>(...) FROM PUBLIC;
--
-- and grants EXECUTE only to `authenticated` for the ones the app calls. The
-- intent was right and the effect was not. Supabase ships
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
--
-- so every function created in `public` picks up a DIRECT grant to those three
-- roles at creation time. Revoking from PUBLIC does not remove a direct grant,
-- so the REVOKE lines were decorative and all 19 functions were reachable at
-- /rest/v1/rpc/<name> by an unauthenticated caller.
--
-- Most of them survive that unharmed: they resolve auth.uid() to NULL and
-- either raise, return nothing, or fail a membership check. Two do not.
--
--   get_community_notification_candidates() — returns up to 500 rows of push
--     tokens, user ids, titles and bodies. SECURITY DEFINER, no auth guard, on
--     the assumption that only the service role could reach it. Anyone with
--     the anon key could have read the push tokens of every user with a
--     pending community event.
--
--   enqueue_community_notification(...) — a bare INSERT into the notification
--     queue with a caller-supplied user_id, title, body and route. Reachable
--     by anon it is a push-notification injection endpoint pointed at any user
--     in the database.
--
-- Neither is exploitable today — the queue is empty and no build ships the
-- feature — but neither should be reachable for a moment longer.
--
-- ── What this does ─────────────────────────────────────────────────────────
--
-- 1. Revokes EXECUTE from `anon` on every community function. None of them do
--    anything useful without a session, so nothing legitimate is lost.
-- 2. Revokes EXECUTE from `authenticated` as well on the three that are purely
--    internal. They are never named in an RLS policy, so nothing that a
--    signed-in user does needs to call them:
--      - enqueue_community_notification is called only from inside other
--        SECURITY DEFINER functions, which run as their definer.
--      - get_community_notification_candidates is called only by
--        notify-dispatch with the service role, whose grant is untouched.
--      - on_community_walk_changed is a trigger; PostgreSQL does not check
--        EXECUTE on trigger functions at fire time.
--
-- The four membership helpers keep their `authenticated` grant deliberately.
-- RLS policy expressions are evaluated as the querying role, so revoking that
-- would make every community policy fail with "permission denied for function"
-- the first time a real pack existed.

REVOKE EXECUTE ON FUNCTION public.is_community_pack_member(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_community_pack_owner(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_access_community_walk(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.has_community_pack_invite(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.lookup_community_username(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_community_pack(TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_my_community_invitations() FROM anon;
REVOKE EXECUTE ON FUNCTION public.invite_community_username(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_external_community_invite(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_external_community_invite(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.respond_community_invitation(UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_external_community_invite(UUID, BOOLEAN) FROM anon;
REVOKE EXECUTE ON FUNCTION public.list_external_community_claims(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_community_walk(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.transfer_community_pack_ownership(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.set_community_pack_muted(UUID, BOOLEAN) FROM anon;

-- The three that no client role should ever reach.
REVOKE EXECUTE ON FUNCTION public.enqueue_community_notification(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_community_notification_candidates()
  FROM anon, authenticated;
-- NOTE: this leaves on_community_walk_changed still reachable through the
-- PUBLIC grant; 20260917133850 finishes the job. Left as applied rather than
-- edited after the fact, so this file matches what production actually ran.
REVOKE EXECUTE ON FUNCTION public.on_community_walk_changed()
  FROM anon, authenticated;

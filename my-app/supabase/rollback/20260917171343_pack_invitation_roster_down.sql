-- Teardown for 20260917171343_pack_invitation_roster.
--
-- ⚠ NOT A MIGRATION. Lives outside supabase/migrations/ so `supabase db push`
-- can never pick it up. Run it deliberately.
--
-- One function, no tables, no data. Dropping it takes the invited-people list
-- off the trail screen and changes nothing else: the invitations themselves
-- live in community_pack_invitations and are untouched, and the host keeps the
-- access they already had to those rows. Nothing to preserve, so there is no
-- destructive section here.

BEGIN;

DROP FUNCTION IF EXISTS public.list_pack_invitations(UUID);

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect 0.
--
--   SELECT count(*) FROM pg_proc p
--   JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname = 'public' AND p.proname = 'list_pack_invitations';

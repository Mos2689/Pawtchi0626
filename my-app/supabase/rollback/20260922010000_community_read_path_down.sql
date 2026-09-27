-- Teardown for 20260922010000_community_read_path.
--
-- ⚠ NOT A MIGRATION. Lives outside supabase/migrations/ so `supabase db push`
-- can never pick it up. Run it deliberately.
--
-- ⚠ AND: running this alone will break Together. The app release that shipped
-- alongside this migration calls community_trails_for_me, community_outing and
-- community_memory instead of the query orchestrations they replaced, and
-- there is no expo-updates in this project — so a JavaScript rollback is a
-- store release, not a switch. Roll the app back FIRST, or leave these
-- functions in place; they are additive and cost nothing while unused.
--
-- The indexes are a different matter and are deliberately NOT dropped by
-- default. They make the pre-RPC query path faster too — that path is exactly
-- what a rollback returns to — and dropping them would make the thing you
-- rolled back to slower than it was before any of this. The statements are at
-- the bottom, commented, for the case where you genuinely want the database
-- back to its previous shape.

BEGIN;

DROP FUNCTION IF EXISTS public.community_trails_for_me();
DROP FUNCTION IF EXISTS public.community_memory(UUID);
-- After community_memory: it calls community_outing, and dropping a function
-- another still references leaves that one raising at runtime rather than
-- failing here where somebody is watching.
DROP FUNCTION IF EXISTS public.community_outing(UUID);
DROP FUNCTION IF EXISTS public.community_claims_for_packs(UUID[]);

COMMIT;

-- Only if the database itself must go back to its previous shape. See above:
-- these help the old query path as much as the new one.
--
-- DROP INDEX IF EXISTS public.pets_owner_dog_idx;
-- DROP INDEX IF EXISTS public.community_walk_participant_pets_pet_idx;
-- DROP INDEX IF EXISTS public.community_shared_media_dogs_idx;

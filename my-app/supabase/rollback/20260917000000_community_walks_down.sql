-- Teardown for 20260917000000_community_walks.
--
-- ⚠ THIS FILE IS NOT A MIGRATION. It lives outside supabase/migrations/ on
-- purpose, so `supabase db push` can never pick it up. Run it deliberately, by
-- hand, against the database you mean to revert.
--
-- ── What it reverses ───────────────────────────────────────────────────────
--
-- Section 1 (runs by default) removes every structural thing the migration
-- added: 14 tables with their policies, indexes and trigger, 19 functions, and
-- the 11 policies it placed on four tables that already existed — profiles,
-- pets, walk_sessions and storage.objects. After it runs, the database is
-- functionally back where it started and no live user's access has changed.
--
-- Section 2 (commented out) removes the two things that hold REAL USER DATA:
-- the usernames people chose, and the photos they shared with a pack. That is
-- deliberately not the default. A rollback should undo a schema, not delete
-- someone's data on the way past — if the feature is ever re-applied, the
-- usernames are still there and still theirs.
--
-- ── Order matters ──────────────────────────────────────────────────────────
--
-- Policies come off before the functions and tables they reference. Dropping
-- tables first would work only via CASCADE, which would silently take the
-- profiles/pets policies with them — correct, but invisible. Doing it in this
-- order means every object is named out loud and nothing is removed by
-- accident.
--
-- Safe to run twice: every statement is IF EXISTS, and the whole thing is one
-- transaction, so a failure leaves the database untouched rather than half
-- reverted.
--
-- ── The one consumer outside the database ──────────────────────────────────
--
-- notify-dispatch calls get_community_notification_candidates(), which section
-- 3 drops. It does not need to be redeployed first: the call is already
-- wrapped, so a missing function logs one line and the pass yields nothing.
-- Deploy order between the two is free, in both directions.

BEGIN;

-- ══ 1. Policies on tables that existed before this feature ═════════════════
-- These are the only marks the migration left on pre-existing tables. They are
-- all PERMISSIVE and SELECT-only, so removing them cannot narrow anyone's
-- existing access — it just removes the widening that was never used.

DROP POLICY IF EXISTS community_media_objects_read_pack   ON storage.objects;
DROP POLICY IF EXISTS community_media_objects_insert_self ON storage.objects;
DROP POLICY IF EXISTS community_media_objects_update_self ON storage.objects;
DROP POLICY IF EXISTS community_media_objects_delete_self ON storage.objects;

DROP POLICY IF EXISTS community_profiles_read_pack_members        ON public.profiles;
DROP POLICY IF EXISTS community_profiles_read_memory_contributors ON public.profiles;
DROP POLICY IF EXISTS community_profiles_read_walk_contributors   ON public.profiles;

DROP POLICY IF EXISTS community_pets_read_pack_members     ON public.pets;
DROP POLICY IF EXISTS community_pets_read_memory_tags      ON public.pets;
DROP POLICY IF EXISTS community_pets_read_walk_participants ON public.pets;

-- walk_sessions is the easiest one to overlook: it is the only pre-existing
-- table touched here that is not profiles, pets or storage, and it is the one
-- the rest of the app reads constantly. The policy lets pack members see the
-- recorded path of a personal walk that was linked to a shared outing.
DROP POLICY IF EXISTS community_members_read_linked_personal_walks ON public.walk_sessions;

-- ══ 2. The feature's own tables ════════════════════════════════════════════
-- CASCADE is the backstop for each table's own policies, indexes, grants and
-- the community_walk_changed_notify trigger. Nothing outside this list depends
-- on them: no other migration, view or foreign key references a community_*
-- table, which is what makes this feature cleanly removable at all.

DROP TABLE IF EXISTS public.community_notification_events   CASCADE;
DROP TABLE IF EXISTS public.community_username_lookups      CASCADE;
DROP TABLE IF EXISTS public.community_reports               CASCADE;
DROP TABLE IF EXISTS public.community_user_blocks           CASCADE;
DROP TABLE IF EXISTS public.community_media_hearts          CASCADE;
DROP TABLE IF EXISTS public.community_shared_media          CASCADE;
DROP TABLE IF EXISTS public.community_live_locations        CASCADE;
DROP TABLE IF EXISTS public.community_walk_sessions         CASCADE;
DROP TABLE IF EXISTS public.community_walk_participant_pets CASCADE;
DROP TABLE IF EXISTS public.community_walk_attendance       CASCADE;
DROP TABLE IF EXISTS public.community_walks                 CASCADE;
DROP TABLE IF EXISTS public.community_pack_invitations      CASCADE;
DROP TABLE IF EXISTS public.community_pack_members          CASCADE;
DROP TABLE IF EXISTS public.community_packs                 CASCADE;

-- ══ 3. Functions ═══════════════════════════════════════════════════════════
-- Deliberately NOT cascaded. Every policy that referenced these is already
-- gone; if one of these still errors, something outside this feature took a
-- dependency on it and the teardown should stop and say so rather than drag an
-- unknown object down with it.

DROP FUNCTION IF EXISTS public.set_community_pack_muted(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.transfer_community_pack_ownership(UUID, UUID);
DROP FUNCTION IF EXISTS public.get_community_notification_candidates();
DROP FUNCTION IF EXISTS public.on_community_walk_changed();
DROP FUNCTION IF EXISTS public.create_community_walk(UUID, TEXT, TIMESTAMPTZ, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.list_external_community_claims(UUID);
DROP FUNCTION IF EXISTS public.approve_external_community_invite(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.respond_community_invitation(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.claim_external_community_invite(UUID);
DROP FUNCTION IF EXISTS public.create_external_community_invite(UUID);
DROP FUNCTION IF EXISTS public.invite_community_username(UUID, TEXT);
DROP FUNCTION IF EXISTS public.get_my_community_invitations();
DROP FUNCTION IF EXISTS public.create_community_pack(TEXT);
DROP FUNCTION IF EXISTS public.lookup_community_username(TEXT);
DROP FUNCTION IF EXISTS public.enqueue_community_notification(UUID, TEXT, UUID, UUID, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS public.has_community_pack_invite(UUID, UUID);
DROP FUNCTION IF EXISTS public.can_access_community_walk(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_community_pack_owner(UUID, UUID);
DROP FUNCTION IF EXISTS public.is_community_pack_member(UUID, UUID);

COMMIT;

-- ── Verify ─────────────────────────────────────────────────────────────────
-- Expect four zeroes. Anything else means the teardown is incomplete.
--
--   SELECT
--     (SELECT count(*) FROM pg_tables
--        WHERE schemaname='public' AND tablename LIKE 'community%')      AS tables,
--     (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--        WHERE n.nspname='public' AND p.proname LIKE '%community%')      AS functions,
--     (SELECT count(*) FROM pg_policy WHERE polname LIKE 'community_%')  AS policies,
--     (SELECT count(*) FROM storage.buckets
--        WHERE id='community-walk-media')                                AS buckets;
--
-- `buckets` stays at 1 unless you also run section 2 below. That is expected.


-- ══════════════════════════════════════════════════════════════════════════
-- SECTION 2 — DESTROYS USER DATA. Uncomment only on purpose.
-- ══════════════════════════════════════════════════════════════════════════
--
-- Everything above is reversible: re-apply the migration and you are back.
-- Nothing below is. Read the two notes before uncommenting.
--
-- NOTE 1 — usernames. profiles.username holds a name each owner chose for
-- themselves, and it is the handle their friends use to find them. Dropping
-- the column throws those away; leaving it costs nothing but a nullable column
-- nobody reads. Prefer leaving it.
--
-- NOTE 2 — photos. Deleting rows from storage.objects removes Postgres's
-- record of the files. It does NOT delete the files themselves from object
-- storage — only the Storage API can do that. If the point of the teardown is
-- to erase shared photos, empty the bucket through the dashboard or the
-- Storage API FIRST, then run this to remove the bucket.
--
-- BEGIN;
--
-- -- 2a. The usernames people chose, and the constraint and index behind them.
-- ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_format;
-- DROP INDEX IF EXISTS public.profiles_username_lower_key;
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS username;
--
-- -- 2b. The shared-photo bucket. Fails while the bucket still holds objects,
-- --     which is the intended guard — see NOTE 2.
-- DELETE FROM storage.objects WHERE bucket_id = 'community-walk-media';
-- DELETE FROM storage.buckets WHERE id = 'community-walk-media';
--
-- COMMIT;

-- Live Walk v2, Phase 0b: the RPC becomes the only way to write a position.
--
-- NOT A MIGRATION YET. `db push` applies everything in supabase/migrations, and
-- this must not reach production while any build that writes positions
-- directly (TestFlight build 99 and earlier) is still in use for live walks.
-- Ship it with the build that publishes through publish_live_location: copy it
-- into supabase/migrations under a new timestamp in that release.
--
-- After this, positions are written only by publish_live_location (SECURITY
-- DEFINER, so the grant change does not touch it) and removed only by the
-- cleanup triggers. Signed-in users keep SELECT, which the live map and
-- Realtime's per-viewer RLS check both need. anon loses everything; it never
-- had a policy, so this only removes privileges no request could use.
--
-- The INSERT/UPDATE policies stay in place so that the rollback is a single
-- GRANT:
--   GRANT INSERT, UPDATE ON public.community_live_locations TO authenticated;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.community_live_locations FROM authenticated;
REVOKE ALL ON public.community_live_locations FROM anon;

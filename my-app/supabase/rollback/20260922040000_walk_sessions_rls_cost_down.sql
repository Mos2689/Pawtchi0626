-- Down for 20260922040000_walk_sessions_rls_cost.
--
-- Restores the owner policy to its original bare-auth.uid() form and drops the
-- index. Both are strictly worse; this exists for completeness, not because
-- reverting it is ever the right call.
--
-- Note that dropping the index re-arms the sequential scan described in the
-- forward migration, so if you are reverting because something about the
-- community policy is wrong, drop that POLICY rather than this index.

DROP POLICY IF EXISTS "owner_can_rw_own_walk_sessions" ON public.walk_sessions;
CREATE POLICY "owner_can_rw_own_walk_sessions" ON public.walk_sessions
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

DROP INDEX IF EXISTS public.idx_community_walk_sessions_walk_session;
DROP INDEX IF EXISTS public.idx_pets_owner_created;

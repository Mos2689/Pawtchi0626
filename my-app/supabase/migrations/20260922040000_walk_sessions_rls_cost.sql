-- Make reading walk_sessions cheap again.
--
-- walk_sessions is the table Home is made of — the rail, the map pins, the
-- drawn route, today's totals and the story ring all come from one query
-- against it (hooks/useRecentWalks.ts). Anything added to its RLS is paid on
-- every launch by every owner, whether or not they have ever heard of Trails.
--
-- Two things are charging rent there.
--
-- ── 1. The community policy has no index to land on ─────────────────────────
--
-- 20260917000000 added community_members_read_linked_personal_walks so that
-- people on a shared walk can see each other's legs. Its subquery correlates
-- on walk_sessions.id:
--
--   EXISTS (SELECT 1 FROM community_walk_sessions linked
--            WHERE linked.walk_session_id = walk_sessions.id AND ...)
--
-- community_walk_sessions is keyed PRIMARY KEY (walk_id, user_id,
-- walk_session_id), and walk_session_id is the THIRD column. Postgres will
-- still use that index — a measured plan shows `Bitmap Index Scan on
-- community_walk_sessions_pkey` with the walk_session_id condition — but not
-- as a seek. With no leading-column predicate it reads the whole index and
-- filters, so the work grows with the size of the table rather than staying
-- flat at one row.
--
-- Today that is cheap, because the table is small. It will not stay small: it
-- gains a row per participant per trail walk, forever, and this runs once per
-- walk_sessions row the outer query touches, on the query Home is built from.
--
-- The index below makes it an actual seek. This is an optimisation against
-- future growth, not a fix for a present outage — worth having, worth not
-- overselling.
--
-- ── 2. The owner policy re-evaluates auth.uid() per row ─────────────────────
--
-- From 20260707000003, predating the convention the rest of this schema
-- follows:
--
--   USING (owner_id = auth.uid())
--
-- A bare auth.uid() in a policy is evaluated once PER ROW. Wrapped in a
-- subselect it becomes an InitPlan, evaluated once for the whole statement.
-- Every community policy in 20260917000000 already uses `(select auth.uid())`;
-- this one was simply written before that was understood, and has been paying
-- for it on every walk read since July.
--
-- Rewritten below with identical semantics — same FOR ALL, same USING, same
-- WITH CHECK, same owner_id comparison. Only the evaluation count changes.

-- ── 3. pets has no index on owner_id ───────────────────────────────────────
--
-- The largest of the three, and the one that actually explains a 15-second
-- fetchPet. store/useActivePetStore.ts asks for:
--
--   select * from pets where owner_id = $1 order by created_at desc limit 1
--
-- and until now the only index on the table was idx_pets_walksign, so owner_id
-- sat under `Filter:` rather than `Index Cond:` — every row in the table read
-- and tested to return one. Measured on production, 22 Sep, 236 rows in pets:
--
--            Seq Scan, Rows Removed by Filter: 235   →   Index Scan
--   exec     25.378 ms                                   1.837 ms
--   plan     12.834 ms                                   3.656 ms
--
-- Note what that scan is proportional to: every pet belonging to every user,
-- not the one being asked for. At 236 rows it costs 25 ms. The shape is
-- linear, so the same query is seconds at 100k pets and the app would have
-- walked into that without a single line of code changing.
--
-- That was survivable while the RLS filter was one comparison. It is not
-- survivable now: 20260917000000 added three community policies to this table,
-- permissive, so they are ORed alongside the owner check and evaluated per
-- row. One of them (community_pets_read_memory_tags) reaches
-- community_shared_media through a sequential scan. The planner also puts the
-- cheap `owner_id = uid` test LAST in that OR, so the expensive subplans run
-- first.
--
-- So the cost is (every pet in the table) × (up to three correlated subplans).
-- The missing index is old and was not mine; the multiplier was. Both had to
-- be true for this to time out, which is why it appeared when Trails shipped
-- and not before.
--
-- The query's own `owner_id = $1` is ANDed with the RLS filter, so it is
-- indexable independently — this index narrows the scan to one owner's pets
-- BEFORE any policy subplan runs, and carries created_at so ORDER BY ... LIMIT
-- 1 is answered by the index rather than by sorting.
--
-- The three policies are still worth consolidating into one, and the plan after
-- this index says why more clearly than before: of the 100 buffers the query
-- now touches, 97 are inside SubPlan 3 — the community_walk_participant_pets
-- check. Fetching the pet costs about three buffers. Nearly all the remaining
-- work is spent proving community access for a row the owner check would have
-- cleared immediately, if the planner put that check first. It does not: the
-- policies are permissive, so they are ORed, and `owner_id = uid` lands last.
--
-- That consolidation is a change to who can read pet records. It deserves its
-- own tests and its own daylight, and it is not this migration.

CREATE INDEX IF NOT EXISTS idx_pets_owner_created
  ON public.pets (owner_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_community_walk_sessions_walk_session
  ON public.community_walk_sessions (walk_session_id);

DROP POLICY IF EXISTS "owner_can_rw_own_walk_sessions" ON public.walk_sessions;
CREATE POLICY "owner_can_rw_own_walk_sessions" ON public.walk_sessions
  FOR ALL
  USING (owner_id = (select auth.uid()))
  WITH CHECK (owner_id = (select auth.uid()));

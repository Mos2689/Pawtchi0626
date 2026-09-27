-- Together's read path: three round trips become one, and the RLS planning
-- cost goes with them.
--
-- ── What was measured, before writing any of this ───────────────────────────
--
-- One `pets` read — the one `listPacks`, `loadPack` AND `loadOuting` each make:
--
--     Seq Scan on pets ... Rows Removed by Filter: 231   (returns 5 rows)
--     Planning Time: 59.492 ms
--     Execution Time: 35.475 ms
--
-- Ninety-five milliseconds for five rows, and sixty of it spent PLANNING. The
-- cause is not the data. `pets` carries four permissive SELECT policies OR'd
-- together, two of them correlated EXISTS subqueries that call
-- can_access_community_walk, and PostgREST re-plans the lot on every request.
-- Three screens make that read, so a single Together session pays it roughly
-- three times over.
--
-- ── Why SECURITY DEFINER is the fix, and what it costs ──────────────────────
--
-- A SECURITY DEFINER function runs as its owner, so the policy disjunction is
-- never planned at all. That is the second and larger half of the win: the
-- first half is simply that one call replaces nine.
--
-- The price is that authorisation is now OURS to enforce. Every function below
-- checks membership as its FIRST statement and raises otherwise. A missing
-- check here would not be a slow screen; it would be one pack reading another
-- pack's walks. The checks use the same helpers the RLS policies do
-- (is_community_pack_member / can_access_community_walk), so there is one
-- definition of "may see", not two that can drift.
--
-- Nothing here removes or weakens a policy. The tables keep every policy they
-- have; these functions are an additional, checked door.

-- ── Indexes ─────────────────────────────────────────────────────────────────

-- The base scan behind that 35 ms: 231 rows read and discarded to return 5.
-- Partial on species, because every community read asks only for dogs.
CREATE INDEX IF NOT EXISTS pets_owner_dog_idx
  ON public.pets (owner_id) WHERE species = 'dog';

-- `community_pets_read_walk_participants` seq-scans this table from inside the
-- pets policy, calling can_access_community_walk twice per row. Measured at
-- 10.9 ms of the 35 ms. The PK leads with walk_id, so a lookup BY PET had no
-- index at all.
CREATE INDEX IF NOT EXISTS community_walk_participant_pets_pet_idx
  ON public.community_walk_participant_pets (pet_id);

-- `community_pets_read_memory_tags` does `pets.id = ANY(media.dog_ids)` — a
-- correlated scan over an unindexed UUID[].
--
-- Honest accounting: this costs about a millisecond today, because there are
-- eight rows in that table. It is here because the shape is O(pets × media)
-- and will not stay at a millisecond. It is insurance, not the fix.
CREATE INDEX IF NOT EXISTS community_shared_media_dogs_idx
  ON public.community_shared_media USING gin (dog_ids);

-- ── 1. The trails list ──────────────────────────────────────────────────────
--
-- Replaces nine client queries in three serial waves. Returns one document
-- rather than a table: every interesting field is already jsonb (the next
-- walk, the dogs), and one shape means the client does no assembly at all.
--
-- `username` rides along because the Together screen fetched it separately on
-- every focus — a whole round trip for one column of a row this already reads.
CREATE OR REPLACE FUNCTION public.community_trails_for_me()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_trails JSONB;
BEGIN
  -- Everything below is scoped to this caller's own memberships, so identity
  -- IS the authorisation. There is no argument to forge.
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  WITH mine AS (
    SELECT m.pack_id, m.role, m.joined_at
    FROM public.community_pack_members m
    WHERE m.user_id = v_user
  ), next_walk AS (
    -- One upcoming walk per trail: the soonest, with undated ones first
    -- because "date to be confirmed" is still the next thing happening.
    SELECT DISTINCT ON (w.pack_id) w.*
    FROM public.community_walks w
    JOIN mine ON mine.pack_id = w.pack_id
    WHERE w.state IN ('planned', 'active')
      AND (w.scheduled_for >= now() OR w.scheduled_for IS NULL)
    ORDER BY w.pack_id, w.scheduled_for ASC NULLS FIRST
  )
  SELECT coalesce(jsonb_agg(row ORDER BY row->>'joined_at' DESC), '[]'::jsonb)
  INTO v_trails
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'name', p.name,
      'owner_id', p.owner_id,
      'created_at', p.created_at,
      'updated_at', p.updated_at,
      'joined_at', mine.joined_at,
      'role', mine.role,
      'memberCount', (
        SELECT count(*) FROM public.community_pack_members m2 WHERE m2.pack_id = p.id
      ),
      'nextWalk', CASE WHEN nw.id IS NULL THEN NULL ELSE to_jsonb(nw) END,
      'goingCount', CASE WHEN nw.id IS NULL THEN 0 ELSE (
        SELECT count(*) FROM public.community_walk_attendance a
        WHERE a.walk_id = nw.id
          AND a.status IN ('coming', 'checked_in', 'walking', 'finished')
      ) END,
      'myStatus', CASE WHEN nw.id IS NULL THEN NULL ELSE (
        SELECT a.status FROM public.community_walk_attendance a
        WHERE a.walk_id = nw.id AND a.user_id = v_user
      ) END,
      -- Every dog belonging to every member of this trail.
      'dogs', (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'id', pe.id, 'owner_id', pe.owner_id, 'name', pe.name, 'image_url', pe.image_url
        ) ORDER BY pe.created_at), '[]'::jsonb)
        FROM public.community_pack_members m3
        JOIN public.pets pe ON pe.owner_id = m3.user_id AND pe.species = 'dog'
        WHERE m3.pack_id = p.id
      ),
      -- The newest contributed photo anywhere on this trail. A withdrawn photo
      -- must not keep fronting the trail, hence removed_at.
      'coverPath', (
        SELECT sm.display_path
        FROM public.community_shared_media sm
        JOIN public.community_walks w2 ON w2.id = sm.walk_id
        WHERE w2.pack_id = p.id
          AND sm.display_path IS NOT NULL
          AND sm.removed_at IS NULL
        ORDER BY sm.captured_at DESC
        LIMIT 1
      ),
      -- A first name, because this reads as "Mira hosts" in a sentence.
      -- Null rather than a placeholder: the subtitle drops the whole clause.
      'hostName', CASE WHEN nw.id IS NULL THEN NULL ELSE (
        SELECT coalesce(
          nullif(split_part(trim(pr.full_name), ' ', 1), ''),
          CASE WHEN pr.username IS NULL THEN NULL ELSE '@' || pr.username END
        )
        FROM public.profiles pr WHERE pr.id = nw.organizer_id
      ) END
    ) AS row
    FROM mine
    JOIN public.community_packs p ON p.id = mine.pack_id
    LEFT JOIN next_walk nw ON nw.pack_id = p.id
  ) rows;

  RETURN jsonb_build_object(
    'trails', v_trails,
    'username', (SELECT pr.username FROM public.profiles pr WHERE pr.id = v_user)
  );
END;
$$;

-- ── 2. One walk, with its roster ────────────────────────────────────────────
--
-- Replaces seven queries in three waves. The first of those existed only to
-- learn `pack_id` — an entire round trip for one UUID.
--
-- The roster is the whole accepted pack, not just people who have answered:
-- attendance rows are created lazily, so a query of that table alone made
-- unanswered members vanish from the screen. Missing answers come back as
-- `invited` in the document; the database is unchanged until someone responds.
CREATE OR REPLACE FUNCTION public.community_outing(p_walk_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_walk public.community_walks;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  -- THE check. Same helper the RLS policies use, so "may see this walk" has
  -- one definition rather than two.
  IF NOT public.can_access_community_walk(p_walk_id, v_user) THEN
    RAISE EXCEPTION 'walk_access_denied';
  END IF;

  SELECT * INTO v_walk FROM public.community_walks w WHERE w.id = p_walk_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_not_found'; END IF;

  RETURN jsonb_build_object(
    'walk', to_jsonb(v_walk),
    'pack', (SELECT to_jsonb(p) FROM public.community_packs p WHERE p.id = v_walk.pack_id),
    'people', (
      WITH roster AS (
        SELECT m.user_id FROM public.community_pack_members m WHERE m.pack_id = v_walk.pack_id
        UNION
        SELECT a.user_id FROM public.community_walk_attendance a WHERE a.walk_id = p_walk_id
      )
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'user_id', roster.user_id,
        'attendance', (
          SELECT to_jsonb(a) FROM public.community_walk_attendance a
          WHERE a.walk_id = p_walk_id AND a.user_id = roster.user_id
        ),
        'person', (
          SELECT jsonb_build_object('id', pr.id, 'username', pr.username,
            'full_name', pr.full_name, 'avatar_url', pr.avatar_url)
          FROM public.profiles pr WHERE pr.id = roster.user_id
        ),
        -- The dogs they brought to THIS walk if they chose any, otherwise all
        -- of theirs. The screen shows who is coming, and before anyone picks
        -- that is still their dogs.
        'dogs', coalesce((
          SELECT jsonb_agg(jsonb_build_object('id', pe.id, 'owner_id', pe.owner_id,
            'name', pe.name, 'image_url', pe.image_url))
          FROM public.community_walk_participant_pets pp
          JOIN public.pets pe ON pe.id = pp.pet_id
          WHERE pp.walk_id = p_walk_id AND pp.user_id = roster.user_id
        ), (
          SELECT coalesce(jsonb_agg(jsonb_build_object('id', pe.id, 'owner_id', pe.owner_id,
            'name', pe.name, 'image_url', pe.image_url) ORDER BY pe.created_at), '[]'::jsonb)
          FROM public.pets pe
          WHERE pe.owner_id = roster.user_id AND pe.species = 'dog'
        ))
      )), '[]'::jsonb)
      FROM roster
    )
  );
END;
$$;

-- ── 3. The shared memory ────────────────────────────────────────────────────
--
-- Replaces eight queries in FIVE waves, two of which were serial for no
-- reason — hearts and routes are independent and were awaited one after the
-- other.
--
-- Routes come back whole. They are small today (17 points on average) and the
-- memory screen draws every walker's line, so there is nothing to trim yet;
-- when a real 45-minute walk lands here at ~900 points, this is the place to
-- simplify, server-side, before it crosses the wire.
CREATE OR REPLACE FUNCTION public.community_memory(p_walk_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF NOT public.can_access_community_walk(p_walk_id, v_user) THEN
    RAISE EXCEPTION 'walk_access_denied';
  END IF;

  RETURN jsonb_build_object(
    'outing', public.community_outing(p_walk_id),
    'moments', (
      SELECT coalesce(jsonb_agg(to_jsonb(sm) || jsonb_build_object(
        'heartCount', (
          SELECT count(*) FROM public.community_media_hearts h WHERE h.media_id = sm.id
        ),
        'heartedByMe', EXISTS (
          SELECT 1 FROM public.community_media_hearts h
          WHERE h.media_id = sm.id AND h.user_id = v_user
        )
      ) ORDER BY sm.captured_at), '[]'::jsonb)
      FROM public.community_shared_media sm
      WHERE sm.walk_id = p_walk_id AND sm.removed_at IS NULL
    ),
    'sessions', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'user_id', cws.user_id,
        'walk_session_id', cws.walk_session_id,
        'route', ws.route,
        'distance_m', ws.distance_m,
        'duration_s', ws.duration_s,
        'sniff_points', ws.sniff_points
      )), '[]'::jsonb)
      FROM public.community_walk_sessions cws
      LEFT JOIN public.walk_sessions ws ON ws.id = cws.walk_session_id
      WHERE cws.walk_id = p_walk_id
    )
  );
END;
$$;

-- ── 4. Join requests across every trail at once ─────────────────────────────
--
-- The Together screen called list_external_community_claims once PER owned
-- trail. Eight trails meant eight concurrent round trips to draw one number on
-- one pill.
--
-- Silently skips packs the caller does not own rather than raising: this is
-- driven by a list the client assembled, and one stale id in it should cost
-- that trail's requests, not the whole pill.
CREATE OR REPLACE FUNCTION public.community_claims_for_packs(p_pack_ids UUID[])
RETURNS TABLE (
  pack_id UUID,
  invitation_id UUID,
  claimant_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  dogs JSONB,
  claimed_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;
  IF p_pack_ids IS NULL OR array_length(p_pack_ids, 1) IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT i.pack_id, i.id, i.claimed_by, pr.username, pr.full_name, pr.avatar_url,
    coalesce(jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb),
    i.responded_at
  FROM public.community_pack_invitations i
  JOIN public.community_packs pk ON pk.id = i.pack_id
  JOIN public.profiles pr ON pr.id = i.claimed_by
  LEFT JOIN public.pets pet ON pet.owner_id = i.claimed_by AND pet.species = 'dog'
  WHERE i.pack_id = ANY(p_pack_ids)
    AND i.state = 'pending_host'
    -- The check, per row: only trails this caller actually owns.
    AND pk.owner_id = v_user
  GROUP BY i.pack_id, i.id, i.claimed_by, pr.username, pr.full_name, pr.avatar_url,
    i.responded_at, i.created_at
  ORDER BY i.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.community_trails_for_me() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_outing(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_memory(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.community_claims_for_packs(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_trails_for_me() TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_outing(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_memory(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_claims_for_packs(UUID[]) TO authenticated;

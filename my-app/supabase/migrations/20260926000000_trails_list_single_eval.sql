-- Connect's trail list: evaluate each trail's subqueries once, not twice.
--
-- `community_trails_for_me` aggregated with
--
--     jsonb_agg(row ORDER BY row->>'joined_at' DESC)
--
-- Sorting by a field read back OUT of the constructed JSON row made PostgreSQL
-- evaluate the row expression twice — once for the output and once for the
-- sort key — and with it every correlated subquery inside it (member count,
-- going count, my status, every dog of every member, the cover photo, the
-- host's name). An external audit's bounded plans (2026-09-26) showed two sets
-- of those subplans for a 13-trail user; ordering by the underlying column
-- produced one.
--
-- The fix only changes the ORDER BY: the sort keys are selected as plain
-- columns beside the row. Output shape, contents and authorisation are
-- identical to 20260925000000_trails_next_walk_live.sql. `sort_id` makes the
-- order deterministic when two memberships share a joined_at (the old text
-- sort left ties arbitrary). CREATE OR REPLACE keeps owner and grants.
--
-- Rollback: re-run the function body from 20260925000000.

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
    -- One walk per trail — the one the Connect screen should lead with, by
    -- the SAME rules as lib/community/upNext.ts:
    --   1. a walk that is running, whatever time it was scheduled for;
    --   2. the soonest dated plan still ahead, or started under 3 h ago
    --      (upNext's OVERDUE_GRACE_MS — people are late);
    --   3. an undated plan.
    SELECT DISTINCT ON (w.pack_id) w.*
    FROM public.community_walks w
    JOIN mine ON mine.pack_id = w.pack_id
    WHERE w.state = 'active'
       OR (w.state = 'planned'
           AND (w.scheduled_for IS NULL OR w.scheduled_for >= now() - interval '3 hours'))
    ORDER BY w.pack_id,
      (w.state = 'active') DESC,
      w.scheduled_for ASC NULLS LAST
  )
  SELECT coalesce(jsonb_agg(row ORDER BY sort_at DESC, sort_id), '[]'::jsonb)
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
    ) AS row,
    -- The sort keys, as plain columns. Ordering by `row->>'joined_at'` made
    -- the planner evaluate every correlated subquery above twice.
    mine.joined_at AS sort_at,
    p.id AS sort_id
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

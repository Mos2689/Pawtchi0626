-- Connect's "next walk" per meetup: stop hiding walks that have started.
--
-- ── The bug ────────────────────────────────────────────────────────────────
--
-- `community_trails_for_me` picked each trail's next walk with
--
--     WHERE state IN ('planned','active')
--       AND (scheduled_for >= now() OR scheduled_for IS NULL)
--     ORDER BY scheduled_for ASC NULLS FIRST
--
-- so the moment a walk's scheduled time passed it vanished from Connect —
-- including a walk that was RUNNING (state 'active'), and a planned walk whose
-- people were ten minutes late. Connect then said "No walk planned yet" on the
-- row and "NOTHING PLANNED" on the Up Next card for a meetup that was
-- happening. The app's own rules (lib/community/upNext.ts) say the opposite: a
-- live walk leads everything, and a late plan stays up for three hours.
--
-- It also sorted undated walks FIRST, so a trail with a dated plan on Sunday
-- and an undated idea led with the idea. upNext.ts sorts undated LAST.
--
-- ── The fix ────────────────────────────────────────────────────────────────
--
-- The next_walk CTE only; the rest of the function is byte-identical to
-- 20260922010000_community_read_path.sql. CREATE OR REPLACE keeps its owner
-- and grants (authenticated only, anon revoked there).
--
-- Rollback: re-run the function body from 20260922010000.

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

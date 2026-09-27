-- Two consolidations from the Connect performance audit (2026-09-26):
--
--   F4  join_community_walk   — joining a walk was 3 serial client writes
--                               (attendance upsert → delete dogs → insert dogs),
--                               4 for a host starting it. Now 1 transaction.
--   F5  community_pack_detail — the meetup screen was 6 requests in 2 waves.
--                               Now this plus list_pack_invitations, 1 wave.
--
-- Both are SECURITY DEFINER, so the RLS policies that used to guard these reads
-- and writes do NOT apply inside them. Every check those policies made is
-- restated below, explicitly, as the first thing each function does — see
-- [[together-read-path-rpcs]]: a definer function without them is a data leak.

-- ── F4. Join (and, for the host, start) a walk ─────────────────────────────
--
-- Restates, in order:
--   * community_walks_update_host      — only the pack OWNER may start a walk,
--                                        and only a planned one (the client's
--                                        old `.eq('state','planned')`).
--   * community_attendance_write_self / update_self
--                                      — you may only write yourself, only on a
--                                        walk you can access, only while it is
--                                        open (planned/active).
--   * community_walk_pets_write_self   — only dogs you own.
--
-- One transaction: a failure anywhere leaves nothing half-written — no more
-- "attendance says walking but the dogs never saved". Safe to retry: the
-- attendance write is an upsert and the dogs are replaced, not appended.
-- Triggers on these tables (notification enqueues) fire exactly as they did
-- for the separate client writes.
CREATE OR REPLACE FUNCTION public.join_community_walk(
  p_walk_id UUID,
  p_pet_ids UUID[],
  p_share_location BOOLEAN,
  p_start BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_walk public.community_walks;
  v_now TIMESTAMPTZ := now();
  v_pets UUID[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_pet_ids, '{}'::UUID[])));
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  -- Locked for the length of the join, so a host closing the walk at the same
  -- moment either lands before (and this refuses) or after (and sees us).
  SELECT * INTO v_walk FROM public.community_walks WHERE id = p_walk_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_not_found'; END IF;
  IF NOT public.can_access_community_walk(p_walk_id, v_user) THEN
    RAISE EXCEPTION 'walk_access_denied';
  END IF;

  IF p_start THEN
    IF NOT public.is_community_pack_owner(v_walk.pack_id, v_user) THEN
      RAISE EXCEPTION 'pack_host_required';
    END IF;
    IF v_walk.state = 'planned' THEN
      UPDATE public.community_walks
        SET state = 'active', started_at = v_now, updated_at = v_now
        WHERE id = p_walk_id;
      v_walk.state := 'active';
    END IF;
  END IF;

  IF v_walk.state NOT IN ('planned', 'active') THEN RAISE EXCEPTION 'walk_closed'; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(v_pets) AS wanted(pet_id)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.pets p WHERE p.id = wanted.pet_id AND p.owner_id = v_user
    )
  ) THEN
    RAISE EXCEPTION 'pet_not_yours';
  END IF;

  INSERT INTO public.community_walk_attendance
    (walk_id, user_id, status, share_location, joined_at, updated_at)
  VALUES (p_walk_id, v_user, 'walking', coalesce(p_share_location, FALSE), v_now, v_now)
  ON CONFLICT (walk_id, user_id) DO UPDATE
    SET status = 'walking',
        share_location = EXCLUDED.share_location,
        joined_at = EXCLUDED.joined_at,
        updated_at = EXCLUDED.updated_at;

  DELETE FROM public.community_walk_participant_pets
    WHERE walk_id = p_walk_id AND user_id = v_user;
  INSERT INTO public.community_walk_participant_pets (walk_id, user_id, pet_id)
    SELECT p_walk_id, v_user, wanted.pet_id FROM unnest(v_pets) AS wanted(pet_id);
END;
$$;

-- ── F5. A meetup's screen, in one read ─────────────────────────────────────
--
-- Returns exactly what the six client reads returned, under the same rules:
--   * community_packs_read_members  — members AND people with an invitation
--                                     may read the pack itself;
--   * members / walks / profiles / dogs are member-only (the member, walk,
--     profile and pet policies all require a shared membership).
-- So: a member gets everything; an invitee gets the pack with empty members
-- and walks (which is what the client used to get); anyone else is refused.
-- Walks: the newest 30 by scheduled_for, undated last — as before.
-- Invitations are NOT here: list_pack_invitations keeps its own authorisation
-- and is called alongside this, in the same wave.
CREATE OR REPLACE FUNCTION public.community_pack_detail(p_pack_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user UUID := auth.uid();
  v_member BOOLEAN;
  v_pack JSONB;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  v_member := public.is_community_pack_member(p_pack_id, v_user);
  IF NOT v_member AND NOT public.has_community_pack_invite(p_pack_id, v_user) THEN
    RAISE EXCEPTION 'pack_access_denied';
  END IF;

  SELECT to_jsonb(p) INTO v_pack FROM public.community_packs p WHERE p.id = p_pack_id;
  IF v_pack IS NULL THEN RAISE EXCEPTION 'pack_access_denied'; END IF;

  IF NOT v_member THEN
    RETURN jsonb_build_object('pack', v_pack, 'members', '[]'::jsonb, 'walks', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'pack', v_pack,
    'members', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'pack_id', m.pack_id,
        'user_id', m.user_id,
        'role', m.role,
        'joined_at', m.joined_at,
        'notifications_muted', m.notifications_muted,
        'person', (
          SELECT jsonb_build_object(
            'id', pr.id, 'username', pr.username,
            'full_name', pr.full_name, 'avatar_url', pr.avatar_url
          )
          FROM public.profiles pr WHERE pr.id = m.user_id
        ),
        'dogs', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'id', pe.id, 'owner_id', pe.owner_id, 'name', pe.name, 'image_url', pe.image_url
          ) ORDER BY pe.created_at), '[]'::jsonb)
          FROM public.pets pe
          WHERE pe.owner_id = m.user_id AND pe.species = 'dog'
        )
      ) ORDER BY m.joined_at), '[]'::jsonb)
      FROM public.community_pack_members m
      WHERE m.pack_id = p_pack_id
    ),
    'walks', (
      SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.scheduled_for DESC NULLS LAST, w.id), '[]'::jsonb)
      FROM (
        SELECT * FROM public.community_walks
        WHERE pack_id = p_pack_id
        ORDER BY scheduled_for DESC NULLS LAST, id
        LIMIT 30
      ) w
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_community_walk(UUID, UUID[], BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_community_walk(UUID, UUID[], BOOLEAN, BOOLEAN) TO authenticated;
REVOKE ALL ON FUNCTION public.community_pack_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_pack_detail(UUID) TO authenticated;

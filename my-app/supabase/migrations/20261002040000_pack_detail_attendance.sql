-- community_pack_detail: also return each listed walk's attendance (perf Train 2).
--
-- Opening a walk from a meetup showed an empty "Who's walking" list and a
-- disabled button until `community_outing` made a second round trip — though
-- the meetup screen had just loaded every member's name and dogs. The only
-- thing it lacked was who had answered each walk. With this, the app builds the
-- walk screen's whole roster before the walk is even opened (lib/community/
-- outingDoc.ts, behind the perf-walk-instant-open flag) and community_outing
-- only reconciles behind it.
--
-- ADDITIVE: one new top-level key, `attendance`, mapping walk id → rows for
-- the same 30 walks already returned. Each row is `to_jsonb(a)` — exactly the
-- object community_outing returns for that person — plus the pet ids they chose
-- for the walk. The walk objects themselves are unchanged, and old app builds
-- ignore the new key.
--
-- Visibility is unchanged: only members get walks (and so attendance) at all,
-- and a member could already read every one of these rows through
-- community_outing (can_access_community_walk admits pack members). Both
-- lookups lead with walk_id on a primary key.
--
-- Rollback: supabase/rollbacks/20261002040000_pack_detail_attendance.down.sql

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
    RETURN jsonb_build_object('pack', v_pack, 'members', '[]'::jsonb, 'walks', '[]'::jsonb,
                              'attendance', '{}'::jsonb);
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
    ),
    -- NEW: walk id → [{ row: <attendance row>, pet_ids: [...] }], same 30 walks.
    'attendance', (
      SELECT coalesce(jsonb_object_agg(w.id, (
        SELECT coalesce(jsonb_agg(jsonb_build_object(
          'row', to_jsonb(a),
          'pet_ids', coalesce((
            SELECT jsonb_agg(pp.pet_id ORDER BY pp.joined_at, pp.pet_id)
              FROM public.community_walk_participant_pets pp
             WHERE pp.walk_id = a.walk_id AND pp.user_id = a.user_id
          ), '[]'::jsonb)
        ) ORDER BY a.user_id), '[]'::jsonb)
        FROM public.community_walk_attendance a
        WHERE a.walk_id = w.id
      )), '{}'::jsonb)
      FROM (
        SELECT id FROM public.community_walks
        WHERE pack_id = p_pack_id
        ORDER BY scheduled_for DESC NULLS LAST, id
        LIMIT 30
      ) w
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.community_pack_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_pack_detail(UUID) TO authenticated;

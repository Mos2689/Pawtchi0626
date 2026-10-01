-- Undo 20261002040000_pack_detail_attendance.sql. Run in the SQL editor.
-- Restores community_pack_detail exactly as 20260926010000 defined it.

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

REVOKE ALL ON FUNCTION public.community_pack_detail(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.community_pack_detail(UUID) TO authenticated;

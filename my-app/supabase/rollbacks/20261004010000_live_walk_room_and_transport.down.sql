-- Undo 20261004010000_live_walk_room_and_transport.sql. Run in the SQL editor.
--
-- ONLY while no installed build calls join_community_walk_v2 or uses the
-- private `walk:` room. Once one does, the lever is operational, not this:
--   UPDATE private.live_settings SET broadcast_enabled = false, updated_at = now();
--   UPDATE public.community_walks SET live_transport = 'db' WHERE state = 'active';
-- and the room policies stay.

BEGIN;

-- v1 back to its own body (20260926010000), no longer delegating to v2.
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

DROP FUNCTION IF EXISTS public.join_community_walk_v2(UUID, UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN);

DROP POLICY IF EXISTS live_walk_room_read ON realtime.messages;
DROP POLICY IF EXISTS live_walk_room_write ON realtime.messages;
DROP FUNCTION IF EXISTS private.walk_id_from_topic(TEXT);

DROP TRIGGER IF EXISTS community_walk_live_transport_guard ON public.community_walks;
DROP FUNCTION IF EXISTS private.guard_live_transport();
ALTER TABLE public.community_walks DROP CONSTRAINT IF EXISTS community_walks_live_transport;
ALTER TABLE public.community_walks DROP COLUMN IF EXISTS live_transport;

DROP TABLE IF EXISTS private.live_settings;

COMMIT;

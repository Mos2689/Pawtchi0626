-- Live Walk v2, Phase 1: the private room, the walk-level transport, the
-- server kill switch, and the build gate.
--
-- Inert until a supported build uses it:
--   * Broadcast is OFF (private.live_settings.broadcast_enabled = false), so
--     every walk keeps starting as `db`, exactly as today.
--   * The room policies only matter to private channels named `walk:<id>`,
--     which no shipped build opens.
--   * join_community_walk (v1, builds 98/99) keeps its signature and its
--     behaviour; it now delegates to v2 and is refused only on a `broadcast`
--     walk, which cannot exist while Broadcast is off.
--
-- Operating it (SQL editor, as postgres):
--   kill switch, new walks:  UPDATE private.live_settings SET broadcast_enabled = false, updated_at = now();
--   emergency, running walks: UPDATE public.community_walks SET live_transport = 'db' WHERE state = 'active';
--   build gate:               UPDATE private.live_settings SET min_protocol = <n>, updated_at = now();
-- Keep the room policies in place when doing either: both transports use the
-- private room for Presence and database changes.
--
-- Rollback (only while no build calls join_community_walk_v2):
--   supabase/rollbacks/20261004010000_live_walk_room_and_transport.down.sql

-- ── Settings: one row, admin-only ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS private.live_settings (
  singleton         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
  broadcast_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  min_protocol      INTEGER NOT NULL DEFAULT 2 CHECK (min_protocol >= 1),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO private.live_settings DEFAULT VALUES ON CONFLICT (singleton) DO NOTHING;
ALTER TABLE private.live_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.live_settings FROM PUBLIC, anon, authenticated;

-- ── The walk's transport, decided by the server at start ────────────────────

ALTER TABLE public.community_walks
  ADD COLUMN IF NOT EXISTS live_transport TEXT NOT NULL DEFAULT 'db';
ALTER TABLE public.community_walks
  ADD CONSTRAINT community_walks_live_transport CHECK (live_transport IN ('db', 'broadcast'));

-- The host may update their walk directly (closeOuting does), so without this
-- they could also switch it to `broadcast` past the kill switch. Signed-in
-- users never choose a transport: inserts get `db`, changes are refused. The
-- join RPC and an admin in the SQL editor run as postgres and are unaffected.
CREATE OR REPLACE FUNCTION private.guard_live_transport()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      NEW.live_transport := 'db';
    ELSIF NEW.live_transport IS DISTINCT FROM OLD.live_transport THEN
      RAISE EXCEPTION 'live_transport_locked' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_live_transport() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_walk_live_transport_guard ON public.community_walks;
CREATE TRIGGER community_walk_live_transport_guard
  BEFORE INSERT OR UPDATE OF live_transport ON public.community_walks
  FOR EACH ROW EXECUTE FUNCTION private.guard_live_transport();

-- ── The room: private Broadcast + Presence on `walk:<walk id>` ──────────────

-- `walk:` followed by a lowercase UUID, or NULL. Never raises, whatever the
-- topic, because it runs inside a policy on every private join.
CREATE OR REPLACE FUNCTION private.walk_id_from_topic(p_topic TEXT)
RETURNS UUID
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_topic ~ '^walk:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    THEN substr(p_topic, 6)::UUID
  END;
$$;
REVOKE ALL ON FUNCTION private.walk_id_from_topic(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.walk_id_from_topic(TEXT) TO authenticated;

-- The same rule as reading positions: a member attending this active walk.
-- Sending is allowed on the same terms (walkers send positions, viewers ask
-- for a catch-up).
DROP POLICY IF EXISTS live_walk_room_read ON realtime.messages;
CREATE POLICY live_walk_room_read ON realtime.messages
  FOR SELECT TO authenticated
  USING (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND private.can_view_live_walk(private.walk_id_from_topic((SELECT realtime.topic())))
  );

DROP POLICY IF EXISTS live_walk_room_write ON realtime.messages;
CREATE POLICY live_walk_room_write ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.messages.extension IN ('broadcast', 'presence')
    AND private.can_view_live_walk(private.walk_id_from_topic((SELECT realtime.topic())))
  );

-- ── join_community_walk_v2 ──────────────────────────────────────────────────
-- v1's checks, restated in the same order (see 20260926010000), plus:
--   * on start, the SERVER picks the transport: `broadcast` only when the kill
--     switch allows it, the host asked for it and the host's build is new
--     enough; otherwise `db`;
--   * a build older than min_protocol cannot join a `broadcast` walk
--     (`update_required`);
--   * returns { live_transport }. It issues no session generation:
--     begin_live_session is the only issuer.

CREATE OR REPLACE FUNCTION public.join_community_walk_v2(
  p_walk_id           UUID,
  p_pet_ids           UUID[],
  p_share_location    BOOLEAN,
  p_start             BOOLEAN DEFAULT FALSE,
  p_live_protocol     INTEGER DEFAULT 1,
  p_request_broadcast BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user     UUID := auth.uid();
  v_walk     public.community_walks;
  v_now      TIMESTAMPTZ := now();
  v_pets     UUID[] := ARRAY(SELECT DISTINCT unnest(coalesce(p_pet_ids, '{}'::UUID[])));
  v_protocol INTEGER := coalesce(p_live_protocol, 1);
  v_enabled  BOOLEAN;
  v_min      INTEGER;
BEGIN
  IF v_user IS NULL THEN RAISE EXCEPTION 'auth_required'; END IF;

  -- Locked for the length of the join, so a host closing the walk at the same
  -- moment either lands before (and this refuses) or after (and sees us).
  SELECT * INTO v_walk FROM public.community_walks WHERE id = p_walk_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'walk_not_found'; END IF;
  IF NOT public.can_access_community_walk(p_walk_id, v_user) THEN
    RAISE EXCEPTION 'walk_access_denied';
  END IF;

  -- A missing settings row reads as "Broadcast off, protocol 2 required".
  SELECT s.broadcast_enabled, s.min_protocol INTO v_enabled, v_min FROM private.live_settings s LIMIT 1;
  v_enabled := coalesce(v_enabled, FALSE);
  v_min := coalesce(v_min, 2);

  IF p_start THEN
    IF NOT public.is_community_pack_owner(v_walk.pack_id, v_user) THEN
      RAISE EXCEPTION 'pack_host_required';
    END IF;
    IF v_walk.state = 'planned' THEN
      v_walk.live_transport := CASE
        WHEN v_enabled AND coalesce(p_request_broadcast, FALSE) AND v_protocol >= v_min THEN 'broadcast'
        ELSE 'db'
      END;
      UPDATE public.community_walks
        SET state = 'active', started_at = v_now, updated_at = v_now, live_transport = v_walk.live_transport
        WHERE id = p_walk_id;
      v_walk.state := 'active';
    END IF;
  END IF;

  IF v_walk.state NOT IN ('planned', 'active') THEN RAISE EXCEPTION 'walk_closed'; END IF;

  IF v_walk.live_transport = 'broadcast' AND v_protocol < v_min THEN
    RAISE EXCEPTION 'update_required';
  END IF;

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

  RETURN jsonb_build_object('live_transport', v_walk.live_transport);
END;
$$;

REVOKE ALL ON FUNCTION public.join_community_walk_v2(UUID, UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_community_walk_v2(UUID, UUID[], BOOLEAN, BOOLEAN, INTEGER, BOOLEAN) TO authenticated;

-- ── v1: same signature, same behaviour, one implementation ──────────────────
-- Builds 98/99 call this. As protocol 1 it never asks for Broadcast, so it
-- only ever starts `db` walks, and it is refused (`update_required`) on a
-- `broadcast` walk it could not take part in.

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
BEGIN
  PERFORM public.join_community_walk_v2(p_walk_id, p_pet_ids, p_share_location, p_start, 1, FALSE);
END;
$$;

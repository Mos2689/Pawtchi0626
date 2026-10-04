-- Live Walk v2, Phase 0a: live-location privacy fix and the hardened write path.
--
-- ── 1. The privacy bug this closes ──────────────────────────────────────────
--
-- The three community_live_locations policies (20260917000000) compare an
-- UNQUALIFIED `walk_id` inside their EXISTS subqueries. Inside the subquery
-- that name binds to the attendance alias, not to the row being checked, so in
-- production they read:
--
--   SELECT  … WHERE w.id = a.walk_id …        (a join condition, not a filter)
--   INSERT/UPDATE … WHERE a.walk_id = a.walk_id …   (always true)
--
-- So a pack member could read the live positions of ANY walk in their pack
-- while attending ANY active walk anywhere, and could write a position into
-- any walk in their pack while walking-and-sharing in some other walk. The new
-- policies call one private helper each, whose only input is the row's own,
-- fully qualified walk id.
--
-- ── 2. The write path Live Walk v2 publishes through ────────────────────────
--
--   begin_live_session(walk, start_token) — the ONLY issuer of a session
--     generation `gen`. One per publisher runtime; idempotent per token; a
--     retry of an older token can never advance it.
--   publish_live_location(…)  — authorised, validated, lock-protected upsert,
--     ordered by (gen, seq) so a late or superseded write can never overwrite a
--     newer one. Sender clocks are never trusted: the phone sends AGES and the
--     server derives `fix_at` on its own clock.
--   live_walk_positions(walk) — positions + server time + generation
--     watermarks, for receivers to compute every age on the server's clock.
--
-- ── 3. Additive, and safe for the builds in the field ───────────────────────
--
-- Direct table writes stay allowed (TestFlight build 99 still upserts), under
-- the corrected policies. New columns are nullable or defaulted. Revoking the
-- direct writes is Phase 0b, a separate migration that ships with the build
-- that no longer needs them.
--
-- Every existing row is deleted once. They are disposable checkpoints (each
-- walking phone rewrites its own every 12 s), and this removes rows with no
-- (gen, seq) ordering metadata before the ordered RPC exists.
--
-- Rollback: supabase/rollbacks/20261004000000_live_walk_privacy_and_rpc.down.sql
-- (deliberately partial — read it before running it).

-- ── Private helpers ─────────────────────────────────────────────────────────
-- No user parameter: the caller is always auth.uid(), so nothing here can be
-- used to ask about somebody else. The `private` schema is not exposed through
-- the API; `authenticated` needs EXECUTE only because RLS policies call them.

CREATE OR REPLACE FUNCTION private.can_view_live_walk(p_walk UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.community_walks w
      JOIN public.community_pack_members m
        ON m.pack_id = w.pack_id AND m.user_id = (SELECT auth.uid())
      JOIN public.community_walk_attendance a
        ON a.walk_id = w.id AND a.user_id = (SELECT auth.uid())
     WHERE w.id = p_walk
       AND w.state = 'active'
       AND a.status IN ('coming', 'checked_in', 'walking', 'finished')
  );
$$;

CREATE OR REPLACE FUNCTION private.can_share_live_walk(p_walk UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.community_walks w
      JOIN public.community_pack_members m
        ON m.pack_id = w.pack_id AND m.user_id = (SELECT auth.uid())
      JOIN public.community_walk_attendance a
        ON a.walk_id = w.id AND a.user_id = (SELECT auth.uid())
     WHERE w.id = p_walk
       AND w.state = 'active'
       AND a.status = 'walking'
       AND a.share_location
  );
$$;

-- Why a write was refused, for the RPCs below only. `walk_closed` is said only
-- to someone with an attendance row on that walk; everyone else, including
-- non-members guessing ids, hears the same `not_sharing`.
CREATE OR REPLACE FUNCTION private.live_refusal(p_walk UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE WHEN EXISTS (
    SELECT 1
      FROM public.community_walks w
      JOIN public.community_walk_attendance a
        ON a.walk_id = w.id AND a.user_id = (SELECT auth.uid())
     WHERE w.id = p_walk
       AND w.state IN ('completed', 'cancelled')
  ) THEN 'walk_closed' ELSE 'not_sharing' END;
$$;

REVOKE ALL ON FUNCTION private.can_view_live_walk(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.can_share_live_walk(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.live_refusal(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.can_view_live_walk(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION private.can_share_live_walk(UUID) TO authenticated;

-- ── Corrected policies ──────────────────────────────────────────────────────

DROP POLICY IF EXISTS community_locations_read_attendees ON public.community_live_locations;
DROP POLICY IF EXISTS community_locations_write_self ON public.community_live_locations;
DROP POLICY IF EXISTS community_locations_update_self ON public.community_live_locations;

CREATE POLICY community_locations_read_attendees ON public.community_live_locations
  FOR SELECT TO authenticated
  USING (private.can_view_live_walk(community_live_locations.walk_id));

CREATE POLICY community_locations_write_self ON public.community_live_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    community_live_locations.user_id = (SELECT auth.uid())
    AND private.can_share_live_walk(community_live_locations.walk_id)
  );

CREATE POLICY community_locations_update_self ON public.community_live_locations
  FOR UPDATE TO authenticated
  USING (
    community_live_locations.user_id = (SELECT auth.uid())
    AND private.can_share_live_walk(community_live_locations.walk_id)
  )
  WITH CHECK (
    community_live_locations.user_id = (SELECT auth.uid())
    AND private.can_share_live_walk(community_live_locations.walk_id)
  );

-- ── Disposable rows out, ordering metadata in ───────────────────────────────

DELETE FROM public.community_live_locations;

ALTER TABLE public.community_live_locations
  ADD COLUMN IF NOT EXISTS live_gen      INTEGER,
  ADD COLUMN IF NOT EXISTS seq           BIGINT,
  ADD COLUMN IF NOT EXISTS fix_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS obs_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS heard_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS route_version INTEGER;

ALTER TABLE public.community_live_locations
  ADD CONSTRAINT community_live_locations_gen_seq
    CHECK ((live_gen IS NULL) = (seq IS NULL)),
  ADD CONSTRAINT community_live_locations_gen_range
    CHECK (live_gen IS NULL OR live_gen >= 1),
  ADD CONSTRAINT community_live_locations_seq_range
    CHECK (seq IS NULL OR (seq >= 1 AND seq < 2147483648)),
  ADD CONSTRAINT community_live_locations_route_version_range
    CHECK (route_version IS NULL OR route_version BETWEEN 0 AND 100000);

COMMENT ON COLUMN public.community_live_locations.live_gen IS
  'Session generation from begin_live_session. NULL only for direct writes from builds before Live Walk v2.';
COMMENT ON COLUMN public.community_live_locations.seq IS
  'Per (walk, user, live_gen) sequence shared by Broadcast and RPC writes. (live_gen, seq) orders writes.';
COMMENT ON COLUMN public.community_live_locations.fix_at IS
  'Server-derived time of the GPS fix: now() minus the age the phone reported.';
COMMENT ON COLUMN public.community_live_locations.obs_at IS
  'Server-derived time of the latest raw GPS observation (may be newer than the accepted fix).';
COMMENT ON COLUMN public.community_live_locations.sent_at IS
  'The phone''s own clock when it sent. Diagnostic only: never compared with server time.';
COMMENT ON COLUMN public.community_live_locations.heard_at IS
  'Server time of the last write, whoever wrote it. The stale-walk watcher''s activity signal.';
COMMENT ON COLUMN public.community_live_locations.route_version IS
  'The sender''s full route length when it wrote `path` (a simplified snapshot of indices below it).';

-- heard_at is the server's, on every write including a direct upsert from an
-- older build, which would otherwise leave the insert-time default in place.
CREATE OR REPLACE FUNCTION private.stamp_live_location_heard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.heard_at := now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.stamp_live_location_heard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_live_location_heard ON public.community_live_locations;
CREATE TRIGGER community_live_location_heard
  BEFORE INSERT OR UPDATE ON public.community_live_locations
  FOR EACH ROW EXECUTE FUNCTION private.stamp_live_location_heard();

-- ── Session generations ─────────────────────────────────────────────────────
-- Not reachable from the API: no grants, RLS on with no policies. Only the
-- SECURITY DEFINER functions below read or write them.

CREATE TABLE IF NOT EXISTS private.live_sessions (
  walk_id   UUID NOT NULL REFERENCES public.community_walks(id) ON DELETE CASCADE,
  user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  gen       INTEGER NOT NULL DEFAULT 0 CHECK (gen >= 0),
  issued_at TIMESTAMPTZ,
  PRIMARY KEY (walk_id, user_id)
);

CREATE TABLE IF NOT EXISTS private.live_session_tokens (
  walk_id     UUID NOT NULL,
  user_id     UUID NOT NULL,
  start_token UUID NOT NULL,
  gen         INTEGER NOT NULL CHECK (gen >= 1),
  issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (walk_id, user_id, start_token),
  FOREIGN KEY (walk_id, user_id) REFERENCES private.live_sessions (walk_id, user_id) ON DELETE CASCADE
);

ALTER TABLE private.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.live_session_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.live_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON private.live_session_tokens FROM PUBLIC, anon, authenticated;

-- ── begin_live_session ──────────────────────────────────────────────────────
-- Called once per publisher runtime (recording start, every relaunch or
-- restore) with a fresh, in-memory start_token. Retries of the SAME
-- acquisition reuse the token and get the same answer.
--
--   new token            → gen + 1, recorded against the token, `ok`
--   token, still current → its gen again, `ok`
--   token, since replaced→ `superseded` with the current gen; never advances
--
-- Two first acquisitions at once are serialised by insert-then-lock on the
-- session row: each gets its own increment, in order.

CREATE OR REPLACE FUNCTION public.begin_live_session(p_walk_id UUID, p_start_token UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_gen       INTEGER;
  v_token_gen INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
  END IF;
  IF p_walk_id IS NULL OR p_start_token IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Cheap refusal first, so an outsider never takes a lock.
  IF NOT private.can_share_live_walk(p_walk_id) THEN
    RETURN jsonb_build_object('status', private.live_refusal(p_walk_id), 'server_now', clock_timestamp());
  END IF;

  -- Same lock order as join_community_walk and publish_live_location: the walk,
  -- then the caller's attendance, then the session.
  PERFORM 1 FROM public.community_walks w WHERE w.id = p_walk_id FOR SHARE;
  PERFORM 1 FROM public.community_walk_attendance a
    WHERE a.walk_id = p_walk_id AND a.user_id = v_uid FOR SHARE;
  IF NOT private.can_share_live_walk(p_walk_id) THEN
    RETURN jsonb_build_object('status', private.live_refusal(p_walk_id), 'server_now', clock_timestamp());
  END IF;

  INSERT INTO private.live_sessions (walk_id, user_id)
  VALUES (p_walk_id, v_uid)
  ON CONFLICT (walk_id, user_id) DO NOTHING;

  SELECT s.gen INTO v_gen
    FROM private.live_sessions s
   WHERE s.walk_id = p_walk_id AND s.user_id = v_uid
     FOR UPDATE;

  SELECT t.gen INTO v_token_gen
    FROM private.live_session_tokens t
   WHERE t.walk_id = p_walk_id AND t.user_id = v_uid AND t.start_token = p_start_token;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', CASE WHEN v_token_gen = v_gen THEN 'ok' ELSE 'superseded' END,
      'gen', v_gen,
      'server_now', clock_timestamp()
    );
  END IF;

  v_gen := v_gen + 1;
  UPDATE private.live_sessions
     SET gen = v_gen, issued_at = now()
   WHERE walk_id = p_walk_id AND user_id = v_uid;
  INSERT INTO private.live_session_tokens (walk_id, user_id, start_token, gen)
  VALUES (p_walk_id, v_uid, p_start_token, v_gen);

  RETURN jsonb_build_object('status', 'ok', 'gen', v_gen, 'server_now', clock_timestamp());
END;
$$;

-- ── publish_live_location ───────────────────────────────────────────────────
-- Both transports write through here: every ~60 s as a checkpoint while
-- Broadcast is healthy, every ~12 s for `db` walks or as the fallback.
--
-- Ages, not timestamps: `p_fix_age_ms` is how old the GPS fix was when the
-- phone sent it, measured on the phone's own clock, so a phone whose clock is
-- minutes out still lands at the right server time. `p_sent_at` is stored for
-- diagnosis and never compared with anything.
--
-- Results: ok | stale (an older write than the stored one; ignore) |
-- superseded (another runtime owns this walker; stop) | walk_closed |
-- not_sharing (stop). Malformed input raises `invalid_input`.

CREATE OR REPLACE FUNCTION public.publish_live_location(
  p_walk_id       UUID,
  p_gen           INTEGER,
  p_seq           BIGINT,
  p_lat           DOUBLE PRECISION,
  p_lng           DOUBLE PRECISION,
  p_accuracy      DOUBLE PRECISION,
  p_fix_age_ms    INTEGER,
  p_obs_age_ms    INTEGER,
  p_sent_at       TIMESTAMPTZ,
  p_route_version INTEGER,
  p_path          JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_now     TIMESTAMPTZ := now();
  v_gen     INTEGER;
  v_path    JSONB;
  v_written INTEGER;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
  END IF;

  -- ── Validation (everything the phone sends is checked) ──
  IF p_walk_id IS NULL OR p_gen IS NULL OR p_seq IS NULL OR p_lat IS NULL OR p_lng IS NULL
     OR p_fix_age_ms IS NULL OR p_route_version IS NULL OR p_path IS NULL
     OR p_gen < 1
     OR p_seq < 1 OR p_seq >= 2147483648
     -- NaN sorts above every number in Postgres, and ±Infinity is out of range,
     -- so these comparisons also refuse non-finite values.
     OR NOT (p_lat BETWEEN -90 AND 90) OR NOT (p_lng BETWEEN -180 AND 180)
     OR (p_accuracy IS NOT NULL AND NOT (p_accuracy BETWEEN 0 AND 100000))
     OR NOT (p_fix_age_ms BETWEEN 0 AND 21600000)
     OR (p_obs_age_ms IS NOT NULL AND NOT (p_obs_age_ms BETWEEN 0 AND 21600000))
     OR NOT (p_route_version BETWEEN 0 AND 100000)
  THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Separate steps, because jsonb_array_length raises on a non-array.
  IF jsonb_typeof(p_path) <> 'array' THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_path) > 200 OR octet_length(p_path::TEXT) > 16384 THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_path) e
     WHERE NOT CASE
       WHEN jsonb_typeof(e) = 'object'
        AND jsonb_typeof(e -> 'lat') = 'number'
        AND jsonb_typeof(e -> 'lng') = 'number'
       THEN (e -> 'lat')::NUMERIC BETWEEN -90 AND 90 AND (e -> 'lng')::NUMERIC BETWEEN -180 AND 180
       ELSE FALSE
     END
  ) THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  -- Stored as plain {lat, lng} pairs, so nothing else rides along in a row
  -- every viewer downloads.
  SELECT coalesce(
           jsonb_agg(jsonb_build_object('lat', (e -> 'lat')::NUMERIC, 'lng', (e -> 'lng')::NUMERIC) ORDER BY i),
           '[]'::JSONB)
    INTO v_path
    FROM jsonb_array_elements(p_path) WITH ORDINALITY AS x(e, i);

  -- ── Authorisation, then the same check again under the locks ──
  IF NOT private.can_share_live_walk(p_walk_id) THEN
    RETURN jsonb_build_object('status', private.live_refusal(p_walk_id), 'server_now', clock_timestamp());
  END IF;

  -- FOR SHARE on the walk and the caller's attendance: a concurrent close or
  -- finish waits for this write (and its cleanup trigger then removes it), or
  -- lands first and this write is refused below. Never a position written
  -- after the walk closed.
  PERFORM 1 FROM public.community_walks w WHERE w.id = p_walk_id FOR SHARE;
  PERFORM 1 FROM public.community_walk_attendance a
    WHERE a.walk_id = p_walk_id AND a.user_id = v_uid FOR SHARE;
  SELECT s.gen INTO v_gen
    FROM private.live_sessions s
   WHERE s.walk_id = p_walk_id AND s.user_id = v_uid
     FOR SHARE;

  IF NOT private.can_share_live_walk(p_walk_id) THEN
    RETURN jsonb_build_object('status', private.live_refusal(p_walk_id), 'server_now', clock_timestamp());
  END IF;
  IF v_gen IS NULL OR p_gen <> v_gen THEN
    RETURN jsonb_build_object('status', 'superseded', 'server_now', clock_timestamp());
  END IF;

  -- ── Ordered upsert ──
  -- A row with no generation (written directly by an older build) is taken
  -- over; otherwise only a strictly newer (gen, seq) replaces what is there.
  INSERT INTO public.community_live_locations AS t
    (walk_id, user_id, lat, lng, accuracy_m, path, recorded_at,
     live_gen, seq, fix_at, obs_at, sent_at, route_version)
  VALUES
    (p_walk_id, v_uid, p_lat, p_lng, p_accuracy, v_path,
     v_now - make_interval(secs => p_fix_age_ms / 1000.0),
     p_gen, p_seq,
     v_now - make_interval(secs => p_fix_age_ms / 1000.0),
     CASE WHEN p_obs_age_ms IS NULL THEN NULL ELSE v_now - make_interval(secs => p_obs_age_ms / 1000.0) END,
     p_sent_at, p_route_version)
  ON CONFLICT (walk_id, user_id) DO UPDATE
     SET lat           = EXCLUDED.lat,
         lng           = EXCLUDED.lng,
         accuracy_m    = EXCLUDED.accuracy_m,
         path          = EXCLUDED.path,
         recorded_at   = EXCLUDED.recorded_at,
         live_gen      = EXCLUDED.live_gen,
         seq           = EXCLUDED.seq,
         fix_at        = EXCLUDED.fix_at,
         obs_at        = EXCLUDED.obs_at,
         sent_at       = EXCLUDED.sent_at,
         route_version = EXCLUDED.route_version
   WHERE t.live_gen IS NULL
      OR (EXCLUDED.live_gen, EXCLUDED.seq) > (t.live_gen, t.seq);
  GET DIAGNOSTICS v_written = ROW_COUNT;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_written = 1 THEN 'ok' ELSE 'stale' END,
    'server_now', clock_timestamp()
  );
END;
$$;

-- ── live_walk_positions ─────────────────────────────────────────────────────
-- The receiver's read: every visible position, the server's clock, and each
-- walker's current generation (so a delayed message from an older session can
-- never bring a walker back). Someone who may not see the walk gets an empty,
-- non-error answer, exactly as the RLS-filtered table read gave them before.

CREATE OR REPLACE FUNCTION public.live_walk_positions(p_walk_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '28000';
  END IF;
  IF p_walk_id IS NULL THEN
    RAISE EXCEPTION 'invalid_input' USING ERRCODE = '22023';
  END IF;

  IF NOT private.can_view_live_walk(p_walk_id) THEN
    RETURN jsonb_build_object(
      'status', 'not_visible',
      'server_now', clock_timestamp(),
      'rows', '[]'::JSONB,
      'watermarks', '[]'::JSONB
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'ok',
    'server_now', clock_timestamp(),
    'rows', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'walk_id', l.walk_id,
               'user_id', l.user_id,
               'lat', l.lat,
               'lng', l.lng,
               'accuracy_m', l.accuracy_m,
               'path', l.path,
               'recorded_at', l.recorded_at,
               'heard_at', l.heard_at,
               'fix_at', l.fix_at,
               'obs_at', l.obs_at,
               'live_gen', l.live_gen,
               'seq', l.seq,
               'route_version', l.route_version
             ) ORDER BY l.heard_at DESC)
        FROM public.community_live_locations l
        JOIN public.community_walk_attendance a
          ON a.walk_id = l.walk_id AND a.user_id = l.user_id
       WHERE l.walk_id = p_walk_id
         AND a.status = 'walking'
         AND a.share_location
    ), '[]'::JSONB),
    'watermarks', coalesce((
      SELECT jsonb_agg(jsonb_build_object('user_id', s.user_id, 'gen', s.gen) ORDER BY s.user_id)
        FROM private.live_sessions s
       WHERE s.walk_id = p_walk_id AND s.gen > 0
    ), '[]'::JSONB)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.begin_live_session(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.publish_live_location(UUID, INTEGER, BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.live_walk_positions(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.begin_live_session(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_live_location(UUID, INTEGER, BIGINT, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, TIMESTAMPTZ, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.live_walk_positions(UUID) TO authenticated;

-- ── Cleanup: no position outlives the permission to share it ────────────────
-- SECURITY DEFINER because the table has no DELETE policy: run as the person
-- closing or finishing, a plain trigger would silently delete nothing.

CREATE OR REPLACE FUNCTION private.clear_live_walk()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.community_live_locations WHERE walk_id = NEW.id;
  DELETE FROM private.live_session_tokens WHERE walk_id = NEW.id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION private.clear_live_attendee()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.community_live_locations
   WHERE walk_id = OLD.walk_id AND user_id = OLD.user_id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.clear_live_walk() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.clear_live_attendee() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS community_walk_live_cleanup ON public.community_walks;
CREATE TRIGGER community_walk_live_cleanup
  AFTER UPDATE OF state ON public.community_walks
  FOR EACH ROW
  WHEN (OLD.state = 'active' AND NEW.state IS DISTINCT FROM 'active')
  EXECUTE FUNCTION private.clear_live_walk();

DROP TRIGGER IF EXISTS community_attendance_live_cleanup ON public.community_walk_attendance;
CREATE TRIGGER community_attendance_live_cleanup
  AFTER UPDATE OF status, share_location ON public.community_walk_attendance
  FOR EACH ROW
  WHEN (NEW.status IS DISTINCT FROM 'walking' OR NOT NEW.share_location)
  EXECUTE FUNCTION private.clear_live_attendee();

DROP TRIGGER IF EXISTS community_attendance_live_cleanup_delete ON public.community_walk_attendance;
CREATE TRIGGER community_attendance_live_cleanup_delete
  AFTER DELETE ON public.community_walk_attendance
  FOR EACH ROW EXECUTE FUNCTION private.clear_live_attendee();

-- ── Stale-walk watcher: server-recorded contact, not the phone's GPS clock ──
-- Same body as 20261002030000 except the live signal: max(heard_at), stamped
-- by the server on every write, instead of max(recorded_at), which is the
-- phone's own idea of when its fix was taken.

CREATE OR REPLACE FUNCTION public.watch_stale_community_walks()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  flagged INTEGER;
BEGIN
  WITH activity AS (
    SELECT w.id, w.started_at,
           GREATEST(
             COALESCE(w.started_at, w.updated_at, w.created_at),
             COALESCE((SELECT max(l.heard_at)   FROM community_live_locations l WHERE l.walk_id = w.id), '-infinity'),
             COALESCE((SELECT max(a.updated_at) FROM community_walk_attendance a WHERE a.walk_id = w.id), '-infinity')
           ) AS last_activity_at
      FROM community_walks w
     WHERE w.state = 'active'
  )
  INSERT INTO community_stale_walk_watch AS s (walk_id, started_at, last_activity_at)
  SELECT id, started_at, last_activity_at
    FROM activity
   WHERE last_activity_at < now() - interval '3 hours'
  ON CONFLICT (walk_id) DO UPDATE
     SET last_activity_at = EXCLUDED.last_activity_at,
         last_flagged_at  = now(),
         times_flagged    = s.times_flagged + 1,
         resolved_at      = NULL;
  GET DIAGNOSTICS flagged = ROW_COUNT;

  UPDATE community_stale_walk_watch s
     SET resolved_at = now()
   WHERE s.resolved_at IS NULL
     AND s.last_flagged_at < now() - interval '50 minutes'
     AND NOT EXISTS (
       SELECT 1 FROM community_walks w
        WHERE w.id = s.walk_id AND w.state = 'active'
     );

  RETURN flagged;
END;
$$;

REVOKE ALL ON FUNCTION public.watch_stale_community_walks() FROM PUBLIC, anon, authenticated;

-- Keepsakes — the moments captured during a walk.
--
-- ── Why this table holds no photographs ──
-- The original media NEVER reaches this database. What lives here is the
-- metadata around a photo plus a ~20 KB thumbnail, and that split is the whole
-- architecture:
--
--   * Cost. A 320px thumbnail is ~20 KB against ~3 MB for the original —
--     roughly 1/150th. At one walk a day with a couple of photos that is
--     ~17 MB per user per year instead of ~2.6 GB. The first number is a
--     rounding error; the second is a media-storage business we have no
--     intention of being in.
--   * Privacy. The photo stays in the user's own photo library, where their
--     existing backup already protects it and where deleting it actually
--     deletes it. We hold no copy of anyone's camera roll.
--
-- ── Why a thumbnail at all, then ──
-- Because the archive is the point. A dog's biography that develops holes
-- every time someone clears storage is not a biography. The thumbnail is what
-- lets a walk from two phones ago still open with its moments intact: the
-- memory outlives the file. Rendering degrades down a deliberate ladder
-- (original → thumbnail → context-only) in lib/walk/keepsakeResolve.ts, and a
-- broken image is not one of the rungs.
--
-- ── Why local_asset_id is not the source of truth ──
-- It is a cache hint and nothing more. iOS `ph://` identifiers survive a
-- reinstall but not a device migration; Android MediaStore ids survive neither
-- reliably. Code that trusts this column works perfectly on the developer's
-- phone and loses users' memories on their next one. The durable locator is
-- captured_at + coordinate + dimensions, which lets the client re-find the
-- asset on a new device with no upload — see matchAssetForKeepsake.

CREATE TABLE IF NOT EXISTS walk_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id   UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  walk_session_id UUID NOT NULL REFERENCES walk_sessions(id) ON DELETE CASCADE,

  -- Half of the durable locator, so this is never nullable and never fuzzed.
  captured_at TIMESTAMPTZ NOT NULL,

  -- Where it happened. NULL is legitimate and common: an imported photo may
  -- carry EXIF time but no GPS. Such rows get a route_index estimated from
  -- elapsed time but deliberately keep lat/lng NULL, so a guessed position can
  -- never leak into place memory as if it were observed.
  lat NUMERIC(9, 6),
  lng NUMERIC(9, 6),

  -- Index into walk_sessions.route (the simplified polyline), so the moment can
  -- be pinned on the map without storing a second copy of the geometry.
  route_index INTEGER,
  elapsed_s   INTEGER,

  media_type TEXT NOT NULL DEFAULT 'photo' CHECK (media_type IN ('photo', 'video')),
  -- 'camera' = captured in-app; 'import' = matched from the library by
  -- timestamp after the walk. Worth distinguishing: the import path's placement
  -- is an estimate, and product surfaces may want to say so.
  source TEXT NOT NULL DEFAULT 'camera' CHECK (source IN ('camera', 'import')),

  -- CACHE HINT ONLY. See the header. Never join on this, never assume it.
  local_asset_id TEXT,
  width  INTEGER,
  height INTEGER,
  -- Video is out of scope for v1; the column exists so shipping it later is a
  -- write path, not a migration.
  duration_ms INTEGER,

  -- Storage path for the durable thumbnail. NULL until the lazy wifi upload
  -- lands, which is why every reader must tolerate its absence.
  thumb_path TEXT,
  thumb_blurhash TEXT,

  -- ~55 m cell from lib/walk/placeKey.ts — the coarse index that makes "what
  -- else happened at this tree" a bounded query instead of a full scan. It is
  -- an index, not an answer: callers still filter candidates by real distance.
  place_key TEXT,

  frame_id TEXT,
  caption  TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- This table carries location AND imagery, which makes it the worst possible
-- place for a leak. Same shape as walk_sessions: the owner, and nobody else.
ALTER TABLE walk_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_can_rw_own_walk_media" ON walk_media
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Rendering one walk: every moment on it, in the order they happened.
CREATE INDEX IF NOT EXISTS idx_walk_media_session
  ON walk_media (walk_session_id, captured_at);

-- Place memory: "what has this pet photographed in these cells". Partial,
-- because rows without a place_key can never satisfy this query and there is no
-- reason to carry them in the index.
CREATE INDEX IF NOT EXISTS idx_walk_media_pet_place
  ON walk_media (pet_id, place_key)
  WHERE place_key IS NOT NULL;

-- The archive view (gallery, Memories) walks a pet backwards through time.
CREATE INDEX IF NOT EXISTS idx_walk_media_pet_captured
  ON walk_media (pet_id, captured_at DESC);

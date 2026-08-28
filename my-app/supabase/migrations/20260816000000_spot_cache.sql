-- Pawtchi Spots MVP — the shared cache in front of OpenStreetMap.
--
-- ── Why this table exists ──
-- Overpass is volunteer-run infrastructure with no SLA and an explicit usage
-- policy. Querying it once per user per session would be both abusive and
-- fragile. This table makes an entire neighbourhood cost ONE upstream request
-- per TTL: everyone standing in the same ~2.2 km grid cell reads the same row.
--
-- ── Why it holds no user data ──
-- The key is a grid cell, never a coordinate. The client quantizes its position
-- before it asks (lib/spots/cellKey.ts) and sends the CELL, so there is no row
-- here — and no log line upstream — that says where a person was. That is not a
-- side effect of the caching design; it is half the reason for it.
--
-- Consequently there is nothing to anonymise, nothing to delete on account
-- closure, and no RLS policy to write: this is public map data keyed by a
-- rectangle. See the RLS note at the bottom.
--
-- ── Why JSONB rather than a row per place ──
-- A normalised spots table would need its own dedupe, its own upsert-vs-insert
-- rules, and a join on every read, all to store data whose authoritative copy
-- lives in OSM and which we throw away after 72 hours. The cache entry is the
-- unit of work — it is fetched, stored and expired as one thing — so it is
-- stored as one thing. `PawtchiSpot[]`, exactly as the client consumes it.

CREATE TABLE IF NOT EXISTS spot_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- "{latIndex}_{lngIndex}" from lib/spots/cellKey.ts. Floor-quantized at
  -- 0.02°, so cells tile the plane with no overlap and no gap.
  cell_key TEXT NOT NULL,

  -- The SNAPPED radius (3000 or 5000), not whatever the client asked for.
  -- Free-form radii would fragment the cache into near-duplicate rows and
  -- destroy the sharing this table exists for.
  radius_bucket INTEGER NOT NULL,

  -- SPOT_QUERY_VERSION at write time. Bumping it in the app makes every
  -- existing row unreachable, so changing a tag rule needs no purge and no
  -- migration — old rows simply age out under the sweep below.
  query_version INTEGER NOT NULL,

  -- PawtchiSpot[] — the normalized, deduped, provider-neutral model. Raw
  -- Overpass elements are deliberately NOT stored: they are ~10x larger and
  -- nothing downstream can read them.
  spots JSONB NOT NULL,

  -- When we fetched from Overpass. The TTL reads this, and it is also what the
  -- client's "showing saved spots" note is computed from. NOT a row-updated
  -- timestamp — a refresh that returns identical data still moves this.
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (cell_key, radius_bucket, query_version)
);

-- The unique constraint already indexes the read path (it is the exact lookup
-- the function performs). This one serves the expiry sweep only.
CREATE INDEX IF NOT EXISTS spot_cache_fetched_at_idx ON spot_cache (fetched_at);

-- RLS on with NO policies: deny-by-default for anon and authenticated, and the
-- service role bypasses RLS entirely. The nearby-spots Edge Function is the
-- only reader and writer.
--
-- Deliberate, and worth stating plainly: the app ships the anon key, so any
-- table the client could reach is a table the public can reach. Routing this
-- through the function is what keeps the Overpass fetch — the expensive,
-- rate-limited, third-party-facing part — behind an authenticated,
-- rate-limited door rather than behind a PostgREST query anyone can shape.
ALTER TABLE spot_cache ENABLE ROW LEVEL SECURITY;

-- ── Expiry ──
-- Rows are served stale on upstream failure (a three-day-old park is better
-- than an error), so nothing here deletes on the TTL boundary. This sweep only
-- stops the table growing without bound as users travel, and 30 days is far
-- past any point at which a row would be preferred to a fresh fetch.
--
-- SECURITY DEFINER so it can be called by pg_cron without granting anything to
-- application roles. Follows the pattern used by the notification cron jobs.
CREATE OR REPLACE FUNCTION public.sweep_spot_cache()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  removed INTEGER;
BEGIN
  DELETE FROM spot_cache WHERE fetched_at < NOW() - INTERVAL '30 days';
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_spot_cache() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_spot_cache() FROM anon, authenticated;

COMMENT ON TABLE spot_cache IS
  'Shared cache of OpenStreetMap-derived Pawtchi Spots, keyed by geographic grid cell. Contains no user data — see lib/spots/cellKey.ts. ODbL: derived from OpenStreetMap, © OpenStreetMap contributors.';

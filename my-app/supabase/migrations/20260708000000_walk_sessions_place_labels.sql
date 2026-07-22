-- Tracked Walks — place labels
--
-- Cache a short reverse-geocoded label for the start, end, and (for loop
-- walks) farthest points of each walk. The lat/lng of those points are
-- already implicit in the `route` polyline; storing labels alongside them
-- avoids a reverse-geocode round trip every time the Home feed renders a
-- Walk Post card.
--
-- Semantics:
--   * start_label     — always set when geocoding succeeded
--   * end_label       — set for straight-line walks; NULL for loops
--   * farthest_label  — set for loop walks (turned-at pin); NULL otherwise
-- A row with all three NULL just means geocoding was unavailable at write
-- time (offline finalize, no permission). Nothing else in the pipeline
-- depends on these values.

ALTER TABLE walk_sessions
  ADD COLUMN IF NOT EXISTS start_label TEXT,
  ADD COLUMN IF NOT EXISTS end_label TEXT,
  ADD COLUMN IF NOT EXISTS farthest_label TEXT;

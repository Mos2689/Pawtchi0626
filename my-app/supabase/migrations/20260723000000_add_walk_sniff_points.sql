-- Sniff episodes v2 — decoupled from auto-pause.
--
-- pause_points (4-minute auto-pauses, 25m loiter anchor) is session
-- plumbing; real sniff investigations run 20-90s and were invisible to it.
-- sniff_points holds the new detector's episodes as {lat, lng, dwellS}
-- objects: >=30s dwells inside a tight accuracy-adaptive radius, recorded at
-- the centroid of their fixes. Detection lives in lib/walk/walkSession.ts.
--
-- NULL here means the row predates the detector (consumers fall back to
-- pause_points); [] means a genuinely sniffless walk.

ALTER TABLE walk_sessions
  ADD COLUMN IF NOT EXISTS sniff_points JSONB;

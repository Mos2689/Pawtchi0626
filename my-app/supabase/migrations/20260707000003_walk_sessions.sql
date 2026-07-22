-- Tracked Walks — Phase 1 (schema)
--
-- walk_sessions stores one row per GPS-tracked walk. The raw GPS trace never
-- leaves the device: `route` holds a Douglas-Peucker-simplified polyline
-- (≤200 points) used for the summary/share card, and everything else is
-- pre-aggregated on-device. Validation happens client-side; the verdict is
-- stored so future features (challenges, benchmarks) can trust `valid` rows
-- without re-deriving anything.

CREATE TABLE IF NOT EXISTS walk_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,

  started_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ended_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_s INTEGER NOT NULL,
  -- Time actually in motion (auto-paused sniff stops excluded).
  moving_time_s INTEGER NOT NULL,
  distance_m NUMERIC(10, 1) NOT NULL,
  avg_speed_kmh NUMERIC(5, 2),
  point_count INTEGER NOT NULL DEFAULT 0,

  -- Simplified polyline: [[lat, lng], ...] — ≤200 points, never the raw trace.
  route JSONB,

  validation_verdict TEXT NOT NULL
    CHECK (validation_verdict IN ('valid', 'too_short', 'likely_vehicle', 'gps_junk')),
  -- How the session ended: auto_stationary | auto_home | manual | time_cap | recovered
  end_reason TEXT,

  matched_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE walk_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_can_rw_own_walk_sessions" ON walk_sessions
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_walk_sessions_pet_started
  ON walk_sessions (pet_id, started_at DESC);

-- Link the completed activity back to the session that completed it. The
-- partial unique index is the DB-level duplicate guard: one walk session can
-- auto-complete at most one activity, ever — even if the client sync retries.
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS walk_session_id UUID REFERENCES walk_sessions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_activities_walk_session
  ON activities (walk_session_id)
  WHERE walk_session_id IS NOT NULL;

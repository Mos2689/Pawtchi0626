-- Paw Prints — awarded walk milestones.
--
-- One row per (pet, milestone rung) ever reached. The ladder definitions
-- (distance_50, walks_100, places_15, sniffs_500, ...) live in
-- lib/pawPrints.ts; ids are stable and append-only. The unique index is the
-- idempotency guard: award detection re-runs freely (after every walk sync
-- and on gallery open) and can never double-celebrate.

CREATE TABLE IF NOT EXISTS pet_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_id UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  milestone_id TEXT NOT NULL,
  reached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  -- The walk whose sync crossed the line — display/debug convenience.
  walk_session_id UUID REFERENCES walk_sessions(id) ON DELETE SET NULL,

  UNIQUE (pet_id, milestone_id)
);

ALTER TABLE pet_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_can_rw_own_pet_milestones" ON pet_milestones
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_pet_milestones_pet
  ON pet_milestones (pet_id, reached_at DESC);

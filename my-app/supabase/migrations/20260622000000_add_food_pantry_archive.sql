-- Soft-archive for pantry foods.
--
-- When an owner switches brands, the old food should leave the meal-tab rail
-- and quick-log without deleting its historical food_scans (so past vet reports
-- and weekly summaries stay accurate). An archived item is simply hidden from
-- the active pantry surfaces.

ALTER TABLE food_pantry
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT false;

-- Most reads filter to the active (non-archived) pantry for a pet.
CREATE INDEX IF NOT EXISTS idx_food_pantry_active
  ON food_pantry (pet_id)
  WHERE is_archived = false;

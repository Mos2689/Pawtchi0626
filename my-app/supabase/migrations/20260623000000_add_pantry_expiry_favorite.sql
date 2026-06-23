-- Pantry foods get two new optional signals used by the Quick Log rail:
--   * expiry_date  → surfaces an "Expires soon" badge when ≤ 7 days away
--   * is_favorite  → pins the item to the top of the rail
-- Both are user-controlled from the profile editor; neither blocks logging.

ALTER TABLE food_pantry
  ADD COLUMN IF NOT EXISTS expiry_date DATE,
  ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;

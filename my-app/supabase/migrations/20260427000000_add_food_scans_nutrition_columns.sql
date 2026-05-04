-- Adds nutrition columns to food_scans that the meal logger has been writing
-- since the macro/health-score feature shipped. Original schema.sql defined
-- only ai_identified_food + ai_estimated_calories; the inserts in meal.tsx
-- include is_treat, protein_g, carbs_g, fat_g, health_score, and ingredients.
-- These were silently dropped by Postgres when the columns didn't exist.

ALTER TABLE food_scans
  ADD COLUMN IF NOT EXISTS is_treat BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS protein_g NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS carbs_g NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS fat_g NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS health_score SMALLINT CHECK (health_score BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS ingredients JSONB DEFAULT '[]'::jsonb;

-- Index used by the treat-frequency check in generate-health-insight
CREATE INDEX IF NOT EXISTS food_scans_pet_treat_created_idx
  ON food_scans (pet_id, is_treat, created_at DESC);

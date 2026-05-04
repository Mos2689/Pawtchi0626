-- Add label-accurate nutrition fields to food_pantry
-- moisture_pct and kcal_per_100g_as_fed are extracted from the label when available,
-- enabling accurate dry-matter basis and g/1000 kcal Verdicts on pantry rescan matches.

ALTER TABLE food_pantry
ADD COLUMN IF NOT EXISTS kcal_per_100g_as_fed numeric,
ADD COLUMN IF NOT EXISTS moisture_pct numeric;

COMMENT ON COLUMN food_pantry.kcal_per_100g_as_fed IS 'Calorie density in kcal per 100g as-fed, from label''s "X kcal ME/kg" ÷ 10. Null if label doesn''t state.';
COMMENT ON COLUMN food_pantry.moisture_pct IS 'Moisture % from label''s "Moisture (max.) X%". Null if label doesn''t state. Used for dry-matter basis conversion.';

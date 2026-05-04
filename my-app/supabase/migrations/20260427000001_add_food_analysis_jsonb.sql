-- Stores the full FoodAnalysis output (lib/foodVerdict.ts -> analyzeFood)
-- captured at scan-log time. Lets the Scan Details screen show the same
-- transparent nutrient comparison the user saw at log time without
-- recomputing from drift-prone label data.

ALTER TABLE food_scans
  ADD COLUMN IF NOT EXISTS food_analysis JSONB;

-- Pregnancy weeks — gestation stage for a more accurate calorie multiplier.
--
-- Pregnancy is an increase over MAINTENANCE, not over basal (RER). Early
-- gestation (weeks 1-5) needs roughly maintenance kcal; the ramp begins in
-- the last third (weeks 6-9), peaking at ~1.5-1.8x maintenance for dogs and
-- ~1.4-1.6x maintenance for cats. We store gestation week so the plan can
-- ramp with the pregnancy rather than sitting at a static multiplier.
--
-- Nullable and unconstrained on nulls: users who don't know the week (or who
-- aren't pregnant at all) leave it null and the math defaults to mid-gestation.

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS pregnancy_weeks SMALLINT
    CHECK (pregnancy_weeks IS NULL OR (pregnancy_weeks >= 1 AND pregnancy_weeks <= 9));

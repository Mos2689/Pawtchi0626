-- Packheart onboarding signal: how many people regularly walk this dog.
-- Null means the optional question was skipped or predates the question.
ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS household_walkers integer
  CHECK (household_walkers IS NULL OR household_walkers BETWEEN 1 AND 20);

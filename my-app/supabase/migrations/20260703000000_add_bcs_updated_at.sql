-- Track when the owner's Body Condition Score was last recorded.
-- The adaptive milestone loop prompts a BCS re-score at each weight-plan
-- stage and when the score goes stale (>8 weeks on an active plan);
-- without a timestamp, "stale" is unknowable across devices.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS bcs_updated_at timestamptz;

-- Backfill: existing scores were recorded at onboarding.
UPDATE pets
SET bcs_updated_at = created_at
WHERE body_condition_score IS NOT NULL
  AND bcs_updated_at IS NULL;

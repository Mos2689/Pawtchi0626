-- Dynamic, versioned weight plans.
--
-- current_weight_kg remains the latest measurement, target_weight_kg remains
-- the next actionable stage, and ideal_weight_kg is the locked destination
-- from the active accepted assessment.

ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS weight_plan_status text
    CHECK (weight_plan_status IN (
      'growth', 'active', 'maintenance', 'verify_change',
      'needs_reassessment', 'supervised'
    )),
  ADD COLUMN IF NOT EXISTS ideal_weight_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS healthy_band_low_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS healthy_band_high_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS weight_assessment_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS weight_assessment_bcs integer
    CHECK (weight_assessment_bcs BETWEEN 1 AND 9),
  ADD COLUMN IF NOT EXISTS weight_assessed_at timestamptz,
  ADD COLUMN IF NOT EXISTS weight_assessment_source text,
  ADD COLUMN IF NOT EXISTS weight_assessment_confidence text
    CHECK (weight_assessment_confidence IS NULL OR weight_assessment_confidence IN ('high', 'low')),
  ADD COLUMN IF NOT EXISTS weight_plan_revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS current_weight_logged_at timestamptz;
ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS weight_journey_start_kg numeric(6,2),
  ADD COLUMN IF NOT EXISTS weight_journey_started_at timestamptz;

CREATE TABLE IF NOT EXISTS weight_plan_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id uuid NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  revision integer NOT NULL CHECK (revision > 0),
  source text NOT NULL CHECK (source IN (
    'onboarding', 'owner_bcs', 'guided_check', 'milestone', 'vet_report',
    'profile_change', 'life_stage', 'migration'
  )),
  assessed_at timestamptz NOT NULL,
  assessment_weight_kg numeric(6,2) NOT NULL CHECK (assessment_weight_kg > 0),
  bcs integer NOT NULL CHECK (bcs BETWEEN 1 AND 9),
  breed text,
  sex text CHECK (sex IS NULL OR sex IN ('male', 'female')),
  age_months integer,
  life_stage text,
  reproductive_status text,
  ideal_weight_kg numeric(6,2),
  target_weight_kg numeric(6,2),
  healthy_band_low_kg numeric(6,2),
  healthy_band_high_kg numeric(6,2),
  plan_status text NOT NULL CHECK (plan_status IN (
    'growth', 'active', 'maintenance', 'verify_change',
    'needs_reassessment', 'supervised'
  )),
  confidence text CHECK (confidence IS NULL OR confidence IN ('high', 'low')),
  previous_ideal_weight_kg numeric(6,2),
  ideal_change_pct numeric(8,5),
  superseded_revision integer,
  is_active boolean NOT NULL DEFAULT true,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pet_id, revision)
);

ALTER TABLE weight_plan_assessments ENABLE ROW LEVEL SECURITY;

DO $policy$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = current_schema()
      AND tablename = 'weight_plan_assessments'
      AND policyname = 'Owners manage their weight assessments'
  ) THEN
    EXECUTE $sql$
      CREATE POLICY "Owners manage their weight assessments"
        ON weight_plan_assessments
        FOR ALL
        USING (
          EXISTS (
            SELECT 1
            FROM pets
            WHERE pets.id = weight_plan_assessments.pet_id
              AND pets.owner_id = auth.uid()
          )
        )
        WITH CHECK (
          EXISTS (
            SELECT 1
            FROM pets
            WHERE pets.id = weight_plan_assessments.pet_id
              AND pets.owner_id = auth.uid()
          )
        )
    $sql$;
  END IF;
END
$policy$;

CREATE INDEX IF NOT EXISTS idx_weight_plan_assessments_pet
  ON weight_plan_assessments (pet_id, revision DESC);

CREATE INDEX IF NOT EXISTS idx_weight_plan_assessments_active
  ON weight_plan_assessments (pet_id, is_active)
  WHERE is_active = true;

-- Idempotency across retries and offline replays. Null keeps historical rows
-- compatible; every new canonical write supplies a stable event id.
ALTER TABLE weight_logs
  ADD COLUMN IF NOT EXISTS source_event_id text,
  ADD COLUMN IF NOT EXISTS measurement_source text
  CHECK (
    measurement_source IS NULL OR measurement_source IN (
      'manual', 'profile', 'vet_report', 'onboarding', 'device', 'migration'
    )
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_weight_logs_source_event
  ON weight_logs (pet_id, source_event_id);

-- Legacy Profile edits may have updated the pet snapshot without creating a
-- log. Preserve that snapshot as the migration baseline before chronology is
-- reconciled, so an older historical log can never roll the pet backwards.
INSERT INTO weight_logs (
  pet_id,
  weight_kg,
  notes,
  source,
  measurement_source,
  logged_at,
  source_event_id
)
SELECT
  id,
  current_weight_kg,
  'Migration baseline',
  'manual',
  'migration',
  now(),
  'migration:' || id::text || ':baseline'
FROM pets
WHERE current_weight_kg > 0
ON CONFLICT (pet_id, source_event_id) DO NOTHING;

-- Conservative backfill. Existing targets are treated as the provisional
-- destination; accounts without enough assessment evidence are never called
-- healthy merely because the current weight anchors a fresh estimate.
UPDATE pets
SET
  ideal_weight_kg = CASE
    WHEN COALESCE(age_years, 99) < 1 THEN NULL
    ELSE COALESCE(ideal_weight_kg, target_weight_kg)
  END,
  healthy_band_low_kg = COALESCE(
    healthy_band_low_kg,
    CASE
      WHEN COALESCE(age_years, 99) >= 1
        AND target_weight_kg IS NOT NULL
        AND body_condition_score IS NOT NULL
        AND COALESCE(bcs_updated_at, created_at) >= now() - interval '56 days'
      THEN ROUND(target_weight_kg * 0.97, 2)
      ELSE NULL
    END
  ),
  healthy_band_high_kg = COALESCE(
    healthy_band_high_kg,
    CASE
      WHEN COALESCE(age_years, 99) >= 1
        AND target_weight_kg IS NOT NULL
        AND body_condition_score IS NOT NULL
        AND COALESCE(bcs_updated_at, created_at) >= now() - interval '56 days'
      THEN ROUND(target_weight_kg * 1.03, 2)
      ELSE NULL
    END
  ),
  weight_assessment_kg = COALESCE(weight_assessment_kg, current_weight_kg),
  weight_assessment_bcs = COALESCE(weight_assessment_bcs, body_condition_score),
  weight_assessed_at = COALESCE(weight_assessed_at, bcs_updated_at, created_at),
  weight_assessment_source = COALESCE(weight_assessment_source, 'migration'),
  weight_assessment_confidence = COALESCE(weight_assessment_confidence, 'low'),
  weight_journey_start_kg = COALESCE(weight_journey_start_kg, current_weight_kg),
  weight_journey_started_at = COALESCE(weight_journey_started_at, created_at),
  weight_plan_revision = CASE
    WHEN target_weight_kg IS NOT NULL AND body_condition_score IS NOT NULL
      THEN GREATEST(weight_plan_revision, 1)
    ELSE weight_plan_revision
  END,
  weight_plan_status = COALESCE(
    weight_plan_status,
    CASE
      WHEN COALESCE(age_years, 99) < 1 THEN 'growth'
      WHEN target_weight_kg IS NULL
        OR body_condition_score IS NULL
        OR COALESCE(bcs_updated_at, created_at) < now() - interval '56 days'
        THEN 'needs_reassessment'
      WHEN ABS(current_weight_kg - target_weight_kg)
          / GREATEST(target_weight_kg, 0.001) <= 0.03
        THEN 'maintenance'
      ELSE 'active'
    END
  );

UPDATE pets AS p
SET current_weight_logged_at = latest.logged_at
FROM (
  SELECT DISTINCT ON (pet_id) pet_id, logged_at
  FROM weight_logs
  ORDER BY pet_id, logged_at DESC
) AS latest
WHERE p.id = latest.pet_id
  AND p.current_weight_logged_at IS NULL;

INSERT INTO weight_plan_assessments (
  pet_id,
  revision,
  source,
  assessed_at,
  assessment_weight_kg,
  bcs,
  breed,
  sex,
  age_months,
  reproductive_status,
  ideal_weight_kg,
  target_weight_kg,
  healthy_band_low_kg,
  healthy_band_high_kg,
  plan_status,
  confidence,
  is_active,
  input_snapshot
)
SELECT
  id,
  1,
  'migration',
  COALESCE(weight_assessed_at, created_at),
  current_weight_kg,
  body_condition_score,
  breed,
  gender,
  CASE
    WHEN age_years IS NULL THEN NULL
    ELSE ROUND(age_years * 12)::integer
  END,
  reproductive_status,
  ideal_weight_kg,
  target_weight_kg,
  healthy_band_low_kg,
  healthy_band_high_kg,
  weight_plan_status,
  'low',
  true,
  jsonb_build_object('backfilled', true)
FROM pets
WHERE weight_plan_revision > 0
  AND body_condition_score IS NOT NULL
ON CONFLICT (pet_id, revision) DO NOTHING;

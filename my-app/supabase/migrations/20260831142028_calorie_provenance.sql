-- Calorie pipeline integrity — schema & provenance (stage 3).
--
-- Entirely additive. Every column is nullable or carries a default, no existing
-- read path changes, and clients that know nothing about these columns keep
-- working unchanged. Nothing in this migration computes a meal or blocks a
-- write; it only creates the places where stage 4 can record HOW a number was
-- arrived at.
--
-- ── The gap this closes ─────────────────────────────────────────────────────
--
-- A meal row today records a calorie figure and nothing about where it came
-- from. That is why a 100x error was indistinguishable from a large dinner:
-- with no serving weight, no portion, no label snapshot and no calculation
-- basis, there is no second fact to check the first against. Worse, the two
-- figures the code DID derive were derived from each other, so comparing them
-- returned agreement on a wrong answer.
--
-- Provenance is the fix. Not "is this number big?" but "what is this number
-- made of, and was any of it observed rather than assumed?"
--
-- ── Why provenance is per field ─────────────────────────────────────────────
--
-- A single `nutrition_source` on the row would be a lie for the common case:
-- one pantry item routinely has label-printed calories, an owner-corrected
-- serving weight and a macro-estimated density all at once. Consistency can
-- only be claimed between fields that were INDEPENDENTLY observed, so the
-- provenance has to be recorded at the same granularity the check operates on.

-- ════════════════════════════════════════════════════════════════════════════
-- food_pantry — the label facts and how much we trust each one
-- ════════════════════════════════════════════════════════════════════════════

-- The manufacturer's serving weight, for EVERY unit — not just grams. Pouches,
-- cans, trays and cups all print one, and we have been throwing it away and
-- re-deriving it from density ever since. `serving_size_raw` keeps the verbatim
-- label text next to it so a bad parse can be audited rather than guessed at.
ALTER TABLE food_pantry ADD COLUMN IF NOT EXISTS serving_grams NUMERIC;
ALTER TABLE food_pantry ADD COLUMN IF NOT EXISTS serving_size_raw TEXT;

-- Per-field evidence source. Shape: {"kcal_per_serving":"label",
-- "serving_grams":"owner_corrected","kcal_per_100g_as_fed":"estimated"}.
--
-- NULL means "unknown", which every consumer must read as unverifiable and
-- never as trustworthy. Existing rows are deliberately NOT backfilled: we have
-- no record of where their values came from, and inventing provenance to make
-- the column look populated would defeat its entire purpose.
ALTER TABLE food_pantry ADD COLUMN IF NOT EXISTS nutrition_provenance JSONB;

-- Result of the over-determined label check (see the trigger below).
-- Database-controlled: clients cannot set it, so it can never drift from the
-- data it describes.
ALTER TABLE food_pantry ADD COLUMN IF NOT EXISTS label_consistency TEXT;
ALTER TABLE food_pantry ADD COLUMN IF NOT EXISTS nutrition_revision INTEGER NOT NULL DEFAULT 1;

-- How much of this food the owner usually serves.
--
-- This replaces the behaviour where accepting "make this the usual" wrote
-- `kcal_per_serving = kcal_per_serving x multiplier` — storing a PORTION inside
-- a LABEL FACT. The manufacturer's calories per serving are not ours to edit
-- because someone feeds a bit more than the packet suggests.
-- Shape: {"mode":"weight","quantity":150,"gramsFed":150}
ALTER TABLE food_pantry ADD COLUMN IF NOT EXISTS usual_portion JSONB;

DO $$ BEGIN
  ALTER TABLE food_pantry ADD CONSTRAINT food_pantry_label_consistency_check
    CHECK (label_consistency IS NULL
           OR label_consistency IN ('consistent', 'inconsistent', 'unverifiable'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE food_pantry ADD CONSTRAINT food_pantry_serving_grams_check
    CHECK (serving_grams IS NULL OR serving_grams > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN food_pantry.serving_grams IS
  'Manufacturer serving weight in grams, for any serving_unit. Validated, never clamped - a 4.6 g supplement dose is real.';
COMMENT ON COLUMN food_pantry.nutrition_provenance IS
  'Per-field evidence source: label | owner_corrected | estimated | derived | default. NULL = unknown = unverifiable.';
COMMENT ON COLUMN food_pantry.label_consistency IS
  'Trigger-maintained. Never set by a client.';

-- ── The label-consistency trigger ───────────────────────────────────────────
--
-- kcal_per_serving, kcal_per_100g_as_fed and serving_grams are over-determined:
-- any two fix the third. That makes them the ONLY genuinely independent check
-- available, and only when each was separately observed. If any operand is
-- derived or estimated, the comparison is circular and the honest answer is
-- 'unverifiable' — not 'consistent'.
--
-- Tolerance is dimensional and justified by how labels are printed: energy is
-- rounded to roughly 5-10 kcal, so max(5 kcal, 3%). It is deliberately NOT a
-- flat percentage, which is too tight on small servings and too loose on large.
--
-- The trigger also owns `nutrition_revision`, bumping it whenever a nutrition
-- field actually changes. Client-settable revisions would be worthless: the
-- point of a revision is that a meal logged against revision 3 can prove which
-- numbers it used.
CREATE OR REPLACE FUNCTION public.food_pantry_nutrition_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $fn$
DECLARE
  v_prov     JSONB   := COALESCE(NEW.nutrition_provenance, '{}'::JSONB);
  v_observed BOOLEAN;
  v_expected NUMERIC;
  v_changed  BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.nutrition_revision := COALESCE(NEW.nutrition_revision, 1);
  ELSE
    v_changed :=
         NEW.kcal_per_serving      IS DISTINCT FROM OLD.kcal_per_serving
      OR NEW.kcal_per_100g_as_fed  IS DISTINCT FROM OLD.kcal_per_100g_as_fed
      OR NEW.serving_grams         IS DISTINCT FROM OLD.serving_grams
      OR NEW.serving_unit          IS DISTINCT FROM OLD.serving_unit
      OR NEW.protein_pct           IS DISTINCT FROM OLD.protein_pct
      OR NEW.fat_pct               IS DISTINCT FROM OLD.fat_pct
      OR NEW.fibre_pct             IS DISTINCT FROM OLD.fibre_pct
      OR NEW.moisture_pct          IS DISTINCT FROM OLD.moisture_pct
      OR NEW.nutrition_provenance  IS DISTINCT FROM OLD.nutrition_provenance;
    -- Always taken from OLD: a client cannot move this, whatever it submits.
    NEW.nutrition_revision := OLD.nutrition_revision + CASE WHEN v_changed THEN 1 ELSE 0 END;
  END IF;

  v_observed :=
       COALESCE(v_prov->>'kcal_per_serving', '')     IN ('label', 'owner_corrected')
   AND COALESCE(v_prov->>'kcal_per_100g_as_fed', '') IN ('label', 'owner_corrected')
   AND COALESCE(v_prov->>'serving_grams', '')        IN ('label', 'owner_corrected');

  IF NEW.kcal_per_serving IS NULL
     OR NEW.kcal_per_100g_as_fed IS NULL
     OR NEW.serving_grams IS NULL
     OR NOT v_observed
  THEN
    -- No second independently-observed fact to check against.
    NEW.label_consistency := 'unverifiable';
  ELSE
    v_expected := NEW.kcal_per_100g_as_fed * NEW.serving_grams / 100.0;
    NEW.label_consistency := CASE
      WHEN ABS(NEW.kcal_per_serving - v_expected) <= GREATEST(5, 0.03 * v_expected)
        THEN 'consistent'
      ELSE 'inconsistent'
    END;
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_food_pantry_nutrition_guard ON food_pantry;
CREATE TRIGGER trg_food_pantry_nutrition_guard
  BEFORE INSERT OR UPDATE ON food_pantry
  FOR EACH ROW EXECUTE FUNCTION public.food_pantry_nutrition_guard();

-- Belt as well as braces: the trigger overwrites whatever a client sends, and
-- this makes the attempt itself fail rather than silently succeed-and-ignore.
REVOKE UPDATE (nutrition_revision, label_consistency) ON food_pantry FROM authenticated;
REVOKE UPDATE (nutrition_revision, label_consistency) ON food_pantry FROM anon;

-- ════════════════════════════════════════════════════════════════════════════
-- food_scans — what a meal was actually made of
-- ════════════════════════════════════════════════════════════════════════════

-- The local calendar day the owner logged against, and the offset that makes it
-- reconstructable. `created_at` alone cannot answer "which day was this?" —
-- for an owner east of UTC every morning meal lands on the previous UTC day,
-- and after travel there is no way to recover the intent at all. 73% of
-- existing scans belong to owners with no timezone on file, which is exactly
-- why this is captured at log time from now on instead of inferred later.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS log_date DATE;
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS tz_offset_minutes INTEGER;
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS tz_name TEXT;

-- Already present in production but absent from every checked-in migration and
-- from schema.sql, and written on 0 of 335 rows. Guarded so environments built
-- from the repo converge with production instead of quietly diverging further.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS pantry_item_id UUID;

-- The FK exists in production already, but with NO ON DELETE action — so once
-- stage 6 starts actually populating pantry_item_id, `Remove Food` in the
-- profile screen (a plain DELETE on food_pantry) would begin failing with a
-- foreign-key violation for anyone who had logged a meal from that item. It has
-- been harmless purely because the column is written on 0 of 335 rows.
--
-- SET NULL rather than CASCADE, for the reason stated all over this schema:
-- losing a food must never silently delete the meals somebody logged from it.
-- The meal is the record of what the animal ate; the pantry row is a
-- convenience. Recreated rather than skipped, because the existing definition
-- is the wrong one.
ALTER TABLE food_scans DROP CONSTRAINT IF EXISTS food_scans_pantry_item_id_fkey;
ALTER TABLE food_scans ADD CONSTRAINT food_scans_pantry_item_id_fkey
  FOREIGN KEY (pantry_item_id) REFERENCES food_pantry(id) ON DELETE SET NULL;

-- The portion, in units that describe themselves.
--
--   weight   -> portion_quantity is GRAMS
--   count    -> portion_quantity is whole pieces
--   fraction -> portion_quantity is multiples of one serving unit (0.5 = half)
--
-- `unit_basis` distinguishes a manufacturer serving from the owner's bowl,
-- without which a fraction-mode meal_grams is not reproducible.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS portion_mode TEXT;
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS portion_quantity NUMERIC;
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS unit_basis TEXT;

-- Canonical, from the resolver. Never re-derived downstream: the old code
-- estimated meal weight back out of protein grams (or kcal / 3.5) to feed the
-- verdict layer, which is how one row ended up storing 240 kcal and 24,000 kcal
-- simultaneously.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS meal_grams NUMERIC;

-- The label facts as used, plus their provenance and the pantry revision they
-- came from. This is what makes a historical meal auditable after the pantry
-- item has been corrected — and what stops an adjustment silently re-pricing an
-- old meal at today's numbers.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS nutrition_snapshot JSONB;
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS kcal_basis TEXT;

-- Optimistic concurrency for adjust/delete, and the guard that stops a slow
-- background verdict write from reverting an adjustment that landed first.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 0;

-- LLM prose lives in its own column so the narration path cannot address
-- canonical fields at all. Patching keys inside food_analysis would have been
-- weaker: the whole object was being rewritten from a stale closure.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS verdict_narration TEXT;

-- Quality and anomalies. A confirmed anomaly is REAL intake and counts toward
-- observed MER; excluding a genuine binge would bias the estimate downward,
-- which is the opposite of the safety goal.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS quality TEXT;
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS anomaly_flags TEXT[];
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS anomaly_confirmed_at TIMESTAMPTZ;

-- Backfill classification (stage 7). 'exact' requires provenance captured AT
-- LOG TIME, so no existing row can ever qualify — the historical repair is a
-- reviewed process, not an automatic one.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS day_assignment TEXT;

-- Used by log_meal's ON CONFLICT insert (stage 6). The durable record of
-- adjust/delete idempotency lives in meal_mutations, which survives deletion.
ALTER TABLE food_scans ADD COLUMN IF NOT EXISTS idempotency_key UUID;

DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_portion_mode_check
    CHECK (portion_mode IS NULL OR portion_mode IN ('weight', 'count', 'fraction'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_unit_basis_check
    CHECK (unit_basis IS NULL OR unit_basis IN ('manufacturer', 'bowl'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No 'default'. A default-derived figure may drive non-persisted display
-- guidance, but it must never be written as a meal without owner confirmation,
-- which promotes it to 'owner_corrected'.
DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_kcal_basis_check
    CHECK (kcal_basis IS NULL OR kcal_basis IN
      ('label_density', 'label_serving', 'owner_corrected', 'estimated'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_quality_check
    CHECK (quality IS NULL OR quality IN
      ('verified', 'unverifiable', 'anomalous', 'ambiguous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_day_assignment_check
    CHECK (day_assignment IS NULL OR day_assignment IN ('exact', 'inferred', 'ambiguous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UTC-12 .. UTC+14, the real range of civil offsets.
DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_tz_offset_check
    CHECK (tz_offset_minutes IS NULL OR tz_offset_minutes BETWEEN -720 AND 840);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_portion_quantity_check
    CHECK (portion_quantity IS NULL OR portion_quantity > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE food_scans ADD CONSTRAINT food_scans_meal_grams_check
    CHECK (meal_grams IS NULL OR meal_grams > 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS food_scans_idempotency_key_idx
  ON food_scans (idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Reconciliation and the per-day quality rollup both read this way.
CREATE INDEX IF NOT EXISTS food_scans_pet_log_date_idx
  ON food_scans (pet_id, log_date) WHERE log_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS food_scans_pantry_item_idx
  ON food_scans (pantry_item_id) WHERE pantry_item_id IS NOT NULL;

COMMENT ON COLUMN food_scans.portion_quantity IS
  'Native units: grams (weight) | whole pieces (count) | multiples of one serving unit (fraction).';
COMMENT ON COLUMN food_scans.nutrition_snapshot IS
  'Label facts AS USED, with per-field provenance and the pantry nutrition_revision. Makes a historical meal auditable after the pantry item changes.';
COMMENT ON COLUMN food_scans.revision IS
  'Optimistic concurrency for adjust/delete, and the guard on the background verdict write.';

-- ════════════════════════════════════════════════════════════════════════════
-- daily_logs — day-level quality, and a floor that means something
-- ════════════════════════════════════════════════════════════════════════════

-- Worst-wins across the day's scans, in the order
-- verified < unverifiable < anomalous < ambiguous. A day carrying calories but
-- no scans is 'ambiguous' — something put a number there and we cannot say what.
--
-- Scan-level flags do not propagate on their own: observedMer consumes
-- daily_logs (via logs28), so the gate has to exist at day granularity or it
-- gates nothing.
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS calorie_quality TEXT;
ALTER TABLE daily_logs ADD COLUMN IF NOT EXISTS reconciled_at TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_calorie_quality_check
    CHECK (calorie_quality IS NULL OR calorie_quality IN
      ('verified', 'unverifiable', 'anomalous', 'ambiguous'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A backstop against direct PostgREST writes, NOT the mechanism. The
-- transactional path must refuse an underflow and record a reconciliation
-- anomaly rather than clamping it to zero: clamping hides pre-existing drift,
-- which is precisely the failure this whole plan exists to stop.
-- Verified before adding: 0 existing rows violate this.
DO $$ BEGIN
  ALTER TABLE daily_logs ADD CONSTRAINT daily_logs_non_negative_check
    CHECK (COALESCE(calories_consumed, 0) >= 0 AND COALESCE(treats_consumed, 0) >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN daily_logs.calorie_quality IS
  'Worst-wins across the day''s scans. Only verified days (and confirmed anomalies) feed observedMer.';

-- ════════════════════════════════════════════════════════════════════════════
-- Schema drift guard
-- ════════════════════════════════════════════════════════════════════════════
--
-- `food_scans.pantry_item_id` exists in production and appears in NO migration
-- and in no version of schema.sql. Nobody noticed because nothing compares the
-- two. `food_pantry` is not in schema.sql at all, so that file is a partial
-- historical document rather than a source of truth — worth saying out loud,
-- because treating it as authoritative is how the divergence persisted.
--
-- This exposes the live column layout so `npm run schema:check` can diff it
-- against a checked-in manifest. information_schema is not reachable through
-- PostgREST, hence a function; SECURITY DEFINER and service-role-only, because
-- the shape of every table is not something a client should be able to
-- enumerate.
CREATE OR REPLACE FUNCTION public.schema_manifest(p_tables TEXT[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(jsonb_object_agg(t.table_name, t.cols), '{}'::JSONB)
  FROM (
    SELECT c.table_name,
           jsonb_agg(
             jsonb_build_object(
               'name', c.column_name,
               'type', c.data_type,
               'nullable', c.is_nullable
             ) ORDER BY c.column_name
           ) AS cols
      FROM information_schema.columns c
      JOIN information_schema.tables tb
        ON tb.table_name = c.table_name
       AND tb.table_schema = 'public'
       AND tb.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND (p_tables IS NULL OR c.table_name = ANY(p_tables))
     GROUP BY c.table_name
  ) t;
$fn$;

REVOKE ALL ON FUNCTION public.schema_manifest(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_manifest(TEXT[]) TO service_role;

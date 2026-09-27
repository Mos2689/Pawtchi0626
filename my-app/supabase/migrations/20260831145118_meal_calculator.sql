-- Calorie pipeline integrity — the server-side calculator (stage 6a).
--
-- ── Why the server calculates at all ────────────────────────────────────────
--
-- Until now the client worked out a meal's calories and the server stored what
-- it was handed. That is not an invariant, it is a filing cabinet: a buggy
-- build (or a modified one) writes whatever it likes and the database agrees.
-- Everything else in this plan — provenance, quality, reconciliation — is
-- reasoning about numbers we never independently produced.
--
-- ── Why it does not REJECT a mismatching client ─────────────────────────────
--
-- The obvious design is "recompute, compare, refuse if they differ". That
-- turns every rounding difference between TypeScript and PL/pgSQL into a
-- user-facing failure to log a meal — a wrong trade, because the app's job is
-- to record what an animal ate.
--
-- So the server's number simply WINS. It is what gets persisted; the client's
-- figure is a preview. A disagreement is recorded for telemetry, not raised at
-- the owner. That keeps the invariant (only server arithmetic is ever stored)
-- without inventing a new way for logging to break.
--
-- ── Parity ─────────────────────────────────────────────────────────────────
--
-- This mirrors lib/pantryMath.ts and lib/mealLogKcal.ts. The two are exercised
-- against the SAME fixture file, supabase/tests/fixtures/kcal_vectors.json:
-- Jest runs it through the TypeScript, pgTAP runs it through this. Any drift
-- shows up as a failing vector rather than as a number on screen that
-- disagrees with the number in the database.
--
-- Rounding contract, and it matters more than it looks:
--   * NUMERIC throughout, never float
--   * rounding applied ONCE, at the final kcal, half-away-from-zero
--   * macro grams to one decimal place, same rule
-- Rounding at an intermediate step is the classic way two implementations of
-- "the same" formula stop agreeing.

-- ── Species serving-weight table ────────────────────────────────────────────
-- Mirrors DEFAULT_SERVING_GRAMS_BY_SPECIES in lib/pantryMath.ts.
-- `gram` is deliberately ABSENT: it is a unit conversion, not a serving size,
-- and treating one gram as one serving is the original defect this whole plan
-- exists to close. Weight-measured foods resolve through the density branch.
CREATE OR REPLACE FUNCTION public.pantry_unit_grams(
  p_unit    TEXT,
  p_species TEXT DEFAULT 'dog'
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE lower(coalesce(p_unit, ''))
    WHEN 'pouch'  THEN CASE WHEN p_species = 'cat' THEN 60  ELSE 85  END
    WHEN 'can'    THEN CASE WHEN p_species = 'cat' THEN 85  ELSE 150 END
    WHEN 'tray'   THEN CASE WHEN p_species = 'cat' THEN 70  ELSE 100 END
    WHEN 'sachet' THEN CASE WHEN p_species = 'cat' THEN 55  ELSE 80  END
    WHEN 'cup'    THEN CASE WHEN p_species = 'cat' THEN 70  ELSE 100 END
    WHEN 'piece'  THEN CASE WHEN p_species = 'cat' THEN 5   ELSE 10  END
    ELSE 100
  END;
$fn$;

/** Mirrors BOWL_SIZE_GRAMS. The owner's bowl, not the manufacturer's serving. */
CREATE OR REPLACE FUNCTION public.bowl_grams(p_size TEXT)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $fn$
  SELECT CASE lower(coalesce(p_size, ''))
    WHEN 'small'  THEN 100
    WHEN 'medium' THEN 200
    WHEN 'large'  THEN 300
    WHEN 'xl'     THEN 400
    ELSE 200
  END;
$fn$;

-- ── Serving weight, with provenance ─────────────────────────────────────────
-- Precedence mirrors resolveServingWeight() exactly:
--   1. the owner's bowl (cup/unspecified only) — basis 'bowl', never a label fact
--   2. an explicit serving_grams — NEVER clamped, because a 4.6 g supplement
--      dose is a real serving and rounding it "for safety" corrupts good data
--   3. derivation from density, for weight-measured food — clamped, because
--      this one IS a guess
--   4. the species table, then a flat default
CREATE OR REPLACE FUNCTION public.resolve_serving_weight(
  p_pantry_id UUID,
  p_bowl_size TEXT DEFAULT NULL,
  p_species   TEXT DEFAULT 'dog'
)
RETURNS TABLE (grams NUMERIC, basis TEXT, provenance TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r          food_pantry%ROWTYPE;
  v_unit     TEXT;
  v_derived  NUMERIC;
BEGIN
  SELECT * INTO r FROM food_pantry WHERE id = p_pantry_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 100::NUMERIC, 'manufacturer'::TEXT, 'default'::TEXT;
    RETURN;
  END IF;

  v_unit := lower(coalesce(r.serving_unit, ''));

  IF p_bowl_size IS NOT NULL AND v_unit IN ('cup', '') THEN
    RETURN QUERY SELECT bowl_grams(p_bowl_size), 'bowl'::TEXT, 'default'::TEXT;
    RETURN;
  END IF;

  IF r.serving_grams IS NOT NULL AND r.serving_grams > 0 THEN
    RETURN QUERY SELECT
      r.serving_grams,
      'manufacturer'::TEXT,
      coalesce(r.nutrition_provenance ->> 'serving_grams', 'estimated');
    RETURN;
  END IF;

  IF v_unit IN ('gram', 'g') THEN
    IF coalesce(r.kcal_per_serving, 0) > 0 AND coalesce(r.kcal_per_100g_as_fed, 0) > 0 THEN
      v_derived := (r.kcal_per_serving * 100.0) / r.kcal_per_100g_as_fed;
      RETURN QUERY SELECT
        LEAST(1000, GREATEST(5, round(v_derived / 5) * 5))::NUMERIC,
        'manufacturer'::TEXT,
        -- Computed FROM the calorie figures, so it can never be used to check
        -- them. Naming that here is what stops the check being circular.
        'derived'::TEXT;
      RETURN;
    END IF;
    RETURN QUERY SELECT 100::NUMERIC, 'manufacturer'::TEXT, 'default'::TEXT;
    RETURN;
  END IF;

  RETURN QUERY SELECT
    pantry_unit_grams(v_unit, p_species),
    'manufacturer'::TEXT,
    'default'::TEXT;
END;
$fn$;

-- ── The canonical meal ──────────────────────────────────────────────────────
-- Mirrors resolveCanonicalMeal(). Returns everything a meal write needs, so
-- log_meal has one source for the numbers it persists.
CREATE OR REPLACE FUNCTION public.compute_canonical_meal(
  p_pantry_id UUID,
  p_servings  NUMERIC,
  p_bowl_size TEXT DEFAULT NULL,
  p_species   TEXT DEFAULT 'dog',
  -- Used only when no pantry item backs the log.
  p_scan_kcal NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  r              food_pantry%ROWTYPE;
  v_grams        NUMERIC;
  v_basis        TEXT;
  v_prov         TEXT;
  v_servings     NUMERIC;
  v_meal_grams   NUMERIC;
  v_serving_kcal NUMERIC;
  v_kcal         NUMERIC;
  v_density      NUMERIC;
  v_moisture     NUMERIC;
  v_ash          NUMERIC;
  v_carbs_pct    NUMERIC;
  v_kcal_basis   TEXT;
  v_quality      TEXT;
  v_observed     BOOLEAN;
  v_mode         TEXT;
BEGIN
  -- Mirrors sanitiseServings: anything non-positive or non-finite means "we do
  -- not know what the owner picked", and one honest serving beats zero (which
  -- silently under-counts the day).
  v_servings := CASE WHEN p_servings IS NULL OR p_servings <= 0 THEN 1 ELSE p_servings END;

  IF p_pantry_id IS NULL THEN
    RETURN jsonb_build_object(
      'kcal', GREATEST(0, round(coalesce(p_scan_kcal, 0) * v_servings)),
      'meal_grams', NULL,
      'protein_g', 0, 'fat_g', 0, 'carbs_g', 0,
      'kcal_basis', 'estimated',
      'label_consistency', 'unverifiable',
      'quality', 'unverifiable',
      'portion_mode', 'fraction',
      'portion_quantity', v_servings,
      'unit_basis', 'manufacturer',
      'nutrition_snapshot', NULL,
      'servings', v_servings
    );
  END IF;

  SELECT * INTO r FROM food_pantry WHERE id = p_pantry_id;
  SELECT grams, basis, provenance INTO v_grams, v_basis, v_prov
    FROM resolve_serving_weight(p_pantry_id, p_bowl_size, p_species);

  v_meal_grams := round(v_grams * v_servings);
  v_density    := NULLIF(coalesce(r.kcal_per_100g_as_fed, 0), 0);

  -- Mirrors computePantryMacros: density drives the kcal only in bowl mode,
  -- where a "half bowl" has to actually scale. Otherwise the label's
  -- per-serving figure is used, falling back to a flat 350.
  IF v_basis = 'bowl' AND v_density IS NOT NULL THEN
    v_serving_kcal := round(v_density * v_grams / 100.0);
    v_kcal_basis := 'label_density';
  ELSIF coalesce(r.kcal_per_serving, 0) > 0 THEN
    v_serving_kcal := r.kcal_per_serving;
    v_kcal_basis := 'label_serving';
  ELSE
    v_serving_kcal := 350;
    v_kcal_basis := 'estimated';
  END IF;

  -- Rounded ONCE, here. See the rounding contract at the top of this file.
  v_kcal := round(v_serving_kcal * v_servings);

  IF r.nutrition_provenance ->> 'kcal_per_serving' = 'owner_corrected'
     OR r.nutrition_provenance ->> 'kcal_per_100g_as_fed' = 'owner_corrected'
     OR r.nutrition_provenance ->> 'serving_grams' = 'owner_corrected'
  THEN
    v_kcal_basis := 'owner_corrected';
  END IF;

  v_moisture := coalesce(r.moisture_pct, CASE WHEN r.food_type = 'wet_food' THEN 80 ELSE 10 END);
  v_ash      := CASE WHEN r.food_type = 'wet_food' THEN 3 ELSE 8 END;
  v_carbs_pct := GREATEST(0,
    100 - coalesce(r.protein_pct, 0) - coalesce(r.fat_pct, 0)
        - coalesce(r.fibre_pct, 0) - v_moisture - v_ash);

  -- A meal is only as verified as the facts behind it. Every kcal-relevant
  -- field must be independently observed, or a derived number ends up
  -- certifying itself.
  v_observed :=
       coalesce(r.nutrition_provenance ->> 'kcal_per_serving', '')     IN ('label', 'owner_corrected')
   AND coalesce(r.nutrition_provenance ->> 'kcal_per_100g_as_fed', '') IN ('label', 'owner_corrected')
   AND coalesce(CASE WHEN r.serving_grams IS NULL OR r.serving_grams <= 0
                     THEN v_prov
                     ELSE r.nutrition_provenance ->> 'serving_grams' END, '')
         IN ('label', 'owner_corrected');

  v_quality := CASE
    WHEN coalesce(r.label_consistency, 'unverifiable') = 'consistent' AND v_observed
      THEN 'verified'
    ELSE 'unverifiable'
  END;

  v_mode := CASE
    WHEN lower(coalesce(r.serving_unit, '')) IN ('gram', 'g') THEN 'weight'
    WHEN lower(coalesce(r.serving_unit, '')) = 'piece'        THEN 'count'
    ELSE 'fraction'
  END;

  RETURN jsonb_build_object(
    'kcal', v_kcal,
    'meal_grams', v_meal_grams,
    'protein_g', round(coalesce(r.protein_pct, 0) / 100.0 * v_meal_grams, 1),
    'fat_g',     round(coalesce(r.fat_pct, 0)     / 100.0 * v_meal_grams, 1),
    'carbs_g',   round(v_carbs_pct                / 100.0 * v_meal_grams, 1),
    'kcal_basis', v_kcal_basis,
    'label_consistency', coalesce(r.label_consistency, 'unverifiable'),
    'quality', v_quality,
    'portion_mode', v_mode,
    'portion_quantity', CASE WHEN v_mode = 'weight' THEN round(v_grams * v_servings) ELSE v_servings END,
    'unit_basis', v_basis,
    'nutrition_snapshot', jsonb_build_object(
      'kcal_per_serving', r.kcal_per_serving,
      'kcal_per_100g_as_fed', r.kcal_per_100g_as_fed,
      'serving_grams', coalesce(r.serving_grams, v_grams),
      'protein_pct', r.protein_pct,
      'fat_pct', r.fat_pct,
      'fibre_pct', r.fibre_pct,
      'moisture_pct', r.moisture_pct,
      'provenance', coalesce(r.nutrition_provenance, '{}'::JSONB)
        || jsonb_build_object('serving_grams',
             CASE WHEN r.serving_grams IS NULL OR r.serving_grams <= 0
                  THEN v_prov
                  ELSE coalesce(r.nutrition_provenance ->> 'serving_grams', 'estimated') END),
      'nutrition_revision', r.nutrition_revision,
      'label_consistency', coalesce(r.label_consistency, 'unverifiable')
    ),
    'servings', v_servings
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.resolve_serving_weight(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.compute_canonical_meal(UUID, NUMERIC, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_serving_weight(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.compute_canonical_meal(UUID, NUMERIC, TEXT, TEXT, NUMERIC) TO authenticated, service_role;

COMMENT ON FUNCTION public.compute_canonical_meal(UUID, NUMERIC, TEXT, TEXT, NUMERIC) IS
  'Authoritative meal calculation. Mirrors lib/mealLogKcal.ts resolveCanonicalMeal; both are exercised against supabase/tests/fixtures/kcal_vectors.json.';

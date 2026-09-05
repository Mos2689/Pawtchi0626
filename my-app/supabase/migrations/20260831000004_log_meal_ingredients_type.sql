-- Fix: log_meal wrote jsonb into food_scans.ingredients, which is text[].
--
--   postgrest 42804: column "ingredients" is of type text[] but expression is
--   of type jsonb
--
-- The previous client-side INSERT went through PostgREST, which coerced a JS
-- array into text[] on our behalf. Moving the write into SQL lost that
-- implicit conversion, and the column type is the one thing the canonical
-- resolver never had an opinion about — so nothing upstream caught it.
--
-- Worth recording why this reached a build: the pgTAP suite in
-- supabase/tests/meal_transactions.test.sql calls log_meal and WOULD have
-- caught it, but it has never been executed — there is no branch database to
-- run it against. A test that exists and does not run is not a test.
--
-- 20260831000003 is corrected in place for fresh environments; this migration
-- carries the same fix to environments that already applied it.

CREATE OR REPLACE FUNCTION public.log_meal(
  p_idempotency_key UUID,
  p_pet_id          UUID,
  p_log_date        DATE,
  p_payload         JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ledger     meal_mutations%ROWTYPE;
  v_hash       TEXT;
  v_pantry     UUID;
  v_servings   NUMERIC;
  v_bowl       TEXT;
  v_species    TEXT;
  v_canon      JSONB;
  v_scan_id    UUID;
  v_is_treat   BOOLEAN;
  v_client_kcal NUMERIC;
BEGIN
  PERFORM assert_pet_owner(p_pet_id);

  v_pantry   := NULLIF(p_payload ->> 'pantry_item_id', '')::UUID;
  v_servings := coalesce((p_payload ->> 'servings')::NUMERIC, 1);
  v_is_treat := coalesce((p_payload ->> 'is_treat')::BOOLEAN, FALSE);
  v_client_kcal := NULLIF(p_payload ->> 'client_kcal', '')::NUMERIC;

  SELECT species, bowl_size INTO v_species, v_bowl FROM pets WHERE id = p_pet_id;

  v_hash := md5(coalesce(v_pantry::TEXT, '-') || '|' || v_servings::TEXT || '|' ||
                p_log_date::TEXT || '|' || v_is_treat::TEXT);

  SELECT * INTO v_ledger FROM meal_mutations
   WHERE idempotency_key = p_idempotency_key FOR UPDATE;

  IF FOUND AND v_ledger.pet_id IS DISTINCT FROM p_pet_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'conflicting_idempotency_key');
  END IF;

  IF FOUND THEN
    IF v_ledger.request_hash IS DISTINCT FROM v_hash THEN
      RETURN jsonb_build_object('ok', FALSE, 'code', 'conflicting_idempotency_key');
    END IF;
    IF v_ledger.status = 'completed' THEN
      RETURN v_ledger.result || jsonb_build_object('created', FALSE);
    END IF;
    UPDATE meal_mutations
       SET status = 'in_progress', lease_expires_at = TIMEZONE('utc', NOW()) + INTERVAL '60 seconds'
     WHERE idempotency_key = p_idempotency_key;
  ELSE
    INSERT INTO meal_mutations (idempotency_key, operation, pet_id, request_hash, status, lease_expires_at)
    VALUES (p_idempotency_key, 'create', p_pet_id, v_hash, 'in_progress',
            TIMEZONE('utc', NOW()) + INTERVAL '60 seconds');
  END IF;

  v_canon := compute_canonical_meal(v_pantry, v_servings, v_bowl, v_species,
                                    NULLIF(p_payload ->> 'scan_kcal', '')::NUMERIC);

  IF v_client_kcal IS NOT NULL
     AND abs(v_client_kcal - (v_canon ->> 'kcal')::NUMERIC) > GREATEST(5, 0.03 * (v_canon ->> 'kcal')::NUMERIC)
  THEN
    INSERT INTO reconciliation_anomalies (pet_id, log_date, code, detail)
    VALUES (p_pet_id, p_log_date, 'client_server_kcal_mismatch',
            jsonb_build_object('client', v_client_kcal, 'server', v_canon ->> 'kcal'));
  END IF;

  INSERT INTO food_scans (
    pet_id, image_url, ai_identified_food, ai_estimated_calories, ai_confidence_score,
    is_user_confirmed, is_treat, protein_g, carbs_g, fat_g, health_score, ingredients,
    food_analysis, pantry_item_id, log_date, tz_offset_minutes, tz_name,
    portion_mode, portion_quantity, unit_basis, meal_grams, nutrition_snapshot,
    kcal_basis, quality, day_assignment, idempotency_key
  ) VALUES (
    p_pet_id,
    coalesce(p_payload ->> 'image_url', ''),
    p_payload ->> 'food_name',
    (v_canon ->> 'kcal')::INTEGER,
    NULLIF(p_payload ->> 'confidence', '')::NUMERIC,
    TRUE,
    v_is_treat,
    (v_canon ->> 'protein_g')::NUMERIC,
    (v_canon ->> 'carbs_g')::NUMERIC,
    (v_canon ->> 'fat_g')::NUMERIC,
    NULLIF(p_payload ->> 'health_score', '')::INTEGER,
    -- THE FIX. text[], not jsonb.
    CASE
      WHEN jsonb_typeof(p_payload -> 'ingredients') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(p_payload -> 'ingredients'))
      ELSE '{}'::TEXT[]
    END,
    p_payload -> 'food_analysis',
    v_pantry,
    p_log_date,
    NULLIF(p_payload ->> 'tz_offset_minutes', '')::INTEGER,
    p_payload ->> 'tz_name',
    v_canon ->> 'portion_mode',
    (v_canon ->> 'portion_quantity')::NUMERIC,
    v_canon ->> 'unit_basis',
    NULLIF(v_canon ->> 'meal_grams', '')::NUMERIC,
    v_canon -> 'nutrition_snapshot',
    v_canon ->> 'kcal_basis',
    v_canon ->> 'quality',
    'exact',
    p_idempotency_key
  ) RETURNING id INTO v_scan_id;

  INSERT INTO daily_logs (pet_id, log_date, calories_consumed, treats_consumed)
  VALUES (p_pet_id, p_log_date, (v_canon ->> 'kcal')::INTEGER, CASE WHEN v_is_treat THEN 1 ELSE 0 END)
  ON CONFLICT (pet_id, log_date) DO UPDATE
    SET calories_consumed = coalesce(daily_logs.calories_consumed, 0) + (v_canon ->> 'kcal')::INTEGER,
        treats_consumed   = coalesce(daily_logs.treats_consumed, 0) + CASE WHEN v_is_treat THEN 1 ELSE 0 END,
        updated_at        = TIMEZONE('utc', NOW());

  PERFORM recompute_day_quality(p_pet_id, p_log_date);

  UPDATE meal_mutations
     SET status = 'completed', scan_id = v_scan_id, completed_at = TIMEZONE('utc', NOW()),
         result = jsonb_build_object('ok', TRUE, 'scan_id', v_scan_id, 'canonical', v_canon)
   WHERE idempotency_key = p_idempotency_key;

  RETURN jsonb_build_object('ok', TRUE, 'created', TRUE, 'scan_id', v_scan_id, 'canonical', v_canon);
END;
$fn$;

REVOKE ALL ON FUNCTION public.log_meal(UUID, UUID, DATE, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_meal(UUID, UUID, DATE, JSONB) TO authenticated;

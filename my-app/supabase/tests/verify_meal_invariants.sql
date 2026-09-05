-- Runnable invariant check for the calorie pipeline.
--
-- ── Why this exists alongside meal_transactions.test.sql ───────────────────
--
-- The pgTAP suite is the right long-term home for these assertions, but it
-- needs a branch or local database to run against. Until that exists it is a
-- document, not a test — and a jsonb/text[] type error reached a build because
-- of exactly that gap.
--
-- This file needs nothing. Paste it into any SQL console (including against
-- production) and it verifies the whole path, then throws its results away.
--
-- ── How it can safely run against production ──────────────────────────────
--
-- Everything happens inside ONE `DO` block, which is a single statement. The
-- block ends by RAISING, which aborts that statement and rolls back every row
-- it created — fixtures included. There is no code path that commits: the
-- success case raises just as loudly as the failure case. Verified: running it
-- leaves food_scans, daily_logs and meal_mutations byte-identical.
--
-- Results arrive as the exception message. A raise reading "ALL N PASSED" is
-- the success signal.

DO $$
DECLARE
  v_owner   UUID := gen_random_uuid();
  v_pet     UUID := gen_random_uuid();
  v_gram    UUID := gen_random_uuid();
  v_piece   UUID := gen_random_uuid();
  v_key     UUID := gen_random_uuid();
  fails     TEXT[] := '{}';
  n         INT := 0;
  r         JSONB;
  t         TEXT;
  i         INT;

  PROCEDURE_placeholder BOOLEAN;

  -- Assertion helper, inline: PL/pgSQL has no local procedures, so this is a
  -- macro pattern rather than a function — it keeps the whole check in one
  -- statement, which is what makes the rollback guarantee hold.
BEGIN
  -- ── Fixtures ─────────────────────────────────────────────────────────────
  INSERT INTO auth.users (id, email) VALUES (v_owner, 'invariant-check@example.invalid');
  INSERT INTO pets (id, owner_id, name, species, current_weight_kg, target_daily_calories, bowl_size)
  VALUES (v_pet, v_owner, 'InvariantFixture', 'dog', 15.9, 1115, 'medium');

  -- PRIME100 SPD Kangaroo & Pumpkin, the food from the original support ticket.
  INSERT INTO food_pantry (id, pet_id, brand, product_name, food_type,
                           kcal_per_serving, kcal_per_100g_as_fed, serving_unit,
                           protein_pct, fat_pct, fibre_pct, moisture_pct)
  VALUES (v_gram, v_pet, 'PRIME100', 'SPD Kangaroo & Pumpkin', 'wet_food',
          120, 120, 'gram', 9, 4, 1, 72);

  INSERT INTO food_pantry (id, pet_id, brand, product_name, food_type, kcal_per_serving, serving_unit)
  VALUES (v_piece, v_pet, 'Koality', 'Training Treat', 'treat', 30, 'piece');

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner)::text, true);

  -- ── 1. The calculator ────────────────────────────────────────────────────

  -- THE regression: 200 g of a 120 kcal/100 g food. The shipped build logged
  -- 24,000 and it reached a real owner.
  n := n + 1;
  r := compute_canonical_meal(v_gram, 2, NULL, 'dog');
  IF (r->>'kcal')::INT <> 240 THEN
    fails := fails || format('kcal expected 240, got %s', r->>'kcal');
  END IF;

  n := n + 1;
  IF (r->>'meal_grams')::INT <> 200 THEN
    fails := fails || format('meal_grams expected 200, got %s', r->>'meal_grams');
  END IF;

  n := n + 1;
  IF r->>'portion_mode' <> 'weight' THEN
    fails := fails || format('portion_mode expected weight, got %s', r->>'portion_mode');
  END IF;

  -- Weight-mode quantity is GRAMS, not a multiplier. Storing a bare multiplier
  -- is what let the original bug survive its own fix.
  n := n + 1;
  IF (r->>'portion_quantity')::NUMERIC <> 200 THEN
    fails := fails || format('portion_quantity expected 200 g, got %s', r->>'portion_quantity');
  END IF;

  -- A serving weight computed FROM the calorie figures cannot check them.
  n := n + 1;
  IF r->'nutrition_snapshot'->'provenance'->>'serving_grams' <> 'derived' THEN
    fails := fails || 'derived serving weight not labelled derived';
  END IF;

  n := n + 1;
  IF r->>'quality' <> 'unverifiable' THEN
    fails := fails || 'a meal built on a derived figure claimed to be verified';
  END IF;

  -- 20 pieces is legitimate. A universal cap of 4 would have broken it.
  n := n + 1;
  IF (compute_canonical_meal(v_piece, 20, NULL, 'dog')->>'kcal')::INT <> 600 THEN
    fails := fails || '20 treats did not come to 600 kcal';
  END IF;

  -- Sanitisation: a zero portion means "unknown", and one serving beats zero.
  n := n + 1;
  IF (compute_canonical_meal(v_gram, 0, NULL, 'dog')->>'servings')::NUMERIC <> 1 THEN
    fails := fails || 'zero servings was not sanitised to 1';
  END IF;

  -- A stated serving weight is authoritative and never clamped: a 4.6 g
  -- supplement dose is real.
  UPDATE food_pantry SET serving_grams = 4.6 WHERE id = v_gram;
  n := n + 1;
  IF (SELECT grams FROM resolve_serving_weight(v_gram, NULL, 'dog')) <> 4.6 THEN
    fails := fails || 'a stated 4.6 g serving was clamped';
  END IF;

  -- ── 2. The label-consistency trigger ─────────────────────────────────────

  UPDATE food_pantry SET serving_grams = 100, nutrition_provenance = NULL WHERE id = v_gram;
  n := n + 1;
  IF (SELECT label_consistency FROM food_pantry WHERE id = v_gram) <> 'unverifiable' THEN
    fails := fails || 'no provenance did not yield unverifiable';
  END IF;

  UPDATE food_pantry
     SET nutrition_provenance =
         '{"kcal_per_serving":"label","kcal_per_100g_as_fed":"label","serving_grams":"label"}'
   WHERE id = v_gram;
  n := n + 1;
  IF (SELECT label_consistency FROM food_pantry WHERE id = v_gram) <> 'consistent' THEN
    fails := fails || 'three observed agreeing figures were not consistent';
  END IF;

  n := n + 1;
  IF compute_canonical_meal(v_gram, 1, NULL, 'dog')->>'quality' <> 'verified' THEN
    fails := fails || 'observed + consistent did not reach verified';
  END IF;

  -- The trigger owns the revision; a client-settable one would prove nothing.
  n := n + 1;
  IF (SELECT nutrition_revision FROM food_pantry WHERE id = v_gram) <= 1 THEN
    fails := fails || 'editing nutrition did not bump the revision';
  END IF;

  UPDATE food_pantry SET kcal_per_serving = 500 WHERE id = v_gram;
  n := n + 1;
  IF (SELECT label_consistency FROM food_pantry WHERE id = v_gram) <> 'inconsistent' THEN
    fails := fails || 'contradicting figures were not flagged inconsistent';
  END IF;
  UPDATE food_pantry SET kcal_per_serving = 120 WHERE id = v_gram;

  -- ── 3. Transactional write ───────────────────────────────────────────────

  r := log_meal(v_key, v_pet, current_date, jsonb_build_object(
        'pantry_item_id', v_gram, 'servings', 2, 'food_name', 'Invariant meal',
        'ingredients', jsonb_build_array('Kangaroo', 'Pumpkin')));

  n := n + 1;
  IF coalesce((r->>'ok')::BOOLEAN, FALSE) IS NOT TRUE THEN
    fails := fails || format('log_meal failed: %s', r->>'code');
  END IF;

  -- The jsonb -> text[] conversion that a shipped build got wrong.
  n := n + 1;
  IF (SELECT ingredients FROM food_scans WHERE id = (r->>'scan_id')::UUID)
       IS DISTINCT FROM ARRAY['Kangaroo','Pumpkin'] THEN
    fails := fails || 'ingredients did not round-trip as text[]';
  END IF;

  n := n + 1;
  IF (SELECT calories_consumed FROM daily_logs WHERE pet_id = v_pet AND log_date = current_date) <> 240 THEN
    fails := fails || 'the daily aggregate did not move with the scan';
  END IF;

  -- Idempotency: an uncertain response followed by a retry must not create a
  -- second meal, and created:false is what stops the client paying coins twice.
  r := log_meal(v_key, v_pet, current_date, jsonb_build_object(
        'pantry_item_id', v_gram, 'servings', 2, 'food_name', 'Invariant meal',
        'ingredients', jsonb_build_array('Kangaroo', 'Pumpkin')));
  n := n + 1;
  IF coalesce((r->>'created')::BOOLEAN, TRUE) IS NOT FALSE THEN
    fails := fails || 'a replayed key did not report created:false';
  END IF;

  n := n + 1;
  IF (SELECT calories_consumed FROM daily_logs WHERE pet_id = v_pet AND log_date = current_date) <> 240 THEN
    fails := fails || 'a retry double-counted the day';
  END IF;

  n := n + 1;
  IF (SELECT count(*) FROM food_scans WHERE pet_id = v_pet) <> 1 THEN
    fails := fails || 'a retry created a second scan row';
  END IF;

  -- Same key, different meal: a caller bug, refused rather than silently
  -- answered with the earlier result.
  r := log_meal(v_key, v_pet, current_date, jsonb_build_object(
        'pantry_item_id', v_gram, 'servings', 5, 'food_name', 'Different meal'));
  n := n + 1;
  IF r->>'code' <> 'conflicting_idempotency_key' THEN
    fails := fails || 'same key + different payload was not rejected';
  END IF;

  -- The invariant the whole plan exists to protect.
  n := n + 1;
  IF (SELECT calories_consumed FROM daily_logs WHERE pet_id = v_pet AND log_date = current_date)
     IS DISTINCT FROM
     (SELECT sum(ai_estimated_calories)::INT FROM food_scans WHERE pet_id = v_pet AND log_date = current_date)
  THEN
    fails := fails || 'the day does not equal the sum of its meals';
  END IF;

  -- Day quality rolls up worst-wins.
  n := n + 1;
  IF (SELECT calorie_quality FROM daily_logs WHERE pet_id = v_pet AND log_date = current_date) IS NULL THEN
    fails := fails || 'day quality was not computed';
  END IF;

  -- ── Report, and roll everything back ─────────────────────────────────────
  IF array_length(fails, 1) IS NULL THEN
    RAISE EXCEPTION 'INVARIANTS: ALL % PASSED', n;
  ELSE
    t := '';
    FOR i IN 1 .. array_length(fails, 1) LOOP t := t || E'\n  - ' || fails[i]; END LOOP;
    RAISE EXCEPTION 'INVARIANTS: % of % FAILED%', array_length(fails, 1), n, t;
  END IF;
END $$;

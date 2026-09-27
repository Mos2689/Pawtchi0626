-- Calorie pipeline integrity — transactional persistence (stage 6b).
--
-- ── The defect ─────────────────────────────────────────────────────────────
--
-- Logging a meal was two requests: INSERT food_scans, then call log_intake to
-- bump daily_logs. `log_intake` is itself a correct atomic increment, but
-- atomicity of step 2 does not make steps 1+2 atomic. Anything that killed the
-- app between them — a dropped connection, a backgrounded process — left a
-- scan with no aggregate.
--
-- Production shows this happened: one pet has a day reading 0 kcal against
-- three logged meals totalling 356. Reconciliation can repair that afterwards,
-- but repair is not the same as prevention, and a system that needs a nightly
-- sweep to be correct is a system that is wrong in between.
--
-- Everything a meal touches now happens in one transaction: the scan row, the
-- daily aggregate, and the day's quality rollup.
--
-- ── Error handling, and why it is not simply RAISE ─────────────────────────
--
-- The obvious design raises an exception on an integrity failure and writes a
-- row recording it. That does not work: RAISE rolls back the whole
-- transaction, INCLUDING the record of what went wrong. The evidence destroys
-- itself.
--
-- So two classes, handled differently:
--
--   EXPECTED integrity conditions (aggregate underflow, key conflict, stale
--   revision) are caught, NOT re-raised, and returned as a typed envelope. The
--   mutation is simply never applied, the ledger row is marked failed, the
--   anomaly is recorded, and the transaction COMMITS so the evidence survives.
--
--   UNEXPECTED errors (a constraint violation, a bug in here) do raise and roll
--   everything back. That is correct: no evidence should be manufactured from a
--   defect.

-- ── Mutation ledger ────────────────────────────────────────────────────────
--
-- A unique key on food_scans handles creation and nothing else: deleting the
-- scan destroys the key, and replaying an adjustment would re-apply its delta.
-- This is the durable record, and it deliberately has NO foreign key to
-- food_scans — it has to outlive the row it describes.
CREATE TABLE IF NOT EXISTS meal_mutations (
  idempotency_key   UUID PRIMARY KEY,
  operation         TEXT NOT NULL CHECK (operation IN ('create', 'adjust', 'delete')),
  scan_id           UUID,
  pet_id            UUID NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  request_hash      TEXT NOT NULL,
  result            JSONB,
  status            TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  -- A crashed request must not brick its key forever.
  lease_expires_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_meal_mutations_pet ON meal_mutations (pet_id, created_at DESC);
ALTER TABLE meal_mutations ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE meal_mutations IS
  'Idempotency ledger for meal create/adjust/delete. No FK to food_scans on purpose: it must survive deletion of the row it describes.';

-- Where expected integrity failures go, since they cannot be raised.
CREATE TABLE IF NOT EXISTS reconciliation_anomalies (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id        UUID REFERENCES pets(id) ON DELETE CASCADE,
  scan_id       UUID,
  log_date      DATE,
  code          TEXT NOT NULL,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  resolved_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_anomalies_open
  ON reconciliation_anomalies (created_at DESC) WHERE resolved_at IS NULL;
ALTER TABLE reconciliation_anomalies ENABLE ROW LEVEL SECURITY;

-- ── Day quality rollup ──────────────────────────────────────────────────────
--
-- Worst-wins across the day's scans: verified < unverifiable < anomalous <
-- ambiguous. A day carrying calories but no scans is 'ambiguous' — something
-- put a number there and we cannot say what.
--
-- This has to exist at DAY granularity because observedMer consumes
-- daily_logs, not individual scans. Flags on a scan gate nothing by themselves.
CREATE OR REPLACE FUNCTION public.recompute_day_quality(p_pet_id UUID, p_log_date DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_rank INTEGER;
  v_q    TEXT;
  v_n    INTEGER;
BEGIN
  SELECT count(*),
         max(CASE coalesce(quality, 'ambiguous')
               WHEN 'verified' THEN 0 WHEN 'unverifiable' THEN 1
               WHEN 'anomalous' THEN 2 ELSE 3 END)
    INTO v_n, v_rank
    FROM food_scans
   WHERE pet_id = p_pet_id AND log_date = p_log_date;

  IF v_n = 0 THEN
    v_q := 'ambiguous';
  ELSE
    v_q := CASE v_rank WHEN 0 THEN 'verified' WHEN 1 THEN 'unverifiable'
                       WHEN 2 THEN 'anomalous' ELSE 'ambiguous' END;
  END IF;

  UPDATE daily_logs SET calorie_quality = v_q
   WHERE pet_id = p_pet_id AND log_date = p_log_date;

  RETURN v_q;
END;
$fn$;

-- ── Ownership ───────────────────────────────────────────────────────────────
-- A SECURITY DEFINER function is its own trust boundary and must not assume the
-- caller arrived through an RLS policy.
CREATE OR REPLACE FUNCTION public.assert_pet_owner(p_pet_id UUID)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pets WHERE id = p_pet_id AND owner_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_pet_owner' USING ERRCODE = '42501';
  END IF;
END;
$fn$;

-- ── log_meal ────────────────────────────────────────────────────────────────
--
-- One transaction: the scan row, the daily aggregate, the quality rollup.
--
-- Returns an envelope rather than a row, because an expected integrity failure
-- has to come back as data (see the note on RAISE at the top).
-- `created` is what lets the client run its side effects exactly once: a retry
-- returns the existing scan with created=false, so coins are not awarded twice
-- and the pantry scan count is not double-bumped.
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

  -- Hashed SERVER-side over the values that actually determine the outcome. A
  -- client-supplied hash could be computed inconsistently and would defeat the
  -- different-payload check it exists to perform.
  v_hash := md5(coalesce(v_pantry::TEXT, '-') || '|' || v_servings::TEXT || '|' ||
                p_log_date::TEXT || '|' || v_is_treat::TEXT);

  -- Scoped to THIS pet. Idempotency keys are unique, not secret, and a key
  -- that collided with another account's must be refused rather than answered
  -- with that account's result.
  SELECT * INTO v_ledger FROM meal_mutations
   WHERE idempotency_key = p_idempotency_key FOR UPDATE;

  IF FOUND AND v_ledger.pet_id IS DISTINCT FROM p_pet_id THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'conflicting_idempotency_key');
  END IF;

  IF FOUND THEN
    IF v_ledger.request_hash IS DISTINCT FROM v_hash THEN
      -- Same key, different meal. Returning the earlier result would silently
      -- swallow this one; the caller has a bug and needs to hear about it.
      RETURN jsonb_build_object('ok', FALSE, 'code', 'conflicting_idempotency_key');
    END IF;
    IF v_ledger.status = 'completed' THEN
      RETURN v_ledger.result || jsonb_build_object('created', FALSE);
    END IF;
    -- 'failed', or an expired lease from a crashed attempt: retry it.
    UPDATE meal_mutations
       SET status = 'in_progress', lease_expires_at = TIMEZONE('utc', NOW()) + INTERVAL '60 seconds'
     WHERE idempotency_key = p_idempotency_key;
  ELSE
    INSERT INTO meal_mutations (idempotency_key, operation, pet_id, request_hash, status, lease_expires_at)
    VALUES (p_idempotency_key, 'create', p_pet_id, v_hash, 'in_progress',
            TIMEZONE('utc', NOW()) + INTERVAL '60 seconds');
  END IF;

  -- The server's own arithmetic. The client's figure is a preview and is only
  -- compared, never stored.
  v_canon := compute_canonical_meal(v_pantry, v_servings, v_bowl, v_species,
                                    NULLIF(p_payload ->> 'scan_kcal', '')::NUMERIC);

  IF v_client_kcal IS NOT NULL
     AND abs(v_client_kcal - (v_canon ->> 'kcal')::NUMERIC) > GREATEST(5, 0.03 * (v_canon ->> 'kcal')::NUMERIC)
  THEN
    -- Telemetry, not a refusal. A rounding difference between the app and the
    -- database must never stop someone recording what their animal ate.
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
    -- `ingredients` is text[], NOT jsonb. The old client insert went through
    -- PostgREST, which quietly coerced a JS array for us; writing it from SQL
    -- does not get that favour and needs the conversion spelled out.
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
    -- Captured at log time, so this row is repairable by construction. No
    -- historical row can claim this.
    'exact',
    p_idempotency_key
  ) RETURNING id INTO v_scan_id;

  -- Same atomic increment log_intake performs, inlined so it shares this
  -- transaction rather than being a second request that can fail alone.
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

-- ── adjust_meal ─────────────────────────────────────────────────────────────
--
-- Recomputes from the scan's STORED snapshot, never the pantry's current
-- values. If the owner corrects a label next month, that must not silently
-- re-price a meal logged today — the meal is a record of what happened, and
-- what happened used the numbers we had at the time.
--
-- Re-pricing at corrected values is a separate, explicit action, not a side
-- effect of changing a portion.
CREATE OR REPLACE FUNCTION public.adjust_meal(
  p_idempotency_key  UUID,
  p_scan_id          UUID,
  p_new_servings     NUMERIC,
  p_expected_revision INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_scan    food_scans%ROWTYPE;
  v_ledger  meal_mutations%ROWTYPE;
  v_hash    TEXT;
  v_old     INTEGER;
  v_new     INTEGER;
  v_snap    JSONB;
  v_per     NUMERIC;
  v_grams   NUMERIC;
  v_current INTEGER;
BEGIN
  SELECT * INTO v_scan FROM food_scans WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'scan_not_found');
  END IF;
  PERFORM assert_pet_owner(v_scan.pet_id);

  v_hash := p_scan_id::TEXT || '|' || p_new_servings::TEXT;

  SELECT * INTO v_ledger FROM meal_mutations
   WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF v_ledger.request_hash IS DISTINCT FROM v_hash THEN
      RETURN jsonb_build_object('ok', FALSE, 'code', 'conflicting_idempotency_key');
    END IF;
    IF v_ledger.status = 'completed' THEN
      RETURN v_ledger.result || jsonb_build_object('created', FALSE);
    END IF;
  END IF;

  -- Optimistic concurrency: a client working from a stale copy must refetch
  -- rather than overwrite whatever landed in between.
  IF p_expected_revision IS NOT NULL AND v_scan.revision IS DISTINCT FROM p_expected_revision THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'stale_revision', 'revision', v_scan.revision);
  END IF;

  v_snap := v_scan.nutrition_snapshot;
  IF v_snap IS NULL THEN
    -- Pre-provenance rows have no snapshot to recompute from. Scaling the
    -- stored total is the only honest option, and it is flagged as estimated.
    v_per := coalesce(v_scan.ai_estimated_calories, 0)::NUMERIC
             / GREATEST(1, coalesce(v_scan.portion_quantity, 1));
  ELSE
    v_per := coalesce((v_snap ->> 'kcal_per_serving')::NUMERIC, 0);
  END IF;

  v_old := coalesce(v_scan.ai_estimated_calories, 0);
  v_new := round(v_per * p_new_servings);
  v_grams := CASE WHEN v_snap IS NULL THEN NULL
                  ELSE round(coalesce((v_snap ->> 'serving_grams')::NUMERIC, 0) * p_new_servings) END;

  SELECT coalesce(calories_consumed, 0) INTO v_current
    FROM daily_logs WHERE pet_id = v_scan.pet_id AND log_date = v_scan.log_date FOR UPDATE;

  IF v_current IS NOT NULL AND v_current + (v_new - v_old) < 0 THEN
    -- Pre-existing drift, surfacing. Clamping to zero would hide it, which is
    -- exactly the habit this plan exists to break.
    INSERT INTO reconciliation_anomalies (pet_id, scan_id, log_date, code, detail)
    VALUES (v_scan.pet_id, p_scan_id, v_scan.log_date, 'aggregate_underflow',
            jsonb_build_object('current', v_current, 'delta', v_new - v_old));
    INSERT INTO meal_mutations (idempotency_key, operation, scan_id, pet_id, request_hash, status)
    VALUES (p_idempotency_key, 'adjust', p_scan_id, v_scan.pet_id, v_hash, 'failed')
    ON CONFLICT (idempotency_key) DO UPDATE SET status = 'failed';
    RETURN jsonb_build_object('ok', FALSE, 'code', 'aggregate_underflow');
  END IF;

  UPDATE food_scans
     SET ai_estimated_calories = v_new,
         portion_quantity = p_new_servings,
         meal_grams = coalesce(v_grams, meal_grams),
         -- The verdict's own figures move with the portion, so the stored
         -- analysis cannot drift from the stored calories.
         food_analysis = CASE WHEN food_analysis IS NULL THEN NULL ELSE
           food_analysis
             || jsonb_build_object('meal_kcal', v_new)
             || CASE WHEN v_grams IS NULL THEN '{}'::JSONB
                     ELSE jsonb_build_object('meal_grams', v_grams) END
         END,
         revision = revision + 1
   WHERE id = p_scan_id;

  UPDATE daily_logs
     SET calories_consumed = coalesce(calories_consumed, 0) + (v_new - v_old),
         updated_at = TIMEZONE('utc', NOW())
   WHERE pet_id = v_scan.pet_id AND log_date = v_scan.log_date;

  PERFORM recompute_day_quality(v_scan.pet_id, v_scan.log_date);

  INSERT INTO meal_mutations (idempotency_key, operation, scan_id, pet_id, request_hash, status,
                              completed_at, result)
  VALUES (p_idempotency_key, 'adjust', p_scan_id, v_scan.pet_id, v_hash, 'completed',
          TIMEZONE('utc', NOW()), jsonb_build_object('ok', TRUE, 'kcal', v_new))
  ON CONFLICT (idempotency_key) DO UPDATE
    SET status = 'completed', completed_at = TIMEZONE('utc', NOW()),
        result = jsonb_build_object('ok', TRUE, 'kcal', v_new);

  RETURN jsonb_build_object('ok', TRUE, 'created', TRUE, 'kcal', v_new);
END;
$fn$;

-- ── delete_meal ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_meal(
  p_idempotency_key UUID,
  p_scan_id         UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_scan    food_scans%ROWTYPE;
  v_ledger  meal_mutations%ROWTYPE;
  v_hash    TEXT := p_scan_id::TEXT;
  v_current INTEGER;
BEGIN
  SELECT * INTO v_ledger FROM meal_mutations
   WHERE idempotency_key = p_idempotency_key FOR UPDATE;
  IF FOUND AND v_ledger.status = 'completed' THEN
    -- The scan is already gone; replaying would decrement a second time.
    RETURN v_ledger.result || jsonb_build_object('created', FALSE);
  END IF;

  SELECT * INTO v_scan FROM food_scans WHERE id = p_scan_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'code', 'scan_not_found');
  END IF;
  PERFORM assert_pet_owner(v_scan.pet_id);

  SELECT coalesce(calories_consumed, 0) INTO v_current
    FROM daily_logs WHERE pet_id = v_scan.pet_id AND log_date = v_scan.log_date FOR UPDATE;

  IF v_current IS NOT NULL AND v_current - coalesce(v_scan.ai_estimated_calories, 0) < 0 THEN
    INSERT INTO reconciliation_anomalies (pet_id, scan_id, log_date, code, detail)
    VALUES (v_scan.pet_id, p_scan_id, v_scan.log_date, 'aggregate_underflow',
            jsonb_build_object('current', v_current, 'delta', -coalesce(v_scan.ai_estimated_calories, 0)));
    RETURN jsonb_build_object('ok', FALSE, 'code', 'aggregate_underflow');
  END IF;

  UPDATE daily_logs
     SET calories_consumed = coalesce(calories_consumed, 0) - coalesce(v_scan.ai_estimated_calories, 0),
         treats_consumed = GREATEST(0, coalesce(treats_consumed, 0) - CASE WHEN v_scan.is_treat THEN 1 ELSE 0 END),
         updated_at = TIMEZONE('utc', NOW())
   WHERE pet_id = v_scan.pet_id AND log_date = v_scan.log_date;

  DELETE FROM food_scans WHERE id = p_scan_id;
  PERFORM recompute_day_quality(v_scan.pet_id, v_scan.log_date);

  INSERT INTO meal_mutations (idempotency_key, operation, scan_id, pet_id, request_hash, status,
                              completed_at, result)
  VALUES (p_idempotency_key, 'delete', p_scan_id, v_scan.pet_id, v_hash, 'completed',
          TIMEZONE('utc', NOW()), jsonb_build_object('ok', TRUE, 'deleted', TRUE))
  ON CONFLICT (idempotency_key) DO UPDATE
    SET status = 'completed', completed_at = TIMEZONE('utc', NOW());

  RETURN jsonb_build_object('ok', TRUE, 'created', TRUE, 'deleted', TRUE);
END;
$fn$;

-- ── Atomic pantry scan count ────────────────────────────────────────────────
-- The client did read-modify-write, so two quick logs lost a count. Deriving
-- the figure from food_scans would be better still, but pantry_item_id is
-- populated on 0 of 335 historical rows — derivation would under-count every
-- meal ever logged. That comes after a cutover, not now.
CREATE OR REPLACE FUNCTION public.increment_pantry_scan(p_pantry_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE v_count INTEGER;
BEGIN
  UPDATE food_pantry
     SET scan_count = coalesce(scan_count, 0) + 1,
         last_scanned_at = TIMEZONE('utc', NOW())
   WHERE id = p_pantry_id
     AND EXISTS (SELECT 1 FROM pets WHERE pets.id = food_pantry.pet_id AND pets.owner_id = auth.uid())
  RETURNING scan_count INTO v_count;
  RETURN v_count;
END;
$fn$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.log_meal(UUID, UUID, DATE, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.log_meal(UUID, UUID, DATE, JSONB) TO authenticated;

REVOKE ALL ON FUNCTION public.adjust_meal(UUID, UUID, NUMERIC, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_meal(UUID, UUID, NUMERIC, INTEGER) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_meal(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_meal(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.increment_pantry_scan(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.increment_pantry_scan(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.recompute_day_quality(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_day_quality(UUID, DATE) TO service_role;

REVOKE ALL ON FUNCTION public.assert_pet_owner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assert_pet_owner(UUID) TO authenticated, service_role;

-- log_intake is NOT deprecated here. It is the general daily-metric primitive
-- for water and walk counters (activity.tsx, completeActivity.ts, walkSync.ts,
-- discardWalk.ts) and continues to own those. log_meal covers the meal path
-- only.

-- pgTAP suite for the meal calculator and the transactional write path.
--
-- Run against a BRANCH database, never production:
--   supabase db test --linked        (after `supabase branches create`)
-- or psql -f this file against a branch.
--
-- ── Why these tests and not others ─────────────────────────────────────────
--
-- Unit tests in Jest cover the arithmetic. They cannot cover the three things
-- that actually broke in production:
--
--   1. TWO IMPLEMENTATIONS DRIFTING. The TypeScript resolver and this SQL
--      calculator both compute a meal. They agree today (verified 8/8 on real
--      pantry rows). Nothing except a test stops someone changing one of them.
--   2. PARTIAL WRITES. A meal is a scan row plus a daily aggregate. The old
--      code wrote them in two requests and production has days that prove it.
--   3. RETRIES. An uncertain response followed by a retry must not produce two
--      meals, two coin awards, or two increments.
--
-- Each test below exists because the corresponding failure has either happened
-- or was one flaky connection away from happening.

BEGIN;
SELECT plan(24);

-- ── Fixtures ───────────────────────────────────────────────────────────────
-- A throwaway owner + pet + pantry item, all rolled back at the end.
CREATE TEMP TABLE t (k TEXT PRIMARY KEY, v UUID);

INSERT INTO t VALUES
  ('owner', gen_random_uuid()),
  ('pet',   gen_random_uuid()),
  ('gram',  gen_random_uuid()),
  ('piece', gen_random_uuid());

INSERT INTO auth.users (id, email) VALUES ((SELECT v FROM t WHERE k='owner'), 'pgtap@example.test');

INSERT INTO pets (id, owner_id, name, species, current_weight_kg, target_daily_calories, bowl_size)
VALUES ((SELECT v FROM t WHERE k='pet'), (SELECT v FROM t WHERE k='owner'),
        'Fixture', 'dog', 15.9, 1115, 'medium');

-- PRIME100 SPD Kangaroo & Pumpkin: the food from the original support ticket.
INSERT INTO food_pantry (id, pet_id, brand, product_name, food_type,
                         kcal_per_serving, kcal_per_100g_as_fed, serving_unit,
                         protein_pct, fat_pct, fibre_pct, moisture_pct)
VALUES ((SELECT v FROM t WHERE k='gram'), (SELECT v FROM t WHERE k='pet'),
        'PRIME100', 'SPD Kangaroo & Pumpkin', 'wet_food',
        120, 120, 'gram', 9, 4, 1, 72);

INSERT INTO food_pantry (id, pet_id, brand, product_name, food_type,
                         kcal_per_serving, serving_unit)
VALUES ((SELECT v FROM t WHERE k='piece'), (SELECT v FROM t WHERE k='pet'),
        'Koality', 'Training Treat', 'treat', 30, 'piece');

-- ══ 1. The calculator ══════════════════════════════════════════════════════

-- THE regression. 200 g of a 120 kcal/100 g food is 240 kcal. The build that
-- shipped before this work logged 24,000 — a hundredfold error that reached a
-- real owner and a real dog.
SELECT is(
  (compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 2, NULL, 'dog') ->> 'kcal')::INT,
  240,
  '200 g of a 120 kcal/100 g food is 240 kcal, not 24,000'
);

SELECT is(
  (compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 2, NULL, 'dog') ->> 'meal_grams')::INT,
  200, 'meal_grams is the real weight, not re-derived from protein'
);

SELECT is(
  compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 2, NULL, 'dog') ->> 'portion_mode',
  'weight', 'a gram-measured food is weight mode'
);

SELECT is(
  (compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 2, NULL, 'dog') ->> 'portion_quantity')::NUMERIC,
  200::NUMERIC, 'weight-mode quantity is GRAMS, not a multiplier'
);

-- A serving weight computed from the two calorie figures cannot then be used
-- to check them. This is the circularity an earlier design of the cross-check
-- would have passed.
SELECT is(
  compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 1, NULL, 'dog')
    -> 'nutrition_snapshot' -> 'provenance' ->> 'serving_grams',
  'derived', 'a derived serving weight is labelled derived'
);

SELECT is(
  compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 1, NULL, 'dog') ->> 'quality',
  'unverifiable', 'a meal built on a derived figure is never "verified"'
);

-- Count mode: 20 pieces is a legitimate portion. A universal cap of 4 would
-- have broken it, which is why the bounds are mode-specific.
SELECT is(
  (compute_canonical_meal((SELECT v FROM t WHERE k='piece'), 20, NULL, 'dog') ->> 'kcal')::INT,
  600, '20 training treats is 600 kcal'
);

SELECT is(
  compute_canonical_meal((SELECT v FROM t WHERE k='piece'), 3, NULL, 'dog') ->> 'portion_mode',
  'count', 'a piece-measured food is count mode'
);

-- The owner's bowl is not the manufacturer's serving.
SELECT is(
  compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 1, 'medium', 'dog') ->> 'unit_basis',
  'manufacturer', 'a bowl does not override a gram-measured food'
);

-- Non-positive servings mean "we do not know", and one honest serving beats
-- zero, which would silently under-count the day.
SELECT is(
  (compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 0, NULL, 'dog') ->> 'servings')::NUMERIC,
  1::NUMERIC, 'a zero portion is sanitised to one serving'
);

-- An explicit serving weight is authoritative and is NEVER clamped: a 4.6 g
-- supplement dose is a real serving.
UPDATE food_pantry SET serving_grams = 4.6 WHERE id = (SELECT v FROM t WHERE k='gram');
SELECT is(
  (SELECT grams FROM resolve_serving_weight((SELECT v FROM t WHERE k='gram'), NULL, 'dog')),
  4.6::NUMERIC, 'a stated 4.6 g serving survives intact'
);
UPDATE food_pantry SET serving_grams = NULL WHERE id = (SELECT v FROM t WHERE k='gram');

-- ══ 2. The label-consistency trigger ═══════════════════════════════════════

SELECT is(
  (SELECT label_consistency FROM food_pantry WHERE id = (SELECT v FROM t WHERE k='gram')),
  'unverifiable', 'no provenance means unverifiable, never consistent'
);

UPDATE food_pantry
   SET serving_grams = 100,
       nutrition_provenance = '{"kcal_per_serving":"label","kcal_per_100g_as_fed":"label","serving_grams":"label"}'
 WHERE id = (SELECT v FROM t WHERE k='gram');

SELECT is(
  (SELECT label_consistency FROM food_pantry WHERE id = (SELECT v FROM t WHERE k='gram')),
  'consistent', 'three observed, agreeing figures are consistent'
);

SELECT is(
  compute_canonical_meal((SELECT v FROM t WHERE k='gram'), 1, NULL, 'dog') ->> 'quality',
  'verified', 'observed + consistent is the only route to verified'
);

-- The trigger owns the revision. A client-settable one would prove nothing.
SELECT ok(
  (SELECT nutrition_revision FROM food_pantry WHERE id = (SELECT v FROM t WHERE k='gram')) > 1,
  'editing nutrition bumps the revision'
);

-- Figures that contradict each other are caught, not averaged or preferred.
UPDATE food_pantry SET kcal_per_serving = 500 WHERE id = (SELECT v FROM t WHERE k='gram');
SELECT is(
  (SELECT label_consistency FROM food_pantry WHERE id = (SELECT v FROM t WHERE k='gram')),
  'inconsistent', '500 kcal against 120 kcal/100 g x 100 g is inconsistent'
);
UPDATE food_pantry SET kcal_per_serving = 120 WHERE id = (SELECT v FROM t WHERE k='gram');

-- ══ 3. Authorization ═══════════════════════════════════════════════════════
-- A SECURITY DEFINER function is its own trust boundary and must not assume
-- the caller arrived through an RLS policy.

SELECT throws_ok(
  format('SELECT log_meal(%L::uuid, %L::uuid, current_date, %L::jsonb)',
         gen_random_uuid(), (SELECT v FROM t WHERE k='pet'), '{"servings":1}'),
  '42501',
  NULL,
  'log_meal refuses without an authenticated session'
);

-- ══ 4. Transactional write ═════════════════════════════════════════════════
-- Everything below runs as the fixture owner.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',
  json_build_object('sub', (SELECT v FROM t WHERE k='owner'))::text, TRUE);

CREATE TEMP TABLE k (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
INSERT INTO k DEFAULT VALUES;

SELECT ok(
  (log_meal((SELECT id FROM k), (SELECT v FROM t WHERE k='pet'), current_date,
            jsonb_build_object('pantry_item_id', (SELECT v FROM t WHERE k='gram'),
                               'servings', 2, 'food_name', 'Fixture meal')) ->> 'ok')::BOOLEAN,
  'log_meal succeeds for the pet owner'
);

SELECT is(
  (SELECT calories_consumed FROM daily_logs
    WHERE pet_id = (SELECT v FROM t WHERE k='pet') AND log_date = current_date),
  240, 'the daily aggregate moved in the same transaction as the scan'
);

SELECT is(
  (SELECT count(*)::INT FROM food_scans WHERE pet_id = (SELECT v FROM t WHERE k='pet')),
  1, 'exactly one scan row'
);

-- THE idempotency guarantee. An uncertain response followed by a retry must
-- not produce a second meal — and `created:false` is what tells the client not
-- to award coins or bump the pantry count a second time.
SELECT is(
  (log_meal((SELECT id FROM k), (SELECT v FROM t WHERE k='pet'), current_date,
            jsonb_build_object('pantry_item_id', (SELECT v FROM t WHERE k='gram'),
                               'servings', 2, 'food_name', 'Fixture meal')) ->> 'created')::BOOLEAN,
  FALSE, 'replaying the same key reports created:false'
);

SELECT is(
  (SELECT calories_consumed FROM daily_logs
    WHERE pet_id = (SELECT v FROM t WHERE k='pet') AND log_date = current_date),
  240, 'a retry does not double-count the day'
);

-- The same key with a DIFFERENT meal is a caller bug and must be refused, not
-- silently answered with the earlier result.
SELECT is(
  log_meal((SELECT id FROM k), (SELECT v FROM t WHERE k='pet'), current_date,
           jsonb_build_object('pantry_item_id', (SELECT v FROM t WHERE k='gram'),
                              'servings', 5, 'food_name', 'Different meal')) ->> 'code',
  'conflicting_idempotency_key', 'same key + different payload is rejected'
);

-- The scan and the day it belongs to must never disagree.
SELECT is(
  (SELECT calories_consumed FROM daily_logs
    WHERE pet_id = (SELECT v FROM t WHERE k='pet') AND log_date = current_date),
  (SELECT sum(ai_estimated_calories)::INT FROM food_scans
    WHERE pet_id = (SELECT v FROM t WHERE k='pet') AND log_date = current_date),
  'the day equals the sum of its meals'
);

SELECT * FROM finish();
ROLLBACK;

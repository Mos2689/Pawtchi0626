-- Calorie pipeline integrity — observability (stage 2).
--
-- REPORT ONLY. Nothing here repairs, blocks, or mutates user data. Its whole
-- job is to make the pipeline's failure modes visible before any of the later
-- stages start enforcing anything, because enforcing a rule whose false
-- positive rate you have never measured is how you break logging for people
-- who were doing nothing wrong.
--
-- Why this exists at all: a 24,000 kcal meal sat in production for four days
-- and surfaced through a customer support ticket, not through us. Every check
-- below would have caught it on the day it happened.
--
-- ── What is deliberately NOT checked yet ────────────────────────────────────
--
-- The provenance-aware cross-check belongs to stage 4 and cannot be written
-- here: `food_scans` has no `meal_grams`, no nutrition snapshot and no
-- calculation basis, so there is no second, independently-sourced number to
-- compare against. Comparing two figures that were derived from each other
-- returns 'consistent' on a 100x error — that mistake is documented in the
-- plan and is not repeated here.

-- ── Dedup ledger ────────────────────────────────────────────────────────────
-- Without this the digest re-reports the same historical rows every run and is
-- ignored within a week. A watermark per flagged entity, stamped only after a
-- send is accepted, so a failed send leaves the row eligible for the next run
-- rather than losing it. Same self-healing shape as `team_notified_at` on
-- support_tickets.
CREATE TABLE IF NOT EXISTS calorie_integrity_reports (
  check_name       TEXT NOT NULL,
  entity_key       TEXT NOT NULL,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  last_reported_at TIMESTAMPTZ,
  report_count     INTEGER NOT NULL DEFAULT 0,
  details          JSONB,
  PRIMARY KEY (check_name, entity_key)
);

CREATE INDEX IF NOT EXISTS idx_calorie_integrity_reports_unreported
  ON calorie_integrity_reports (last_reported_at NULLS FIRST);

-- No policies: this is operator-only telemetry about other people's pets, and
-- the service role bypasses RLS. An empty policy set is the deny-by-default.
ALTER TABLE calorie_integrity_reports ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE calorie_integrity_reports IS
  'Dedup watermark for the calorie-integrity digest. Operator telemetry only — never read by the app.';

-- ── The audit ───────────────────────────────────────────────────────────────
-- One function returning every currently-flagged row across all checks, so the
-- digest and an ad-hoc console query can never disagree about what counts as a
-- problem.
--
-- `severity` is advisory. Nothing branches on it in stage 2; it exists so the
-- digest can sort, and so the eventual enforcement thresholds are chosen from
-- observed data rather than invented.
CREATE OR REPLACE FUNCTION public.audit_calorie_integrity()
RETURNS TABLE (
  check_name TEXT,
  entity_key TEXT,
  severity   TEXT,
  pet_id     UUID,
  pet_name   TEXT,
  summary    TEXT,
  details    JSONB
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- 1. Aggregate drift: the denormalised daily total disagrees with the scans
  --    it is supposed to summarise.
  --
  --    CAVEAT, and it is a real one: `daily_logs.log_date` is the client's
  --    LOCAL date while `food_scans.created_at` is a timestamptz, so this
  --    buckets by UTC and a meal logged near local midnight can land on the
  --    adjacent day and look like drift. Small deltas here are suspect until
  --    stage 3 puts `log_date` + tz offset on the scan itself. Large ones —
  --    a day reading 0 against three logged meals — are not explicable that
  --    way and are the reason this check ships now rather than after stage 3.
  WITH scan_days AS (
    SELECT pet_id,
           (created_at AT TIME ZONE 'UTC')::DATE AS d,
           SUM(ai_estimated_calories)::INT       AS scan_kcal,
           COUNT(*)                              AS scan_count
      FROM food_scans
     GROUP BY 1, 2
  )
  SELECT
    'aggregate_drift'::TEXT,
    dl.id::TEXT,
    CASE WHEN ABS(dl.calories_consumed - s.scan_kcal) >= 200 THEN 'high' ELSE 'low' END,
    dl.pet_id,
    p.name,
    format('%s %s: day total %s kcal vs %s kcal across %s scan(s)',
           p.name, dl.log_date, dl.calories_consumed, s.scan_kcal, s.scan_count),
    jsonb_build_object(
      'log_date', dl.log_date,
      'calories_consumed', dl.calories_consumed,
      'scan_kcal', s.scan_kcal,
      'scan_count', s.scan_count,
      'drift', dl.calories_consumed - s.scan_kcal
    )
  FROM daily_logs dl
  JOIN scan_days s ON s.pet_id = dl.pet_id AND s.d = dl.log_date
  JOIN pets p      ON p.id = dl.pet_id
  WHERE dl.calories_consumed IS DISTINCT FROM s.scan_kcal

  UNION ALL

  -- 2. Implausible daily total. Not "the owner overfed" — 3x a maintenance
  --    target is past what a dog can physically eat in a day, so this is a
  --    data error looking for an explanation.
  SELECT
    'implausible_day'::TEXT,
    dl.id::TEXT,
    CASE WHEN dl.calories_consumed > 10 * p.target_daily_calories THEN 'critical' ELSE 'high' END,
    dl.pet_id,
    p.name,
    format('%s %s: %s kcal against a %s kcal target (%sx)',
           p.name, dl.log_date, dl.calories_consumed, p.target_daily_calories,
           ROUND(dl.calories_consumed::NUMERIC / p.target_daily_calories, 1)),
    jsonb_build_object(
      'log_date', dl.log_date,
      'calories_consumed', dl.calories_consumed,
      'target', p.target_daily_calories
    )
  FROM daily_logs dl
  JOIN pets p ON p.id = dl.pet_id
  WHERE COALESCE(p.target_daily_calories, 0) > 0
    AND dl.calories_consumed > 3 * p.target_daily_calories

  UNION ALL

  -- 3. Implausible single meal. Separate from the day check on purpose: one
  --    absurd meal inside an otherwise normal day is the exact shape of the
  --    gram-unit bug, and summing it away would hide the cause.
  SELECT
    'implausible_meal'::TEXT,
    fs.id::TEXT,
    CASE WHEN fs.ai_estimated_calories > 10 * p.target_daily_calories THEN 'critical' ELSE 'high' END,
    fs.pet_id,
    p.name,
    format('%s: "%s" logged at %s kcal against a %s kcal daily target',
           p.name, COALESCE(fs.ai_identified_food, 'unnamed'),
           fs.ai_estimated_calories, p.target_daily_calories),
    jsonb_build_object(
      'food', fs.ai_identified_food,
      'kcal', fs.ai_estimated_calories,
      'target', p.target_daily_calories,
      'created_at', fs.created_at
    )
  FROM food_scans fs
  JOIN pets p ON p.id = fs.pet_id
  WHERE COALESCE(p.target_daily_calories, 0) > 0
    AND fs.ai_estimated_calories > 3 * p.target_daily_calories

  UNION ALL

  -- 4. Label triple inconsistency — the stage-4 label-consistency check, in the
  --    only form available before provenance exists.
  --
  --    kcal_per_serving, kcal_per_100g_as_fed and the implied serving weight
  --    are over-determined: any two fix the third. When the implied weight is
  --    physically absurd, one of the two stated figures is wrong.
  --
  --    The band is deliberately wide. A 4.6 g supplement dose is real (Natural
  --    Animal Solutions Omega oil) and must not be flagged; this check is for
  --    order-of-magnitude errors, not for tuning.
  SELECT
    'label_inconsistent'::TEXT,
    fp.id::TEXT,
    'high'::TEXT,
    fp.pet_id,
    p.name,
    format('%s %s: %s kcal/serving at %s kcal/100g implies a %s g serving',
           fp.brand, fp.product_name, fp.kcal_per_serving, fp.kcal_per_100g_as_fed,
           ROUND(fp.kcal_per_serving * 100.0 / fp.kcal_per_100g_as_fed, 1)),
    jsonb_build_object(
      'kcal_per_serving', fp.kcal_per_serving,
      'kcal_per_100g_as_fed', fp.kcal_per_100g_as_fed,
      'implied_serving_grams', ROUND(fp.kcal_per_serving * 100.0 / fp.kcal_per_100g_as_fed, 1),
      'serving_unit', fp.serving_unit
    )
  FROM food_pantry fp
  JOIN pets p ON p.id = fp.pet_id
  WHERE fp.is_archived = FALSE
    AND COALESCE(fp.kcal_per_100g_as_fed, 0) > 0
    AND COALESCE(fp.kcal_per_serving, 0) > 0
    AND (fp.kcal_per_serving * 100.0 / fp.kcal_per_100g_as_fed) NOT BETWEEN 3 AND 1200;
$$;

-- ── Digest selection ────────────────────────────────────────────────────────
-- Everything currently flagged that has not been reported inside the cooldown.
-- A finding that is still true next week is worth one reminder, not seven.
CREATE OR REPLACE FUNCTION public.get_calorie_integrity_digest(
  p_cooldown INTERVAL DEFAULT INTERVAL '7 days',
  p_limit    INTEGER  DEFAULT 50
)
RETURNS TABLE (
  check_name TEXT,
  entity_key TEXT,
  severity   TEXT,
  pet_name   TEXT,
  summary    TEXT,
  details    JSONB,
  is_new     BOOLEAN
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.check_name, a.entity_key, a.severity, a.pet_name, a.summary, a.details,
         r.check_name IS NULL AS is_new
    FROM audit_calorie_integrity() a
    LEFT JOIN calorie_integrity_reports r
           ON r.check_name = a.check_name AND r.entity_key = a.entity_key
   WHERE r.last_reported_at IS NULL
      OR r.last_reported_at < TIMEZONE('utc', NOW()) - p_cooldown
   ORDER BY
     CASE a.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
     a.check_name
   LIMIT p_limit;
$$;

-- Called only after the digest send is accepted, so a failed send leaves the
-- findings eligible for the next run instead of silently swallowing them.
CREATE OR REPLACE FUNCTION public.mark_calorie_integrity_reported(
  p_check_names TEXT[],
  p_entity_keys TEXT[]
)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO calorie_integrity_reports (check_name, entity_key, last_reported_at, report_count)
  SELECT c, k, TIMEZONE('utc', NOW()), 1
    FROM UNNEST(p_check_names, p_entity_keys) AS t(c, k)
  ON CONFLICT (check_name, entity_key) DO UPDATE
    SET last_reported_at = EXCLUDED.last_reported_at,
        report_count     = calorie_integrity_reports.report_count + 1;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- Dispatcher-only. These read across every pet in the database; nothing
-- client-side has any business calling them.
REVOKE ALL ON FUNCTION public.audit_calorie_integrity() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_calorie_integrity() TO service_role;

REVOKE ALL ON FUNCTION public.get_calorie_integrity_digest(INTERVAL, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_calorie_integrity_digest(INTERVAL, INTEGER) TO service_role;

REVOKE ALL ON FUNCTION public.mark_calorie_integrity_reported(TEXT[], TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_calorie_integrity_reported(TEXT[], TEXT[]) TO service_role;

-- Duplicate-activity guardrail.
--
-- Symptom: the Activity timeline showed the same AI-generated slot twice
-- (e.g. two identical "Evening Hydration" rows). Root cause: the
-- generate-schedule edge function inserted a fresh plan without wiping the
-- existing one, so a re-generation / adjuster run / client retry stacked a
-- second full plan.
--
-- This migration (a) collapses any duplicates already sitting in the table,
-- keeping the most meaningful copy, and (b) installs a partial unique index so
-- the database itself rejects a duplicate AI slot from ever landing again —
-- the last line of defence behind the edge-function fix.

-- ── (a) Collapse existing duplicates ────────────────────────────────────────
-- Within a real single-day plan, (pet_id, scheduled_date, scheduled_time,
-- title) is already unique (fixed core-task titles + the builder's per-day
-- no-repeat rule), so any collision on that key is a stacked duplicate.
-- Keep one row per key, preferring completed > skipped > pending (never lose
-- history), then the earliest created, then the lowest id.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY pet_id, scheduled_date, scheduled_time, title
      ORDER BY
        CASE status
          WHEN 'completed' THEN 0
          WHEN 'skipped' THEN 1
          ELSE 2
        END,
        created_at ASC,
        id ASC
    ) AS rn
  FROM activities
  WHERE is_ai_generated = true
)
DELETE FROM activities
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── (b) Prevent it structurally ─────────────────────────────────────────────
-- Partial (AI-only) unique index. Manual logs are exempt — an owner may
-- legitimately log two of the same thing at the same minute.
CREATE UNIQUE INDEX IF NOT EXISTS activities_ai_unique_slot
  ON activities (pet_id, scheduled_date, scheduled_time, title)
  WHERE is_ai_generated = true;

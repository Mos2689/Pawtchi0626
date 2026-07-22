-- Provenance for the Body Condition Score + the raw photo-AI read.
--
-- bcs_source records how the confirmed score was arrived at:
--   'owner'         — picked a silhouette with no photo suggestion shown
--   'ai_confirmed'  — photo suggestion shown, owner confirmed it
--   'ai_overridden' — photo suggestion shown, owner picked a different shape
--   'vet_report'    — extracted from a scanned veterinary document
--
-- ai_bcs_low/high/confidence persist the raw Gemini band even when the
-- suggestion was suppressed or overridden — this is the calibration dataset
-- that measures whether the photo read beats owner guesses (by coat length,
-- breed, etc.) before we deepen trust in it.
ALTER TABLE pets ADD COLUMN IF NOT EXISTS bcs_source text
  CHECK (bcs_source IN ('owner', 'ai_confirmed', 'ai_overridden', 'vet_report'));
ALTER TABLE pets ADD COLUMN IF NOT EXISTS ai_bcs_low smallint
  CHECK (ai_bcs_low BETWEEN 1 AND 9);
ALTER TABLE pets ADD COLUMN IF NOT EXISTS ai_bcs_high smallint
  CHECK (ai_bcs_high BETWEEN 1 AND 9);
ALTER TABLE pets ADD COLUMN IF NOT EXISTS ai_bcs_confidence real
  CHECK (ai_bcs_confidence BETWEEN 0 AND 1);

-- Backfill: every existing score predates the photo suggestion.
UPDATE pets
SET bcs_source = 'owner'
WHERE body_condition_score IS NOT NULL
  AND bcs_source IS NULL;

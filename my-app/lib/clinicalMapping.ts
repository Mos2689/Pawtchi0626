/**
 * Single source of truth for translating freeform medical_conditions strings
 * (as typed by the user or surfaced from vet reports) into
 * clinical_adjustments.json keys.
 *
 * The verdict layer and the deterministic health-score function both go
 * through this file, so the mapping logic stays consistent.
 *
 * NOTE: only conditions present in clinical_adjustments.json `conditions`
 * (i.e. the LAUNCH-SCOPE conditions) should produce mapping keys here.
 * Deferred conditions (CKD, diabetes, urolithiasis) intentionally have no
 * mapping until they're gated behind explicit per-condition vet confirmation.
 */

import clinicalAdjustments from '../data/clinical_adjustments.json';

type Pattern = {
  /** Substring or regex to match against the freeform condition text (case-insensitive). */
  match: RegExp;
  /** Key in clinical_adjustments.json `conditions` that this should map to. */
  key: string;
};

const PATTERNS: Pattern[] = [
  { match: /pancreatit/i, key: 'pancreatitis_history' },
  // Obesity is intentionally NOT pattern-matched here — it's driven by the
  // weight-loss goal in resolveActiveAdjustments, not by a freeform string.
];

/**
 * Map a list of freeform medical_conditions strings to the clinical adjustment
 * keys that should apply. Unknown / deferred conditions are silently dropped.
 */
export function mapMedicalConditionsToAdjustmentKeys(
  conditions: string[] | null | undefined,
): string[] {
  if (!conditions || conditions.length === 0) return [];
  const launchKeys = new Set(Object.keys(clinicalAdjustments.conditions || {}));
  const out = new Set<string>();
  for (const condition of conditions) {
    for (const { match, key } of PATTERNS) {
      if (match.test(condition) && launchKeys.has(key)) {
        out.add(key);
      }
    }
  }
  return Array.from(out);
}

/**
 * Quick boolean check used by the health-score function and anywhere we need
 * "does this pet have condition X" without caring about the full mapping.
 */
export function hasMappedCondition(
  conditions: string[] | null | undefined,
  conditionKey: string,
): boolean {
  return mapMedicalConditionsToAdjustmentKeys(conditions).includes(conditionKey);
}

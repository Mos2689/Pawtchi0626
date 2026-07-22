/**
 * Weekly weight-loss rate validator.
 *
 * Vets use rate-of-loss as a primary safety signal during weight management.
 * AAHA + WSAVA guidelines: ≤1–2% body weight per week is the target. Faster
 * loss in dogs causes muscle wasting; in cats it is acutely dangerous — anorexia
 * during rapid weight loss is the leading cause of feline hepatic lipidosis,
 * which is fatal in ~50% of cases without aggressive nutritional support.
 *
 * This module is pure — it takes a current weight, a previous weight, and the
 * number of days between them, and returns a status flag the caller uses to
 * decide whether to ease the plan and surface a warning.
 */

export type LossRateStatus = 'safe' | 'fast' | 'dangerous';

export interface LossRateResult {
  /** Observed loss as a percentage of previous body weight per week. */
  pctPerWeek: number;
  /** Safety classification — see thresholds in the function body. */
  status: LossRateStatus;
  /** Whether this represents an actual loss (true) or stable/gain (false). */
  isLoss: boolean;
}

// Exported so the ideal-weight estimator can project timelines from the same
// safe-rate source instead of duplicating the guideline numbers.
export const SAFE_PCT_PER_WEEK = {
  dog: 1.5,
  cat: 1.0,
};

const DANGEROUS_PCT_PER_WEEK = {
  dog: 3.0,
  cat: 2.0,
};

/**
 * Classify a weight-loss rate against species-appropriate guidelines.
 *
 * @param currentWeightKg - the latest weight log
 * @param previousWeightKg - the prior reference weight
 * @param daysBetween - days between the two weights (must be > 0)
 * @param species - dog | cat
 *
 * @returns {pctPerWeek, status, isLoss}
 *   - status === 'safe' for ≤ species-safe threshold
 *   - status === 'fast' between safe and dangerous (warn but don't override)
 *   - status === 'dangerous' above species-dangerous threshold (ease the plan)
 *
 * Returns status='safe' if inputs are invalid or no time has elapsed — the
 * caller treats "unknown" the same as "safe enough to not interrupt the user".
 */
export function validateWeeklyLossRate(
  currentWeightKg: number,
  previousWeightKg: number,
  daysBetween: number,
  species: 'dog' | 'cat',
): LossRateResult {
  if (
    !Number.isFinite(currentWeightKg) || currentWeightKg <= 0 ||
    !Number.isFinite(previousWeightKg) || previousWeightKg <= 0 ||
    !Number.isFinite(daysBetween) || daysBetween <= 0
  ) {
    return { pctPerWeek: 0, status: 'safe', isLoss: false };
  }

  const lossKg = previousWeightKg - currentWeightKg;
  if (lossKg <= 0) {
    return { pctPerWeek: 0, status: 'safe', isLoss: false };
  }

  const pctLoss = (lossKg / previousWeightKg) * 100;
  const pctPerWeek = pctLoss * (7 / daysBetween);

  const safe = SAFE_PCT_PER_WEEK[species];
  const dangerous = DANGEROUS_PCT_PER_WEEK[species];

  let status: LossRateStatus;
  if (pctPerWeek >= dangerous) status = 'dangerous';
  else if (pctPerWeek > safe) status = 'fast';
  else status = 'safe';

  return { pctPerWeek, status, isLoss: true };
}

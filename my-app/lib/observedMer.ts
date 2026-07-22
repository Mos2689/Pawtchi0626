/**
 * Personalized MER v0 — back-fit a pet's actual maintenance calories from
 * observed weight and calorie-consumption logs.
 *
 * The RER/MER formulas are population averages. Every pet's real metabolism
 * drifts from the formula by roughly ±15% due to activity self-regulation,
 * gut microbiome, breed variance, and things the formula can't see. Vet
 * nutritionists correct for this by weighing at intervals and adjusting the
 * plan. This module automates the same loop:
 *
 *   1. Wait until we have ≥ 28 days of history since the plan started.
 *   2. Require ≥ 20 daily calorie logs in that window (≥ 70% density).
 *   3. Require ≥ 2 weight logs (start and current).
 *   4. Fit a weight slope in kg/day.
 *   5. Convert slope × 7700 kcal/kg = daily calorie imbalance.
 *      (7700 kcal/kg is the composite-tissue approximation used in AAHA
 *       weight-management calculators; NRC uses 9 kcal/g fat + 4 kcal/g lean.
 *       7700 is a defensible average when the composition split is unknown.)
 *   6. impliedMaintenance = avgKcal − dailyImbalance
 *      (surplus → lower true maintenance; deficit with weight loss → higher).
 *   7. impliedMerFactor = impliedMaintenance / RER(currentWeight).
 *   8. Clamp [0.7, 3.0] to reject sensor noise / bad logs.
 *   9. If |impliedFactor − predictedFactor| / predictedFactor > 0.15, flag
 *      the plan for a "recalibration suggested" prompt. We never mutate the
 *      target automatically — the owner confirms.
 */

import { calculateRER } from './healthMath';

export const KCAL_PER_KG_TISSUE = 7700;
export const MIN_DAYS_FOR_RECALIB = 28;
export const MIN_KCAL_LOGS_IN_WINDOW = 20;
export const MIN_WEIGHT_LOGS = 2;
export const RECALIB_THRESHOLD = 0.15;
export const IMPLIED_FACTOR_MIN = 0.7;
export const IMPLIED_FACTOR_MAX = 3.0;

export interface DailyKcalLog {
  /** ISO date (or ms since epoch) — only ordering matters. */
  logDate: string;
  caloriesConsumed: number;
}

export interface WeightLog {
  /** ISO timestamp. */
  loggedAt: string;
  weightKg: number;
}

export interface ObservedMerInput {
  currentWeightKg: number;
  /** Predicted MER factor at the current weight — RER × predicted = target. */
  predictedMerFactor: number;
  /** All kcal logs in the observation window (>= 28 days). */
  kcalLogs: DailyKcalLog[];
  /** Weight logs in the same window; must have ≥ 2 for a slope. */
  weightLogs: WeightLog[];
  /** Days since the plan started. Below the threshold, we won't recalibrate. */
  daysSincePlanStart: number;
}

export type ObservedMerStatus =
  | 'insufficient_history'
  | 'insufficient_kcal_logs'
  | 'insufficient_weight_logs'
  | 'noise'
  | 'stable'
  | 'recalibration_suggested';

export interface ObservedMerResult {
  status: ObservedMerStatus;
  /** Implied MER factor from observed data. Present when status !== insufficient_*. */
  impliedMerFactor?: number;
  /** Recommended new kcal target when recalibration_suggested. */
  suggestedDailyKcal?: number;
  /** Predicted daily kcal target (RER × predicted factor). Always present. */
  predictedDailyKcal: number;
  /** Diagnostic fields for a debug/settings surface. */
  avgKcalObserved?: number;
  weightSlopeKgPerDay?: number;
  daysObserved: number;
  kcalLogCount: number;
  weightLogCount: number;
}

function toMillis(value: string): number {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

function computeSlope(logs: WeightLog[]): number | null {
  if (logs.length < 2) return null;
  const sorted = [...logs].sort((a, b) => toMillis(a.loggedAt) - toMillis(b.loggedAt));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const dtMs = toMillis(last.loggedAt) - toMillis(first.loggedAt);
  if (!Number.isFinite(dtMs) || dtMs <= 0) return null;
  const days = dtMs / (1000 * 60 * 60 * 24);
  return (last.weightKg - first.weightKg) / days;
}

export function computeObservedMer(input: ObservedMerInput): ObservedMerResult {
  const predictedRer = calculateRER(input.currentWeightKg);
  const predictedDailyKcal = Math.round(predictedRer * input.predictedMerFactor);
  const base: Pick<ObservedMerResult, 'predictedDailyKcal' | 'daysObserved' | 'kcalLogCount' | 'weightLogCount'> = {
    predictedDailyKcal,
    daysObserved: input.daysSincePlanStart,
    kcalLogCount: input.kcalLogs.length,
    weightLogCount: input.weightLogs.length,
  };

  if (input.daysSincePlanStart < MIN_DAYS_FOR_RECALIB) {
    return { status: 'insufficient_history', ...base };
  }
  if (input.kcalLogs.length < MIN_KCAL_LOGS_IN_WINDOW) {
    return { status: 'insufficient_kcal_logs', ...base };
  }
  if (input.weightLogs.length < MIN_WEIGHT_LOGS) {
    return { status: 'insufficient_weight_logs', ...base };
  }

  const avgKcal = input.kcalLogs.reduce((s, l) => s + (l.caloriesConsumed || 0), 0) / input.kcalLogs.length;
  const slope = computeSlope(input.weightLogs);
  if (slope == null) {
    return { status: 'insufficient_weight_logs', ...base, avgKcalObserved: avgKcal };
  }

  const dailyImbalance = slope * KCAL_PER_KG_TISSUE;
  const impliedMaintenance = avgKcal - dailyImbalance;
  const impliedFactor = impliedMaintenance / predictedRer;

  const clamped = Math.max(IMPLIED_FACTOR_MIN, Math.min(IMPLIED_FACTOR_MAX, impliedFactor));
  const clampedByBound = clamped !== impliedFactor;

  const drift = Math.abs(clamped - input.predictedMerFactor) / input.predictedMerFactor;

  const shared = {
    ...base,
    impliedMerFactor: clamped,
    avgKcalObserved: Math.round(avgKcal),
    weightSlopeKgPerDay: slope,
  };

  if (clampedByBound) {
    // The raw implied factor was outside the trust window — most likely bad
    // logs (a huge scan mis-count, or a weigh-in on wet fur). Don't nudge.
    return { status: 'noise', ...shared };
  }

  if (drift <= RECALIB_THRESHOLD) {
    return { status: 'stable', ...shared };
  }

  return {
    status: 'recalibration_suggested',
    ...shared,
    suggestedDailyKcal: Math.round(predictedRer * clamped),
  };
}

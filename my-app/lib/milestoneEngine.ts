/**
 * Milestone engine — the recheck loop of the weight-management program.
 *
 * Targets from `estimateIdealWeight` are STAGED (first actionable target is
 * never more than ±12% from current). This module detects when a stage is
 * completed and drives the same loop a vet runs at a recheck appointment:
 * re-score body condition, set the next target, adjust the ration. Without
 * it, a pet that reaches its stage target plateaus there forever, running on
 * a day-0 BCS that is no longer true.
 *
 * Pure — callers (weight-log flows) pass current state, get back an event:
 *   - 'stage_reached'  → celebrate + prompt BCS re-score, then advance
 *   - 'final_reached'  → celebrate + transition to maintenance
 *   - 'bcs_stale'      → non-blocking re-score prompt (active plans, >8 weeks)
 *   - null             → nothing to do
 */

import {
  estimateIdealWeight,
  IdealWeightResult,
  Species,
  Sex,
  WeightClassification,
  WeightSeverity,
} from './idealWeight';

/** Stage-completion tolerance: max(0.1 kg, 0.5% of current weight). */
export function stageToleranceKg(currentWeightKg: number): number {
  return Math.max(0.1, currentWeightKg * 0.005);
}

/** Within this fraction of the final ideal, the journey is complete. */
export const FINAL_REACHED_PCT = 0.03;

/** Active-plan BCS older than this should be re-scored. */
export const BCS_STALE_DAYS = 56;

export type MilestoneEvent = 'stage_reached' | 'final_reached' | 'bcs_stale' | null;

export interface MilestoneInput {
  species: Species;
  breed: string | null | undefined;
  sex: Sex;
  ageMonths: number | null | undefined;
  /** Weight at plan start (earliest weight log / onboarding weight). */
  startWeightKg: number | null;
  /**
   * Weight before this log entry. Stage events only fire when this log
   * CROSSES the stage line — otherwise a pet sitting at its target would
   * re-celebrate on every weigh-in. `null` = treat as a first log (fire).
   */
  previousWeightKg?: number | null;
  currentWeightKg: number;
  /** The stored stage target (`pets.target_weight_kg`). */
  stageTargetKg: number | null;
  /** Stored owner BCS (may be stale). */
  bcs: number | null;
  /** ISO timestamp of the last BCS recording (`pets.bcs_updated_at`). */
  bcsUpdatedAt: string | null;
  /**
   * Weight at the time the BCS was recorded — used to predict how the score
   * has drifted. Callers use the weight log closest to `bcsUpdatedAt`;
   * falls back to `startWeightKg` when unknown.
   */
  bcsAnchorWeightKg?: number | null;
  now?: Date;
}

export interface MilestoneResult {
  event: MilestoneEvent;
  /** 0–100 toward the final ideal; null when it can't be computed. */
  progressPct: number | null;
  /**
   * BCS shifted by observed weight change since it was recorded — the best
   * available score when the owner dismisses the re-score prompt.
   */
  predictedBcs: number | null;
  /** Reconciled final ideal at the CURRENT weight and predicted BCS. */
  finalIdealKg: number | null;
  /** Present on stage_reached / final_reached: the recomputed next plan. */
  nextStage?: {
    targetKg: number;
    staged: boolean;
    finalIdealKg: number;
    classification?: WeightClassification;
    severity?: WeightSeverity;
    estimate: IdealWeightResult;
  };
}

/**
 * Shift the recorded BCS by the observed weight change: each 10% (dog) /
 * 12% (cat) of body weight ≈ 1 BCS point — the same per-point constant the
 * ideal-weight estimator uses, applied in reverse.
 */
export function predictBcs(
  species: Species,
  recordedBcs: number,
  anchorWeightKg: number,
  currentWeightKg: number,
): number {
  if (!(anchorWeightKg > 0) || !(currentWeightKg > 0)) return recordedBcs;
  const perPoint = species === 'cat' ? 0.12 : 0.10;
  const pctChange = (currentWeightKg - anchorWeightKg) / anchorWeightKg;
  const shifted = Math.round(recordedBcs + pctChange / perPoint);
  return Math.max(1, Math.min(9, shifted));
}

export function evaluateMilestone(input: MilestoneInput): MilestoneResult {
  const {
    species, breed, sex, ageMonths,
    startWeightKg, currentWeightKg, stageTargetKg,
    bcs, bcsUpdatedAt,
  } = input;
  const now = input.now ?? new Date();

  const empty: MilestoneResult = {
    event: null, progressPct: null, predictedBcs: null, finalIdealKg: null,
  };
  if (!Number.isFinite(currentWeightKg) || currentWeightKg <= 0) return empty;

  const anchor = input.bcsAnchorWeightKg ?? startWeightKg ?? null;
  const predictedBcs = bcs != null && anchor != null
    ? predictBcs(species, bcs, anchor, currentWeightKg)
    : bcs ?? null;

  // Re-estimate at today's weight with the drift-corrected BCS. This is the
  // engine's view of "where the plan should be going now".
  const estimate = estimateIdealWeight({
    species, breed, sex, ageMonths,
    currentWeightKg,
    bcs: predictedBcs,
  });

  // Growing pets don't run the milestone loop — the growth guard owns them.
  if (estimate.mode !== 'ok' || estimate.finalIdealKg == null) return empty;

  const finalIdealKg = estimate.finalIdealKg;

  // Progress toward the FINAL ideal (not the stage) — the number owners see.
  let progressPct: number | null = null;
  if (startWeightKg != null && startWeightKg > 0 && Math.abs(startWeightKg - finalIdealKg) > 0.05) {
    const raw = (startWeightKg - currentWeightKg) / (startWeightKg - finalIdealKg);
    progressPct = Math.round(Math.max(0, Math.min(1, raw)) * 100);
  }

  const base: MilestoneResult = { event: null, progressPct, predictedBcs, finalIdealKg };

  // ── Stage completion ──
  if (stageTargetKg != null && stageTargetKg > 0) {
    const tol = stageToleranceKg(currentWeightKg);
    // Plan direction from where the journey started; falls back to the BCS
    // signal when the start weight is unknown.
    const direction: 'lose' | 'gain' | null = startWeightKg != null && startWeightKg > 0
      ? (stageTargetKg < startWeightKg - tol ? 'lose' : stageTargetKg > startWeightKg + tol ? 'gain' : null)
      : bcs != null
        ? (bcs > 5 ? 'lose' : bcs < 5 ? 'gain' : null)
        : null;

    const reached =
      (direction === 'lose' && currentWeightKg <= stageTargetKg + tol) ||
      (direction === 'gain' && currentWeightKg >= stageTargetKg - tol);

    // Only fire when this log actually crossed the line. A pet already at
    // its target (previous weight also inside tolerance) is maintaining,
    // not achieving — no repeat celebrations.
    const prev = input.previousWeightKg;
    const crossed = prev == null ||
      (direction === 'lose' && prev > stageTargetKg + tol) ||
      (direction === 'gain' && prev < stageTargetKg - tol);

    if (reached && crossed) {
      const atFinal = Math.abs(currentWeightKg - finalIdealKg) / currentWeightKg <= FINAL_REACHED_PCT;
      return {
        ...base,
        event: atFinal ? 'final_reached' : 'stage_reached',
        nextStage: {
          targetKg: estimate.targetKg!,
          staged: estimate.staged ?? false,
          finalIdealKg,
          classification: estimate.classification,
          severity: estimate.severity,
          estimate,
        },
      };
    }
  }

  // ── Stale BCS on an active plan ──
  // "Active" = the fresh estimate still wants meaningful change (>3% away
  // from final ideal). A maintenance pet doesn't need cadenced re-scoring.
  const planActive = Math.abs(currentWeightKg - finalIdealKg) / currentWeightKg > FINAL_REACHED_PCT;
  if (planActive && bcsUpdatedAt) {
    const recordedAt = Date.parse(bcsUpdatedAt);
    if (Number.isFinite(recordedAt)) {
      const ageDays = (now.getTime() - recordedAt) / (1000 * 60 * 60 * 24);
      if (ageDays > BCS_STALE_DAYS) {
        return { ...base, event: 'bcs_stale' };
      }
    }
  }

  return base;
}

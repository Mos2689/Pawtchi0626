/**
 * Weight-plan state machine.
 *
 * A scale reading is evidence about progress, never permission to redefine
 * the destination. The active ideal stays locked until an explicit body
 * assessment creates a new revision.
 */

import {
  estimateIdealWeight,
  roundTargetKg,
  type IdealWeightBand,
  type IdealWeightResult,
  type Species,
  type Sex,
} from './idealWeight';
import { BCS_STALE_DAYS } from './milestoneEngine';

/**
 * Whether a weight can support an assessment at all.
 *
 * An ideal weight is derived FROM a measured weight, so a profile that has
 * never recorded one has nothing to assess. Walk-first onboarding leaves the
 * weight at 0 as the sentinel for exactly that state — and 0 is the value
 * `weight_plan_assessments.assessment_weight_kg > 0` rejects, so an assessment
 * attempted on it fails in the database rather than in the app.
 *
 * Callers use this to take their existing "reassess this later" path instead:
 * a profile that is not ready yet is a known state, not a failure to report.
 */
export function isAssessableWeightKg(weightKg: number | null | undefined): boolean {
  return typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0;
}

export type WeightPlanStatus =
  | 'growth'
  | 'active'
  | 'maintenance'
  | 'verify_change'
  | 'needs_reassessment'
  | 'supervised';

export type WeightAssessmentSource =
  | 'onboarding'
  | 'owner_bcs'
  | 'guided_check'
  | 'milestone'
  | 'vet_report'
  | 'profile_change'
  | 'life_stage'
  | 'migration';

export type WeightMeasurementSource =
  | 'manual'
  | 'profile'
  | 'vet_report'
  | 'onboarding'
  | 'device';

export const MAINTENANCE_TOLERANCE_PCT = 0.03;
export const IMMEDIATE_REOPEN_PCT = 0.05;
export const VERIFY_READING_GAP_MS = 12 * 60 * 60 * 1000;
export const IDEAL_CHANGE_DISCLOSURE_PCT = 0.03;

export function canAssessmentSupersede(
  activeAssessedAt: string | null | undefined,
  candidateAssessedAt: string,
): boolean {
  const candidate = Date.parse(candidateAssessedAt);
  if (!Number.isFinite(candidate)) return false;
  if (!activeAssessedAt) return true;
  const active = Date.parse(activeAssessedAt);
  return !Number.isFinite(active) || candidate >= active;
}

export interface WeightPlanPet {
  species: Species;
  breed?: string | null;
  gender?: Sex;
  ageMonths?: number | null;
  currentWeightKg: number;
  targetWeightKg?: number | null;
  idealWeightKg?: number | null;
  healthyBandLowKg?: number | null;
  healthyBandHighKg?: number | null;
  weightAssessmentKg?: number | null;
  weightAssessmentBcs?: number | null;
  weightAssessedAt?: string | null;
  journeyStartWeightKg?: number | null;
  bodyConditionScore?: number | null;
  bcsUpdatedAt?: string | null;
  planStatus?: WeightPlanStatus | null;
  planRevision?: number | null;
  reproductiveStatus?: 'pregnant' | 'nursing' | 'neither' | null;
}

export interface WeightMeasurementEvidence {
  weightKg: number;
  loggedAt: string | number | Date;
}

export interface WeightPlanEvaluation {
  status: WeightPlanStatus;
  reason:
    | 'growth'
    | 'supervised'
    | 'missing_assessment'
    | 'legacy_active'
    | 'legacy_maintenance'
    | 'active'
    | 'stale_bcs'
    | 'stage_target_reached'
    | 'within_maintenance'
    | 'measurement_returned'
    | 'verify_change'
    | 'confirmed_change'
    | 'large_change'
    | 'outside_healthy_band'
    | 'target_ideal_mismatch'
    | 'awaiting_reassessment';
  idealWeightKg: number | null;
  targetWeightKg: number | null;
  healthyBand: IdealWeightBand | null;
  deviationPct: number | null;
  idealChangePct: number | null;
  requiresAssessment: boolean;
}

export interface WeightPlanViewModel extends WeightPlanEvaluation {
  currentWeightKg: number;
  showHealthyBanner: boolean;
  showJourney: boolean;
  showVerifyPrompt: boolean;
  showAssessmentPrompt: boolean;
  progressPct: number | null;
}

export interface WeightAssessmentInput {
  pet: WeightPlanPet;
  bcs: number;
  source: WeightAssessmentSource;
  assessedAt?: string;
  /** Weight measured with this BCS; may differ from today's current weight. */
  assessmentWeightKg?: number;
}

export interface WeightAssessmentRevision {
  revision: number;
  source: WeightAssessmentSource;
  assessedAt: string;
  assessmentWeightKg: number;
  bcs: number;
  idealWeightKg: number | null;
  targetWeightKg: number | null;
  healthyBand: IdealWeightBand | null;
  status: WeightPlanStatus;
  confidence: 'high' | 'low' | null;
  estimate: IdealWeightResult;
  previousIdealWeightKg: number | null;
  idealChangePct: number | null;
  discloseIdealChange: boolean;
}

const validPositive = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

function pctDistance(a: number, b: number): number {
  return Math.abs(a - b) / Math.max(b, 0.001);
}

function usableBand(pet: WeightPlanPet): IdealWeightBand | null {
  return validPositive(pet.healthyBandLowKg) &&
    validPositive(pet.healthyBandHighKg) &&
    pet.healthyBandLowKg <= pet.healthyBandHighKg
    ? { low: pet.healthyBandLowKg, high: pet.healthyBandHighKg }
    : null;
}

function isGrowing(pet: WeightPlanPet): boolean {
  if (!validPositive(pet.currentWeightKg)) return false;
  return (
    estimateIdealWeight({
      species: pet.species,
      breed: pet.breed,
      sex: pet.gender,
      ageMonths: pet.ageMonths,
      currentWeightKg: pet.currentWeightKg,
      bcs: pet.bodyConditionScore,
    }).mode === 'growth'
  );
}

function hasTwoOutsideReadings(
  measurements: WeightMeasurementEvidence[],
  idealWeightKg: number,
): boolean {
  const usable = measurements
    .flatMap((measurement) => {
      const at = new Date(measurement.loggedAt).getTime();
      return validPositive(measurement.weightKg) && Number.isFinite(at)
        ? [{ weightKg: measurement.weightKg, at }]
        : [];
    })
    .sort((a, b) => b.at - a.at);

  if (usable.length < 2) return false;
  const latest = usable[0];
  const previous = usable.find(
    (measurement) =>
      latest.at - measurement.at >= VERIFY_READING_GAP_MS,
  );
  return Boolean(
    previous &&
      pctDistance(latest.weightKg, idealWeightKg) >
        MAINTENANCE_TOLERANCE_PCT &&
      pctDistance(previous.weightKg, idealWeightKg) >
        MAINTENANCE_TOLERANCE_PCT,
  );
}

function isBcsStale(pet: WeightPlanPet, now: Date): boolean {
  const sourceAt = pet.weightAssessedAt ?? pet.bcsUpdatedAt;
  if (!sourceAt) return true;
  const time = Date.parse(sourceAt);
  if (!Number.isFinite(time)) return true;
  return now.getTime() - time > BCS_STALE_DAYS * 24 * 60 * 60 * 1000;
}

function hasCrossedStageTarget(
  pet: WeightPlanPet,
  targetWeightKg: number | null,
): boolean {
  if (!targetWeightKg || !validPositive(pet.currentWeightKg)) {
    return false;
  }
  const start = validPositive(pet.journeyStartWeightKg)
    ? pet.journeyStartWeightKg
    : validPositive(pet.weightAssessmentKg)
      ? pet.weightAssessmentKg
      : null;
  if (!start || Math.abs(start - targetWeightKg) < 0.05) {
    return false;
  }
  return targetWeightKg < start
    ? pet.currentWeightKg <= targetWeightKg
    : pet.currentWeightKg >= targetWeightKg;
}

/**
 * Reconcile effective status from a persisted assessment and fresh readings.
 * This function never derives a new ideal from the latest weight.
 */
export function evaluateWeightPlan(
  pet: WeightPlanPet,
  measurements: WeightMeasurementEvidence[] = [],
  now = new Date(),
): WeightPlanEvaluation {
  const target = validPositive(pet.targetWeightKg)
    ? pet.targetWeightKg
    : null;
  const ideal = validPositive(pet.idealWeightKg)
    ? pet.idealWeightKg
    : target;
  const band = usableBand(pet);

  if (isGrowing(pet)) {
    return {
      status: 'growth',
      reason: 'growth',
      idealWeightKg: null,
      targetWeightKg: target,
      healthyBand: band,
      deviationPct: null,
      idealChangePct: null,
      requiresAssessment: false,
    };
  }

  if (
    pet.reproductiveStatus === 'pregnant' ||
    pet.reproductiveStatus === 'nursing'
  ) {
    return {
      status: 'supervised',
      reason: 'supervised',
      idealWeightKg: ideal,
      targetWeightKg: target,
      healthyBand: band,
      deviationPct:
        ideal && validPositive(pet.currentWeightKg)
          ? pctDistance(pet.currentWeightKg, ideal)
          : null,
      idealChangePct: null,
      requiresAssessment: true,
    };
  }

  if (pet.planStatus === 'growth') {
    return {
      status: 'needs_reassessment',
      reason: 'awaiting_reassessment',
      idealWeightKg: null,
      targetWeightKg: target,
      healthyBand: band,
      deviationPct: null,
      idealChangePct: null,
      requiresAssessment: true,
    };
  }

  if (!ideal || !validPositive(pet.currentWeightKg)) {
    return {
      status: 'needs_reassessment',
      reason: 'missing_assessment',
      idealWeightKg: ideal,
      targetWeightKg: target,
      healthyBand: band,
      deviationPct: null,
      idealChangePct: null,
      requiresAssessment: true,
    };
  }

  const current = pet.currentWeightKg;
  const deviationPct = pctDistance(current, ideal);
  const outsideBand = Boolean(
    band && (current < band.low || current > band.high),
  );
  const targetIdealMismatch = Boolean(
    target &&
      pctDistance(target, ideal) > MAINTENANCE_TOLERANCE_PCT &&
      pet.planStatus === 'maintenance',
  );

  const base = {
    idealWeightKg: ideal,
    targetWeightKg: target,
    healthyBand: band,
    deviationPct,
    idealChangePct: null,
  };

  if (pet.planStatus === 'active') {
    if (hasCrossedStageTarget(pet, target)) {
      return {
        ...base,
        status: 'needs_reassessment',
        reason: 'stage_target_reached',
        requiresAssessment: true,
      };
    }
    if (isBcsStale(pet, now)) {
      return {
        ...base,
        status: 'needs_reassessment',
        reason: 'stale_bcs',
        requiresAssessment: true,
      };
    }
    return {
      ...base,
      status: 'active',
      reason: 'active',
      requiresAssessment: false,
    };
  }

  if (
    pet.planStatus === 'needs_reassessment' ||
    pet.planStatus === 'supervised'
  ) {
    return {
      ...base,
      status: 'needs_reassessment',
      reason: 'awaiting_reassessment',
      requiresAssessment: true,
    };
  }

  // A maintenance declaration is only valid when it is backed by a
  // confirmed healthy band. Legacy/provisional plans can keep progressing,
  // but they cannot surface the healthy banner without that evidence.
  if (
    !band &&
    (pet.planStatus === 'maintenance' ||
      pet.planStatus === 'verify_change')
  ) {
    return {
      ...base,
      status: 'needs_reassessment',
      reason: 'missing_assessment',
      requiresAssessment: true,
    };
  }

  if (targetIdealMismatch) {
    return {
      ...base,
      status: 'needs_reassessment',
      reason: 'target_ideal_mismatch',
      requiresAssessment: true,
    };
  }
  if (outsideBand) {
    return {
      ...base,
      status: 'needs_reassessment',
      reason: 'outside_healthy_band',
      requiresAssessment: true,
    };
  }
  if (deviationPct >= IMMEDIATE_REOPEN_PCT) {
    return {
      ...base,
      status: 'needs_reassessment',
      reason: 'large_change',
      requiresAssessment: true,
    };
  }
  if (deviationPct > MAINTENANCE_TOLERANCE_PCT) {
    if (hasTwoOutsideReadings(measurements, ideal)) {
      return {
        ...base,
        status: 'needs_reassessment',
        reason: 'confirmed_change',
        requiresAssessment: true,
      };
    }
    return {
      ...base,
      status: 'verify_change',
      reason: 'verify_change',
      requiresAssessment: false,
    };
  }

  if (pet.planStatus === 'verify_change') {
    return {
      ...base,
      status: 'maintenance',
      reason: 'measurement_returned',
      requiresAssessment: false,
    };
  }

  if (!pet.planStatus) {
    return {
      ...base,
      status:
        deviationPct <= MAINTENANCE_TOLERANCE_PCT
          ? 'maintenance'
          : 'active',
      reason:
        deviationPct <= MAINTENANCE_TOLERANCE_PCT
          ? 'legacy_maintenance'
          : 'legacy_active',
      requiresAssessment: false,
    };
  }

  return {
    ...base,
    status: 'maintenance',
    reason: 'within_maintenance',
    requiresAssessment: false,
  };
}

export function buildWeightPlanViewModel(
  pet: WeightPlanPet,
  measurements: WeightMeasurementEvidence[] = [],
  now = new Date(),
): WeightPlanViewModel {
  const evaluation = evaluateWeightPlan(pet, measurements, now);
  const start = validPositive(pet.journeyStartWeightKg)
    ? pet.journeyStartWeightKg
    : validPositive(pet.weightAssessmentKg)
      ? pet.weightAssessmentKg
    : pet.currentWeightKg;
  const ideal = evaluation.idealWeightKg;
  const progressPct =
    ideal &&
    Math.abs(start - ideal) > 0.05 &&
    evaluation.status !== 'maintenance'
      ? Math.round(
          Math.max(
            0,
            Math.min(
              1,
              (start - pet.currentWeightKg) / (start - ideal),
            ),
          ) * 100,
        )
      : evaluation.status === 'maintenance'
        ? 100
        : null;

  return {
    ...evaluation,
    currentWeightKg: pet.currentWeightKg,
    showHealthyBanner: evaluation.status === 'maintenance',
    showJourney: [
      'active',
      'verify_change',
      'needs_reassessment',
    ].includes(evaluation.status),
    showVerifyPrompt: evaluation.status === 'verify_change',
    showAssessmentPrompt:
      evaluation.status === 'needs_reassessment',
    progressPct,
  };
}

/** Build a new accepted assessment revision from an explicit BCS. */
export function createWeightAssessment(
  input: WeightAssessmentInput,
): WeightAssessmentRevision {
  const { pet, bcs, source } = input;
  const assessedAt = input.assessedAt ?? new Date().toISOString();
  const assessmentWeightKg = validPositive(input.assessmentWeightKg)
    ? input.assessmentWeightKg
    : pet.currentWeightKg;
  const estimate = estimateIdealWeight({
    species: pet.species,
    breed: pet.breed,
    sex: pet.gender,
    ageMonths: pet.ageMonths,
    currentWeightKg: assessmentWeightKg,
    bcs,
  });
  const previousIdeal = validPositive(pet.idealWeightKg)
    ? pet.idealWeightKg
    : null;
  const ideal =
    estimate.mode === 'ok' && validPositive(estimate.finalIdealKg)
      ? estimate.finalIdealKg
      : null;
  const target = ideal
    ? roundTargetKg(
        ideal < pet.currentWeightKg * 0.88
          ? pet.currentWeightKg * 0.88
          : ideal > pet.currentWeightKg * 1.12
            ? pet.currentWeightKg * 1.12
            : ideal,
      )
    : null;
  const status: WeightPlanStatus =
    estimate.mode === 'growth'
      ? 'growth'
      : pet.reproductiveStatus === 'pregnant' ||
          pet.reproductiveStatus === 'nursing'
        ? 'supervised'
        : ideal &&
            pctDistance(pet.currentWeightKg, ideal) <=
              MAINTENANCE_TOLERANCE_PCT
          ? 'maintenance'
          : ideal
            ? 'active'
            : 'needs_reassessment';
  const idealChangePct =
    previousIdeal && ideal ? pctDistance(ideal, previousIdeal) : null;

  return {
    revision: Math.max(0, pet.planRevision ?? 0) + 1,
    source,
    assessedAt,
    assessmentWeightKg,
    bcs,
    idealWeightKg: ideal,
    targetWeightKg: target,
    healthyBand: estimate.band ?? null,
    status,
    confidence: estimate.confidence ?? null,
    estimate,
    previousIdealWeightKg: previousIdeal,
    idealChangePct,
    discloseIdealChange:
      idealChangePct != null &&
      idealChangePct >= IDEAL_CHANGE_DISCLOSURE_PCT,
  };
}

/**
 * stepEstimate — how many steps the DOG took, estimated from the walk.
 *
 * ── What this is, honestly ──
 *
 * Pawtchi has no pedometer. The phone rides in the owner's pocket, so the only
 * thing measured is the owner's path. This module turns that distance into the
 * dog's step count, which is the number an owner of a dog actually cares about.
 *
 * It is a MODEL, not a measurement. Everything it returns is rounded coarsely,
 * and `formatSteps` / `formatStepsProse` exist so no screen can accidentally
 * print it like a sensor reading.
 *
 * ── The regression ──
 *
 *   stepLengthM = 0.33769340 + (0.0112636838 × shoulderHeightCm)
 *   steps       = distanceM / stepLengthM
 *
 * From "Correlation of activity data in normal dogs to distance traveled"
 * (Can Vet J, PMID 31920217): 20 dogs on a treadmill at 1.0 / 1.5 / 2.0 m/s,
 * 1 km per speed, wearing both an accelerometer and a pedometer. Two findings
 * shape this file — shoulder height predicted step-to-distance better than body
 * weight did, and pedometer output estimated distance more accurately than the
 * accelerometer's.
 *
 * ── Two things that were wrong in v1, both now fixed ──
 *
 * 1. v1 defined a step as one paw touching the ground, four per stride cycle.
 *    That inflated every number about fourfold and produced results no owner
 *    would accept — a French Bulldog walking 100m was reported as ~800 steps.
 *    A "step" here is now what a pedometer counts, which is what the word means
 *    to a person and what compares to the count on their own phone.
 *
 * 2. v1 stretched stride by walking pace using a coefficient this author
 *    invented. The study did find that speed matters, but it gives no
 *    coefficient general enough to apply to outdoor walking, and layering a
 *    homemade multiplier on top of a fitted regression is how a model drifts
 *    away from the data it claims to rest on. Pace is out; `movingTimeS` is no
 *    longer an input.
 *
 * ── Known limitation, stated rather than papered over ──
 *
 * The regression's intercept (0.338 m) dominates for short dogs, so it
 * compresses the small end: a Chihuahua lands only ~1.7× a Labrador where
 * biology suggests more. It is also a model of PEDOMETER OUTPUT and inherits
 * that device's known under-counting of small dogs, and the study population
 * was Beagles and Labradors. `extrapolated` flags any dog outside the heights
 * actually measured, so the weakness is at least visible in the data.
 */

import {
  getBreedAdultWeightKg,
  getBreedHeightCm,
  sizeCategoryFromWeight,
  type SizeCategory,
} from '../breedData';
import { deriveLifeStage } from '../lifeStage';

/** The published coefficients. Do not tune these — they are fitted values. */
export const STEP_LENGTH_INTERCEPT = 0.33769340;
export const STEP_LENGTH_PER_CM = 0.0112636838;

/** Shoulder heights actually represented in the study (cm). */
export const STUDY_HEIGHT_MIN_CM = 21;
export const STUDY_HEIGHT_MAX_CM = 53.5;

/** Which rung of the resolution chain produced the height. */
export type HeightSource =
  | 'breed_standard'
  | 'puppy_estimate'
  | 'weight_estimate'
  | 'size_class';

export type StepConfidence = 'high' | 'medium' | 'low';

/**
 * Height by weight, for a dog whose breed we do not know.
 *
 * An explicit product fallback, not a veterinary standard — which is exactly
 * why it lives here as a labelled table rather than as a regression dressed up
 * to look authoritative. Replace it if the breed table ever grows enough to fit
 * a real weight→height curve from our own records.
 */
const HEIGHT_BY_WEIGHT_CM: ReadonlyArray<{ maxKg: number; heightCm: number }> = [
  { maxKg: 5, heightCm: 23 },
  { maxKg: 10, heightCm: 30 },
  { maxKg: 15, heightCm: 36 },
  { maxKg: 20, heightCm: 42 },
  { maxKg: 30, heightCm: 50 },
  { maxKg: 40, heightCm: 57 },
  { maxKg: 50, heightCm: 63 },
  { maxKg: Infinity, heightCm: 68 },
];

/** Last resort: nothing known but the size band. */
const HEIGHT_BY_SIZE_CM: Record<SizeCategory, number> = {
  toy: 23,
  small: 30,
  medium: 42,
  large: 55,
  giant: 68,
};

export interface StepEstimateInput {
  /** Cleaned walk distance — the session machine has already rejected GPS
   *  junk and vehicle-speed segments. Never pass a raw trace: a 200m GPS jump
   *  must not become 200 more steps. */
  distanceM: number;
  species: 'dog' | 'cat' | null | undefined;
  breed?: string | null;
  sex?: 'male' | 'female' | null;
  ageYears?: number | null;
  ageMonths?: number | null;
  weightKg?: number | null;
}

export interface StepEstimate {
  /** Rounded for display. The only value a screen may show. */
  steps: number;
  /** Unrounded — for analytics and calibration, never for the UI. */
  rawSteps: number;
  estimatedHeightCm: number;
  /** The modelled step length, exposed for tests and any future receipt. */
  stepLengthM: number;
  source: HeightSource;
  confidence: StepConfidence;
  /** True when the dog is outside the heights the study measured. */
  extrapolated: boolean;
}

function heightFromWeight(weightKg: number): number {
  for (const band of HEIGHT_BY_WEIGHT_CM) {
    if (weightKg <= band.maxKg) return band.heightCm;
  }
  return HEIGHT_BY_SIZE_CM.medium;
}

/**
 * Round so the number reads as the estimate it is.
 *
 * Coarser as the count grows, because the absolute error grows with it — and
 * because "1,650" invites belief in a way "1,647" does not deserve.
 */
function coarsen(steps: number): number {
  if (steps < 1000) return Math.round(steps / 10) * 10;
  if (steps <= 5000) return Math.round(steps / 25) * 25;
  return Math.round(steps / 50) * 50;
}

interface ResolvedHeight {
  heightCm: number;
  source: HeightSource;
  confidence: StepConfidence;
}

/**
 * Work down from the best evidence available to the weakest.
 *
 * A measured shoulder height would sit above all of this, and the chain is
 * shaped to take one — Pawtchi simply never asks for it today.
 */
function resolveHeight(input: StepEstimateInput): ResolvedHeight {
  const species = input.species ?? 'dog';
  const sex = input.sex ?? null;
  const breedHeight = getBreedHeightCm(species, input.breed, sex);

  if (breedHeight !== null) {
    const stage = deriveLifeStage(
      species,
      input.ageYears ?? 4,
      input.ageMonths ?? 0,
      sizeCategoryFromWeight(species, input.weightKg ?? 10),
    );
    const stillGrowing = stage === 'puppy' || stage === 'junior';
    const adultWeight = getBreedAdultWeightKg(species, input.breed, sex);

    // Allometric growth: linear dimensions scale with the cube root of mass.
    // Without this a Labrador puppy is modelled with a fully grown dog's legs,
    // which undercounts its steps badly — the opposite of the truth, since a
    // puppy takes many more and much shorter steps.
    if (stillGrowing && input.weightKg && adultWeight && adultWeight > 0) {
      const growth = Math.min(1, Math.cbrt(input.weightKg / adultWeight));
      return {
        heightCm: breedHeight * growth,
        source: 'puppy_estimate',
        confidence: 'medium',
      };
    }

    return { heightCm: breedHeight, source: 'breed_standard', confidence: 'high' };
  }

  if (input.weightKg && input.weightKg > 0) {
    return {
      heightCm: heightFromWeight(input.weightKg),
      source: 'weight_estimate',
      confidence: 'low',
    };
  }

  const size = sizeCategoryFromWeight(species, input.weightKg ?? 10);
  return { heightCm: HEIGHT_BY_SIZE_CM[size], source: 'size_class', confidence: 'low' };
}

/**
 * Estimate the dog's step count for a completed walk.
 *
 * Returns 0 steps for a walk that covered no ground — never a fabricated floor.
 * A walk the validator rejected has no business showing a step count either;
 * that gate belongs to the caller.
 */
export function estimateDogSteps(input: StepEstimateInput): StepEstimate {
  const { heightCm, source, confidence } = resolveHeight(input);
  const stepLengthM = STEP_LENGTH_INTERCEPT + STEP_LENGTH_PER_CM * heightCm;

  const extrapolated = heightCm < STUDY_HEIGHT_MIN_CM || heightCm > STUDY_HEIGHT_MAX_CM;
  // A dog outside the measured range still gets an estimate — a Chihuahua and a
  // Great Dane both deserve a number — but it is one rung less trustworthy.
  const adjusted: StepConfidence =
    extrapolated && confidence === 'high'
      ? 'medium'
      : extrapolated && confidence === 'medium'
        ? 'low'
        : confidence;

  const base = {
    estimatedHeightCm: Math.round(heightCm * 10) / 10,
    stepLengthM: Math.round(stepLengthM * 1000) / 1000,
    source,
    confidence: adjusted,
    extrapolated,
  };

  if (input.distanceM <= 0 || stepLengthM <= 0) {
    return { steps: 0, rawSteps: 0, ...base };
  }

  const rawSteps = input.distanceM / stepLengthM;
  return { steps: coarsen(rawSteps), rawSteps, ...base };
}

/**
 * The only sanctioned way to print a step count in a stat strip.
 *
 * The tilde is not decoration. This number is modelled from the owner's GPS
 * trace and the dog's build; presenting it as "1,647" would claim a precision
 * that does not exist, and this app does not do that with health numbers.
 */
export function formatSteps(steps: number): string {
  return `~${steps.toLocaleString('en-US')}`;
}

/**
 * The same number in a sentence.
 *
 * A tilde reads fine wedged into a stat strip and badly inside prose, so the
 * hedge becomes a word. "around" rather than "about" because it sits more
 * lightly next to a large number.
 */
export function formatStepsProse(steps: number): string {
  return `around ${steps.toLocaleString('en-US')}`;
}

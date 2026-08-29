/**
 * stepEstimate — how many steps the DOG took, estimated from the walk.
 *
 * ── What this is, honestly ──
 *
 * Pawtchi has no pedometer. The phone rides in the owner's pocket, so the only
 * thing measured is the owner's path: distance and moving time. This module
 * turns that into the dog's step count, which is the number an owner of a dog
 * actually cares about — a Chihuahua does three or four times the work of a
 * Great Dane over the same kilometre, and that gap is the whole point.
 *
 * It is a MODEL, not a measurement. Expect roughly ±30%. Everything it returns
 * is rounded coarsely and every caller must present it as an approximation —
 * `formatSteps` exists so no screen accidentally prints it like a sensor
 * reading. A number like "6,013" claims precision this cannot support; "~6,000"
 * tells the truth about itself.
 *
 * ── Why breed size and not the owner's stride ──
 *
 * A tempting first version estimates the OWNER's steps and applies a breed
 * multiplier. That double-counts: the effect a breed has on a walk (a toy dog's
 * owner ambles, a Vizsla's owner strides) is already inside the measured GPS
 * pace. Layering breed on top of pace moves the answer away from truth.
 *
 * So the model goes the other way. Pace is the anchor — it tells us how hard
 * this dog was working — and the dog's own leg length converts distance into
 * strides. Both terms are read from `DogWalkProfile`, which the walk already
 * carries, so this needs no new data, no new permission and no new column.
 *
 * ── What counts as a step ──
 *
 * One paw touching the ground — the direct analogue of a human step being one
 * foot fall. A dog at a walk or a trot puts each of its four paws down once per
 * stride cycle, so steps = 4 × stride cycles. This is stated because it is the
 * one genuinely ambiguous choice here: counting stride cycles instead would
 * divide every number below by four, and the two are equally defensible right
 * up until two surfaces pick differently.
 */

import type { SizeCategory } from '../breedData';
import type { LifeStage } from '../lifeStage';
import type { DogWalkProfile } from './dogCalibration';

/** Paws on the ground per complete stride cycle. See the header. */
const PAWS_PER_STRIDE = 4;

/**
 * Typical height at the withers, in metres, by size band.
 *
 * Withers height is the practical proxy for leg length, and leg length is what
 * actually sets stride. These are mid-band figures for each of breedData's
 * weight classes (toy ≤4kg, small ≤10kg, medium ≤25kg, large ≤40kg, giant 40kg+).
 */
const WITHERS_HEIGHT_M: Record<SizeCategory, number> = {
  toy: 0.22,
  small: 0.33,
  medium: 0.48,
  large: 0.62,
  giant: 0.76,
};

/**
 * Stride length as a multiple of withers height, at a comfortable pace.
 *
 * Quadruped stride scales with leg length; for dogs at a walking/trotting gait
 * the ratio sits around 1.4–1.7. The midpoint is used because the pace term
 * below already moves the answer across that range.
 */
const STRIDE_PER_WITHERS = 1.55;

/**
 * How much stride stretches across a dog's OWN pace band.
 *
 * ±15% from the middle of the band. Deliberately modest: a dog speeding up
 * mostly takes faster steps, not dramatically longer ones, so most of the
 * change in step count with pace comes through distance and time, not here.
 */
const STRIDE_AT_SLOWEST = 0.85;
const STRIDE_PACE_SPAN = 0.30;

/**
 * Life-stage correction.
 *
 * Size category comes from the breed's ADULT size, so a Labrador puppy is
 * already classed 'large' while its legs are nowhere near it. Seniors shorten
 * their stride too. Without this, a puppy's step count is badly undercounted —
 * which is the opposite of true, since puppies take many more, smaller steps.
 */
const STRIDE_BY_LIFE_STAGE: Partial<Record<LifeStage, number>> = {
  puppy: 0.78,
  junior: 0.88,
  senior: 0.92,
  geriatric: 0.86,
};

export interface StepEstimateInput {
  distanceM: number;
  /** Time actually in motion. Sniff stops are excluded, which is correct: a dog
   *  standing nose-down in a hedge is not taking steps. */
  movingTimeS: number;
  profile: Pick<DogWalkProfile, 'sizeCategory' | 'lifeStage' | 'paceBandKmh'>;
}

export interface StepEstimate {
  /** Paw-falls. Rounded coarsely — see `formatSteps`. */
  steps: number;
  /** The modelled stride cycle in metres, exposed for tests and for any future
   *  "show the working" surface like kcalReceipt. */
  strideLengthM: number;
  /** Where the walk sat in this dog's own pace band, 0…1. */
  pacePosition: number;
}

/** Round so the number reads as the estimate it is. */
function coarsen(steps: number): number {
  if (steps < 100) return Math.round(steps / 10) * 10;
  if (steps < 1000) return Math.round(steps / 50) * 50;
  return Math.round(steps / 100) * 100;
}

/**
 * Estimate the dog's step count for a completed walk.
 *
 * Returns 0 for a walk with no distance — never a fabricated floor. A walk the
 * validator rejected has no business showing a step count either; that gate
 * belongs to the caller.
 */
export function estimateDogSteps({
  distanceM,
  movingTimeS,
  profile,
}: StepEstimateInput): StepEstimate {
  const baseStride =
    WITHERS_HEIGHT_M[profile.sizeCategory] * STRIDE_PER_WITHERS;

  // Where this walk sat in the dog's own band — the same normalisation
  // `intensityForPace` uses, so "brisk" means the same thing on both surfaces.
  const { min, max } = profile.paceBandKmh;
  const span = Math.max(0.1, max - min);
  const speedKmh = movingTimeS > 0 ? (distanceM / movingTimeS) * 3.6 : 0;
  const pacePosition = Math.min(1, Math.max(0, (speedKmh - min) / span));

  const paceFactor = STRIDE_AT_SLOWEST + STRIDE_PACE_SPAN * pacePosition;
  const stageFactor = STRIDE_BY_LIFE_STAGE[profile.lifeStage] ?? 1;

  const strideLengthM = baseStride * paceFactor * stageFactor;

  if (distanceM <= 0 || strideLengthM <= 0) {
    return { steps: 0, strideLengthM, pacePosition };
  }

  const strides = distanceM / strideLengthM;
  return {
    steps: coarsen(strides * PAWS_PER_STRIDE),
    strideLengthM: Math.round(strideLengthM * 1000) / 1000,
    pacePosition: Math.round(pacePosition * 100) / 100,
  };
}

/**
 * The only sanctioned way to print a step count.
 *
 * The tilde is not decoration. This number is modelled from the owner's GPS
 * trace and the dog's build; presenting it as "6,013" would claim a precision
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

/**
 * Species- and breed-aware weight bounds for input validation.
 *
 * A 0.1 kg or 100 kg typo in onboarding produces a nonsense kcal target in
 * either direction. RER(0.1) ≈ 12 kcal would starve a healthy dog; RER(100)
 * ≈ 2215 kcal applied to a Chihuahua would obesify it. We catch typos at the
 * input step before they propagate into the plan.
 *
 *  - hard bounds   : block save if outside; species-wide
 *  - soft bounds   : warn but allow; uses breed range × [0.5, 1.5] when known
 *
 * Breed ranges are pulled from `breedData.ts` via `getBreedWeightRange` so
 * there's a single source of truth. Do not maintain a local copy here.
 */

import { getBreedWeightRange } from './breedData';

export type Species = 'dog' | 'cat';

export interface WeightBounds {
  /** Hard min — values below this are blocked. */
  min: number;
  /** Hard max — values above this are blocked. */
  max: number;
  /** Soft bounds — values outside trigger a warning but are allowed. */
  soft: {
    low: number;
    high: number;
  };
}

const HARD_BOUNDS: Record<Species, { min: number; max: number }> = {
  dog: { min: 0.5, max: 100 },
  cat: { min: 0.3, max: 15 },
};

// Soft bounds default when no breed data is available — generous so we don't
// over-warn on legitimately small toy breeds or large giants.
const SPECIES_SOFT_BOUNDS: Record<Species, { low: number; high: number }> = {
  dog: { low: 1, high: 80 },
  cat: { low: 1, high: 10 },
};

/**
 * Returns the weight bounds for an input field, given species + optional breed.
 *
 * Bounds are always derived from the species-level hard bounds first, then
 * narrowed by breed range when available. Soft bounds never exceed the hard
 * bounds — clamped on the way out.
 */
export function getWeightBoundsKg(
  species: Species,
  breed?: string | null,
): WeightBounds {
  const hard = HARD_BOUNDS[species];
  const breedRange = getBreedWeightRange(species, breed);

  let softLow: number;
  let softHigh: number;
  if (breedRange) {
    softLow = breedRange.lower * 0.5;
    softHigh = breedRange.upper * 1.5;
  } else {
    const fallback = SPECIES_SOFT_BOUNDS[species];
    softLow = fallback.low;
    softHigh = fallback.high;
  }

  return {
    min: hard.min,
    max: hard.max,
    soft: {
      low: Math.max(hard.min, softLow),
      high: Math.min(hard.max, softHigh),
    },
  };
}

export type WeightValidationStatus = 'ok' | 'soft' | 'invalid';

export interface WeightValidationResult {
  status: WeightValidationStatus;
  message: string | null;
  bounds: WeightBounds;
}

/**
 * Validate a weight input against species/breed bounds.
 *
 *   ok       → within both hard and soft bounds; safe to commit.
 *   soft     → within hard bounds but outside the typical breed range; show
 *              a non-blocking warning so the user can confirm or correct.
 *   invalid  → outside hard bounds (or NaN/≤0); block the save.
 */
export function validateWeight(
  weightKg: number,
  species: Species,
  breed?: string | null,
): WeightValidationResult {
  const bounds = getWeightBoundsKg(species, breed);
  if (!Number.isFinite(weightKg) || weightKg <= 0) {
    return {
      status: 'invalid',
      message: `Please enter a weight between ${bounds.min} and ${bounds.max} kg.`,
      bounds,
    };
  }
  if (weightKg < bounds.min || weightKg > bounds.max) {
    return {
      status: 'invalid',
      message: `That weight looks outside the safe range for a ${species} (${bounds.min}–${bounds.max} kg). Please double-check.`,
      bounds,
    };
  }
  if (weightKg < bounds.soft.low || weightKg > bounds.soft.high) {
    const breedHint = breed ? ` for a ${breed}` : '';
    return {
      status: 'soft',
      message: `That's unusual${breedHint} — typical is ${bounds.soft.low.toFixed(1)}–${bounds.soft.high.toFixed(1)} kg. Continue if you're sure.`,
      bounds,
    };
  }
  return { status: 'ok', message: null, bounds };
}

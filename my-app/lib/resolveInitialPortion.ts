/**
 * resolveInitialPortion.ts
 *
 * "What portion should the screen open on?" — extracted from MealHero's mount
 * effect so it can be tested, and so both places that apply a learned portion
 * (the meal hero and the scan-result screen) share one answer.
 *
 * This exists because of a specific failure. MealHero used to compute the
 * opening portion inline as `learned * gramsPerUnit` and hand it straight to
 * `setGramsFed`, which bypassed the very bounds its own +/- stepper enforced.
 * A learned value of 200 therefore opened the card at 20,000 g. The stepper
 * could not have produced that number, but nothing stopped it being displayed
 * and logged.
 *
 * The rule this module enforces: a portion the stepper would refuse can never
 * become the opening portion.
 *
 * Pure — no React, no storage, no network.
 */

import { getPortionBounds, type PortionBounds, type PortionPresets } from './pantryMath';
import type { LearnedPortion, PortionMode } from './portionLearning';

export interface InitialPortion {
  /** Grams to open on. Always a positive integer inside the stepper's range. */
  gramsFed: number;
  /** True when this doesn't match any preset chip, so Custom should be shown. */
  isCustom: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Native quantity → grams.
 *
 * Weight mode's quantity is already grams (see LearnedPortion); count and
 * fraction both scale the unit weight.
 */
export function quantityToGrams(
  quantity: number,
  mode: PortionMode,
  gramsPerUnit: number,
): number {
  return mode === 'weight' ? quantity : quantity * gramsPerUnit;
}

/** Grams → native quantity. Inverse of `quantityToGrams`. */
export function gramsToQuantity(
  grams: number,
  mode: PortionMode,
  gramsPerUnit: number,
): number {
  if (mode === 'weight') return grams;
  return gramsPerUnit > 0 ? grams / gramsPerUnit : 0;
}

/**
 * Build a typed portion from the multiplier the log path still speaks in.
 *
 * The multiplier is `gramsFed / gramsPerUnit`, which means it already equals
 * the native quantity for count (pieces) and fraction (unit multiples); only
 * weight mode needs converting back to grams.
 */
export function multiplierToLearnedPortion(
  multiplier: number,
  presets: PortionPresets,
): LearnedPortion {
  const { mode, gramsPerUnit } = presets;
  const grams = Math.round(multiplier * gramsPerUnit);
  return mode === 'weight'
    ? { mode, quantity: grams }
    : { mode, quantity: multiplier, gramsFed: grams };
}

/** A learned portion expressed as the multiplier the log path expects. */
export function learnedPortionToMultiplier(
  portion: LearnedPortion,
  presets: PortionPresets,
): number {
  const { gramsPerUnit } = presets;
  if (portion.mode === 'weight') {
    return gramsPerUnit > 0 ? portion.quantity / gramsPerUnit : 1;
  }
  return portion.quantity;
}

/** The gram range the stepper allows, for callers that need it directly. */
export function boundsInGrams(bounds: PortionBounds): { min: number; max: number } {
  return {
    min: Math.max(1, Math.round(quantityToGrams(bounds.min, bounds.mode, bounds.gramsPerUnit))),
    max: Math.max(1, Math.round(quantityToGrams(bounds.max, bounds.mode, bounds.gramsPerUnit))),
  };
}

/**
 * Resolve the portion a screen should open on.
 *
 * With no usable learned portion this is one serving (`gramsPerUnit`) — the
 * same default the previous inline logic produced via `learned ?? 1`.
 *
 * A learned portion is used only when its mode still matches the item's current
 * mode. A saved "3 pieces" is meaningless once the owner re-scans the food as
 * grams, and silently reinterpreting the number is how unit bugs happen.
 */
export function resolveInitialPortion(
  learned: LearnedPortion | null | undefined,
  presets: PortionPresets,
  /**
   * The portion the owner explicitly declared as their usual, from
   * `food_pantry.usual_portion`. It outranks the learned history: one is a
   * statement, the other is an inference from a handful of taps.
   */
  usual?: LearnedPortion | null,
): InitialPortion {
  const bounds = getPortionBounds(presets);
  const { gramsPerUnit, presets: chips } = presets;
  const gramBounds = boundsInGrams(bounds);

  // Precedence: what the owner said > what we noticed > one serving. Both
  // candidates are discarded unless their mode still matches the item's —
  // a saved "3 pieces" means nothing once the food is measured in grams.
  const candidate =
    usual && usual.mode === bounds.mode
      ? usual
      : learned && learned.mode === bounds.mode
      ? learned
      : null;

  const rawGrams = candidate
    ? quantityToGrams(
        clamp(candidate.quantity, bounds.min, bounds.max),
        bounds.mode,
        gramsPerUnit,
      )
    : gramsPerUnit;

  // Clamped twice on purpose: once in native units (which is what the stepper
  // reasons about) and once in grams (which is what gets displayed and logged).
  // A degenerate `gramsPerUnit` must not be able to escape through the gap.
  const gramsFed = Math.max(
    1,
    Math.round(clamp(rawGrams, gramBounds.min, gramBounds.max)),
  );

  const presetGrams = chips
    .filter((c) => c.label !== 'Custom')
    .map((c) => c.gramsFed);

  return {
    gramsFed,
    isCustom: !presetGrams.some((g) => Math.abs(g - gramsFed) < 1),
  };
}

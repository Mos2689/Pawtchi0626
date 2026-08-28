/**
 * featureRequirements — which profile fields each health feature actually needs.
 *
 * Dogs now enter Pawtchi after two onboarding screens, so a pet can be fully
 * walk-ready while its health profile is nearly empty. Something has to decide
 * whether Meal can compute a calorie target, and this is it.
 *
 * A per-feature map rather than one "profile is N% complete" threshold, because
 * a single number over-gates: a feature that only needs a weight has no
 * business being blocked by a missing photo. It also under-gates — 80% complete
 * says nothing about *which* 20% is missing, and Meal is useless without weight
 * no matter how high the score is.
 *
 * Deliberately reuses `FocusKey` and `MissingItem` from lib/profileCompleteness
 * so the gate emits items the existing ProfileCompletionCard can render and the
 * existing `/(tabs)/profile?focus=<key>` deep link can route to. There is one
 * vocabulary for "a thing missing from this pet's profile", not two.
 *
 * Pure and dependency-free, matching the lib/*.test.ts pattern.
 */

import type { FocusKey, MissingItem } from '../profileCompleteness';

/**
 * The health capabilities that can be gated.
 *
 * Named for what the owner is trying to do, not for the screen they are on —
 * several surfaces can require the same capability, and a screen may host more
 * than one.
 */
export type HealthFeature =
  | 'meal_logging'
  | 'calorie_target'
  | 'weight_plan'
  | 'health_insights'
  | 'activity_plan';

/**
 * Fields, keyed by what the calculation genuinely reads.
 *
 *  weight → calculateRER (lib/healthMath.ts) — returns 0 without it, which is
 *           the failure this whole module exists to prevent.
 *  age    → life stage, and the growth multipliers that ride on it.
 *  bcs    → the ideal-weight estimate the whole plan is built on.
 *
 * **`pantry` and `bowl_size` are deliberately NOT gates**, though the calorie
 * maths does eventually want them. Gating Meal on having a pantry item is a
 * deadlock: the Meal tab is *where food gets scanned in*, so requiring one to
 * open it means it can never be satisfied. Bowl size has the same shape — it is
 * set from the profile, not from behind the gate. Both are already prompted
 * inside the meal flow's own empty states, which is the right place: a prompt
 * you can act on beats a gate you cannot.
 *
 * `breed`, `gender` and `photo` are not required either: breed only refines a
 * metabolic modifier that defaults sanely, and the other two carry no
 * calculation. They still count toward the completeness score, which is a
 * nudge, not a gate.
 *
 * The rule this encodes: **gate only on fields the completion flow can
 * actually collect.** Anything else strands the owner in a loop.
 */
const REQUIREMENTS: Record<HealthFeature, FocusKey[]> = {
  calorie_target: ['age', 'bcs'],
  meal_logging: ['age', 'bcs'],
  weight_plan: ['age', 'bcs'],
  health_insights: ['age', 'bcs'],
  activity_plan: ['age'],
};

/**
 * Weight is required by every feature above but has no `FocusKey` of its own —
 * `profileCompleteness` never scored it, because before this change onboarding
 * could not finish without it. It is checked separately and reported under the
 * closest existing key so the deep link still lands somewhere useful.
 */
const WEIGHT_ITEM: MissingItem = {
  key: 'bcs',
  label: 'Add a current weight',
  impact: 'high',
  weight: 3,
  focus: 'bcs',
};

const LABELS: Record<FocusKey, string> = {
  photo: 'Add a photo',
  breed: 'Add the breed',
  age: 'Add the age',
  bcs: 'Set the body shape',
  gender: 'Add the sex',
  allergies: 'Confirm any food sensitivities',
  bowl_size: 'Set the bowl size',
  pantry: 'Add a food to the pantry',
};

export interface HealthProfilePet {
  current_weight_kg?: number | null;
  age_years?: number | null;
  body_condition_score?: number | null;
  is_neutered?: boolean | null;
  activity_level?: string | null;
  bowl_size?: string | null;
}

export interface FeatureCheckContext {
  pantryCount?: number;
}

export interface FeatureCheck {
  ready: boolean;
  missing: MissingItem[];
}

/** The fields a feature reads. Exported so tests can assert the map directly. */
export function requirementsFor(feature: HealthFeature): FocusKey[] {
  return REQUIREMENTS[feature];
}

function isPresent(
  key: FocusKey,
  pet: HealthProfilePet,
  ctx: Required<FeatureCheckContext>,
): boolean {
  switch (key) {
    case 'age':
      return typeof pet.age_years === 'number' && pet.age_years > 0;
    case 'bcs':
      return typeof pet.body_condition_score === 'number' && pet.body_condition_score > 0;
    case 'bowl_size':
      return !!(pet.bowl_size && pet.bowl_size.trim());
    case 'pantry':
      return ctx.pantryCount > 0;
    // Not gating fields — present by definition so a stray entry in the map
    // can never silently block a feature on something cosmetic.
    default:
      return true;
  }
}

/**
 * Can this feature run for this pet, and if not, what is missing?
 *
 * A null pet is treated as not ready with everything missing, so a caller that
 * renders before the pet store hydrates shows the gate rather than flashing a
 * zeroed-out health screen for a frame.
 */
export function checkFeature(
  feature: HealthFeature,
  pet: HealthProfilePet | null | undefined,
  ctx: FeatureCheckContext = {},
): FeatureCheck {
  const context = { pantryCount: ctx.pantryCount ?? 0 };
  const keys = REQUIREMENTS[feature];

  const missing: MissingItem[] = [];

  // Weight first: it is the field whose absence produces the most confidently
  // wrong number, so it should also be the first thing the owner is asked for.
  const hasWeight = typeof pet?.current_weight_kg === 'number' && pet.current_weight_kg > 0;
  if (!hasWeight) missing.push(WEIGHT_ITEM);

  if (pet) {
    for (const key of keys) {
      if (isPresent(key, pet, context)) continue;
      missing.push({
        key,
        label: LABELS[key],
        impact: 'high',
        weight: 2,
        focus: key,
      });
    }
  } else {
    for (const key of keys) {
      missing.push({ key, label: LABELS[key], impact: 'high', weight: 2, focus: key });
    }
  }

  return { ready: missing.length === 0, missing };
}

/**
 * True when the pet has never had a health profile filled in at all — the
 * lightweight, walk-only state.
 *
 * Distinct from "this feature is not ready": a pet part-way through completion
 * is neither lightweight nor ready, and the two states want different copy
 * ("Set up Milo's health profile" vs "One more thing for Milo").
 */
export function isLightweightProfile(pet: HealthProfilePet | null | undefined): boolean {
  if (!pet) return true;
  const hasWeight = typeof pet.current_weight_kg === 'number' && pet.current_weight_kg > 0;
  const hasBcs = typeof pet.body_condition_score === 'number' && pet.body_condition_score > 0;
  return !hasWeight && !hasBcs;
}

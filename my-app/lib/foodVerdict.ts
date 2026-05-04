/**
 * Verdict layer — combines extracted food data + pet profile + AAFCO references
 * + confirmed clinical adjustments into a transparent nutrient comparison.
 *
 * Pure function. No I/O, no LLM calls.
 *
 * The output is what the Scan Details screen renders: per-nutrient values
 * (as-fed %, DMB %, g/1000 kcal), the AAFCO baseline range, the adjusted
 * target if any clinical adjustment applied, and a status flag.
 */

import {
  toDryMatterBasis,
  kcalPer100gDryMatter,
  gramsPer1000kcal,
  caPhosphorusRatio,
  defaultMoisturePct,
  estimateKcalPer100g,
} from './aafcoMath';
import { calculateDailyKcal, type Species, type ActivityLevel } from './healthMath';
import aafcoDog from '../data/aafco_dog_2014.json';
import aafcoCat from '../data/aafco_cat_2014.json';
import clinicalAdjustments from '../data/clinical_adjustments.json';

export type LifeStageProfile = 'adult_maintenance' | 'growth_and_reproduction';

export type NutrientStatus =
  | 'meets_baseline'
  | 'meets_adjusted'
  | 'below_baseline'
  | 'above_baseline'
  | 'below_adjusted'
  | 'above_adjusted'
  | 'unknown';

export interface NutrientVerdict {
  nutrient: string;
  as_fed_pct: number | null;
  dry_matter_pct: number | null;
  g_per_1000kcal: number | null;
  aafco_baseline_min: number | null;
  aafco_baseline_max: number | null;
  adjusted_target_min: number | null;
  adjusted_target_max: number | null;
  adjustment_rationale: string | null;
  status: NutrientStatus;
}

export interface FoodVerdictInput {
  food: {
    product_name?: string | null;
    food_type?: string | null;
    kcal_per_100g_as_fed?: number | null;
    moisture_pct?: number | null; // null = label did not state
    protein_pct?: number | null;
    fat_pct?: number | null;
    fiber_pct?: number | null;
    calcium_pct?: number | null;
    phosphorus_pct?: number | null;
  };
  pet: {
    name?: string;
    species: Species;
    weight_kg: number;
    target_weight_kg?: number | null;
    age_months?: number | null;
    activity_level: ActivityLevel;
    is_neutered: boolean;
    goal: 'lose' | 'maintain' | 'gain';
    /** Confirmed clinical conditions — only conditions with user_confirmed=true should be passed in. */
    confirmed_condition_keys?: string[];
  };
  meal_grams: number;
}

export interface FoodAnalysis {
  product: string;
  pet_name: string;
  species: Species;
  life_stage_evaluated: LifeStageProfile;
  meal_grams: number;
  meal_kcal: number | null;
  daily_kcal_target: number;
  meal_pct_of_daily: number | null;
  kcal_per_100g_as_fed: number | null;
  kcal_per_100g_dry_matter: number | null;
  moisture_pct_used: number;
  moisture_was_estimated: boolean;
  nutrients: NutrientVerdict[];
  ca_phosphorus_ratio: number | null;
  ca_phosphorus_ratio_status: 'in_range' | 'out_of_range' | 'unknown';
  active_clinical_adjustments: string[];
  summary: {
    nutrients_checked: number;
    nutrients_meeting: number;
    nutrients_below: number;
    nutrients_above: number;
    nutrients_unknown: number;
  };
  notes: string[];
}

type AAFCOProfile = {
  [nutrient: string]: {
    min_g_per_1000kcal?: number | null;
    max_g_per_1000kcal?: number | null;
    min?: number;
    max?: number;
    unit?: string;
    note?: string;
  };
};

type ClinicalAdjustmentEntry = {
  label: string;
  auto_apply_when_goal_is_weight_loss?: boolean;
  nutrient_adjustments?: {
    [nutrient: string]: {
      target_min_g_per_1000kcal?: number;
      target_max_g_per_1000kcal?: number;
      rationale?: string;
    };
  };
};

/**
 * Pick which AAFCO profile applies for this pet.
 *
 * Conservative rule: anything under 12 months is growth & reproduction;
 * everyone else is adult maintenance. We're not modeling lactation/pregnancy
 * yet — that's a separate upgrade.
 */
export function pickLifeStageProfile(input: {
  age_months?: number | null;
}): LifeStageProfile {
  if (input.age_months != null && input.age_months < 12) {
    return 'growth_and_reproduction';
  }
  return 'adult_maintenance';
}

/**
 * Determine which clinical adjustments to apply.
 * - Includes any condition the caller marks as confirmed (`confirmed_condition_keys`).
 * - Auto-includes 'obesity' if goal === 'lose' and obesity isn't already in the list.
 * - Skips any deferred condition (anything in `_deferred_conditions`).
 */
export function resolveActiveAdjustments(input: {
  confirmed_condition_keys?: string[];
  goal: 'lose' | 'maintain' | 'gain';
}): string[] {
  const known = new Set(Object.keys(clinicalAdjustments.conditions || {}));
  const out = new Set<string>();

  for (const key of input.confirmed_condition_keys ?? []) {
    if (known.has(key)) out.add(key);
  }

  if (input.goal === 'lose' && known.has('obesity')) {
    out.add('obesity');
  }

  return Array.from(out);
}

function getProfile(species: Species, stage: LifeStageProfile): AAFCOProfile {
  const ref = (species === 'cat' ? aafcoCat : aafcoDog) as {
    profiles: Record<string, AAFCOProfile>;
  };
  return ref.profiles[stage] ?? {};
}

function applyAdjustments(
  baseline: AAFCOProfile,
  activeKeys: string[],
): {
  effective: Record<string, { min: number | null; max: number | null; rationale: string | null }>;
  notes: string[];
} {
  const effective: Record<
    string,
    { min: number | null; max: number | null; rationale: string | null }
  > = {};
  const notes: string[] = [];

  // Seed effective from baseline (only g/1000 kcal nutrients; ratio handled separately)
  for (const [nutrient, range] of Object.entries(baseline)) {
    if (nutrient === 'ca_p_ratio') continue;
    effective[nutrient] = {
      min: range.min_g_per_1000kcal ?? null,
      max: range.max_g_per_1000kcal ?? null,
      rationale: null,
    };
  }

  // Layer adjustments
  for (const key of activeKeys) {
    const adj = (clinicalAdjustments.conditions as Record<string, ClinicalAdjustmentEntry>)[key];
    if (!adj) continue;
    const adjustments = adj.nutrient_adjustments ?? {};
    for (const [nutrient, change] of Object.entries(adjustments)) {
      if (!effective[nutrient]) {
        effective[nutrient] = { min: null, max: null, rationale: null };
      }
      if (change.target_min_g_per_1000kcal != null) {
        // Tighten up: take the larger min
        const current = effective[nutrient].min;
        effective[nutrient].min =
          current == null ? change.target_min_g_per_1000kcal : Math.max(current, change.target_min_g_per_1000kcal);
      }
      if (change.target_max_g_per_1000kcal != null) {
        // Tighten down: take the smaller max
        const current = effective[nutrient].max;
        effective[nutrient].max =
          current == null ? change.target_max_g_per_1000kcal : Math.min(current, change.target_max_g_per_1000kcal);
      }
      if (change.rationale) {
        effective[nutrient].rationale = change.rationale;
        notes.push(`${humanLabel(nutrient)} target adjusted for ${adj.label}: ${change.rationale}`);
      }
    }
  }

  return { effective, notes };
}

function humanLabel(nutrient: string): string {
  return nutrient
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function statusFor(
  value: number,
  baselineMin: number | null,
  baselineMax: number | null,
  adjustedMin: number | null,
  adjustedMax: number | null,
  hasAdjustment: boolean,
): NutrientStatus {
  // If adjustments differ from baseline, evaluate against the adjusted range
  if (hasAdjustment) {
    if (adjustedMin != null && value < adjustedMin) return 'below_adjusted';
    if (adjustedMax != null && value > adjustedMax) return 'above_adjusted';
    return 'meets_adjusted';
  }
  if (baselineMin != null && value < baselineMin) return 'below_baseline';
  if (baselineMax != null && value > baselineMax) return 'above_baseline';
  return 'meets_baseline';
}

/**
 * Map a label nutrient field to the AAFCO key.
 * Keep this small and explicit; adding a nutrient is one line here.
 */
const NUTRIENT_KEYS = ['crude_protein', 'crude_fat', 'crude_fiber', 'calcium', 'phosphorus'] as const;
type NutrientKey = typeof NUTRIENT_KEYS[number];

function nutrientAsFedFromInput(input: FoodVerdictInput['food'], key: NutrientKey): number | null {
  switch (key) {
    case 'crude_protein':
      return input.protein_pct ?? null;
    case 'crude_fat':
      return input.fat_pct ?? null;
    case 'crude_fiber':
      return input.fiber_pct ?? null;
    case 'calcium':
      return input.calcium_pct ?? null;
    case 'phosphorus':
      return input.phosphorus_pct ?? null;
  }
}

/**
 * Main entry point: produce a transparent, sourced verdict for a meal.
 */
export function analyzeFood(input: FoodVerdictInput): FoodAnalysis {
  const { food, pet, meal_grams } = input;

  // 1. Daily kcal target (uses fixed weight-loss math from healthMath.ts)
  const daily_kcal_target = calculateDailyKcal(
    pet.weight_kg,
    pet.species,
    pet.is_neutered,
    pet.activity_level,
    pet.goal,
    pet.age_months ?? undefined,
    1.0,
    pet.target_weight_kg ?? undefined,
  );

  // 2. Pick AAFCO profile
  const stage = pickLifeStageProfile({ age_months: pet.age_months });
  const baseline = getProfile(pet.species, stage);

  // 3. Determine active clinical adjustments
  const active_clinical_adjustments = resolveActiveAdjustments({
    confirmed_condition_keys: pet.confirmed_condition_keys,
    goal: pet.goal,
  });

  const { effective, notes: adjustmentNotes } = applyAdjustments(baseline, active_clinical_adjustments);

  const notes: string[] = [...adjustmentNotes];

  // 4. Resolve moisture (estimate if missing, mark accordingly)
  let moisture_pct_used: number;
  let moisture_was_estimated = false;
  if (food.moisture_pct != null) {
    moisture_pct_used = food.moisture_pct;
  } else {
    moisture_pct_used = defaultMoisturePct(food.food_type ?? 'kibble');
    moisture_was_estimated = true;
    notes.push(
      `Moisture not stated on label — estimated ${moisture_pct_used}% based on food type "${food.food_type ?? 'kibble'}".`,
    );
  }

  // 5. Resolve kcal/100g (estimate if missing)
  let kcal_per_100g_as_fed = food.kcal_per_100g_as_fed ?? null;
  if (kcal_per_100g_as_fed == null) {
    const estimated = estimateKcalPer100g({
      proteinPct: food.protein_pct ?? null,
      fatPct: food.fat_pct ?? null,
      fiberPct: food.fiber_pct ?? null,
      moisturePct: moisture_pct_used,
    });
    if (estimated != null) {
      kcal_per_100g_as_fed = estimated;
      notes.push(
        'Calorie content not stated — estimated from macros using modified Atwater factors.',
      );
    }
  }

  const kcal_per_100g_dry_matter =
    kcal_per_100g_as_fed != null
      ? kcalPer100gDryMatter(kcal_per_100g_as_fed, moisture_pct_used)
      : null;

  // 6. Per-nutrient verdict
  const nutrientVerdicts: NutrientVerdict[] = [];

  for (const key of NUTRIENT_KEYS) {
    const asFed = nutrientAsFedFromInput(food, key);
    const baselineEntry = baseline[key];
    const baselineMin = baselineEntry?.min_g_per_1000kcal ?? null;
    const baselineMax = baselineEntry?.max_g_per_1000kcal ?? null;
    const adjusted = effective[key];
    const adjustedMin = adjusted?.min ?? null;
    const adjustedMax = adjusted?.max ?? null;
    const rationale = adjusted?.rationale ?? null;

    const hasAdjustment =
      rationale != null ||
      adjustedMin !== baselineMin ||
      adjustedMax !== baselineMax;

    if (asFed == null || kcal_per_100g_dry_matter == null) {
      nutrientVerdicts.push({
        nutrient: key,
        as_fed_pct: asFed,
        dry_matter_pct: null,
        g_per_1000kcal: null,
        aafco_baseline_min: baselineMin,
        aafco_baseline_max: baselineMax,
        adjusted_target_min: adjustedMin,
        adjusted_target_max: adjustedMax,
        adjustment_rationale: rationale,
        status: 'unknown',
      });
      if (asFed == null) {
        notes.push(`${humanLabel(key)} not stated on label — comparison unavailable.`);
      }
      continue;
    }

    const dmb = toDryMatterBasis(asFed, moisture_pct_used);
    const gPer1000 = gramsPer1000kcal(dmb, kcal_per_100g_dry_matter);

    const status = statusFor(gPer1000, baselineMin, baselineMax, adjustedMin, adjustedMax, hasAdjustment);

    nutrientVerdicts.push({
      nutrient: key,
      as_fed_pct: asFed,
      dry_matter_pct: round2(dmb),
      g_per_1000kcal: round2(gPer1000),
      aafco_baseline_min: baselineMin,
      aafco_baseline_max: baselineMax,
      adjusted_target_min: adjustedMin,
      adjusted_target_max: adjustedMax,
      adjustment_rationale: rationale,
      status,
    });
  }

  // 7. Ca:P ratio
  let ca_phosphorus_ratio: number | null = null;
  let ca_phosphorus_ratio_status: 'in_range' | 'out_of_range' | 'unknown' = 'unknown';
  if (food.calcium_pct != null && food.phosphorus_pct != null && food.phosphorus_pct > 0) {
    ca_phosphorus_ratio = caPhosphorusRatio(food.calcium_pct, food.phosphorus_pct);
    const range = baseline.ca_p_ratio;
    if (range && range.min != null && range.max != null) {
      ca_phosphorus_ratio_status =
        ca_phosphorus_ratio >= range.min && ca_phosphorus_ratio <= range.max
          ? 'in_range'
          : 'out_of_range';
    }
  }

  // 8. Meal kcal + % of daily
  const meal_kcal =
    kcal_per_100g_as_fed != null ? (meal_grams / 100) * kcal_per_100g_as_fed : null;
  const meal_pct_of_daily =
    meal_kcal != null && daily_kcal_target > 0
      ? (meal_kcal / daily_kcal_target) * 100
      : null;

  // 9. Summary tallies
  const summary = {
    nutrients_checked: nutrientVerdicts.length,
    nutrients_meeting: 0,
    nutrients_below: 0,
    nutrients_above: 0,
    nutrients_unknown: 0,
  };
  for (const v of nutrientVerdicts) {
    if (v.status === 'meets_baseline' || v.status === 'meets_adjusted') summary.nutrients_meeting++;
    else if (v.status === 'below_baseline' || v.status === 'below_adjusted') summary.nutrients_below++;
    else if (v.status === 'above_baseline' || v.status === 'above_adjusted') summary.nutrients_above++;
    else summary.nutrients_unknown++;
  }

  return {
    product: food.product_name ?? 'Unknown product',
    pet_name: pet.name ?? 'Unknown',
    species: pet.species,
    life_stage_evaluated: stage,
    meal_grams,
    meal_kcal: meal_kcal != null ? round2(meal_kcal) : null,
    daily_kcal_target,
    meal_pct_of_daily: meal_pct_of_daily != null ? round2(meal_pct_of_daily) : null,
    kcal_per_100g_as_fed: kcal_per_100g_as_fed != null ? round2(kcal_per_100g_as_fed) : null,
    kcal_per_100g_dry_matter: kcal_per_100g_dry_matter != null ? round2(kcal_per_100g_dry_matter) : null,
    moisture_pct_used,
    moisture_was_estimated,
    nutrients: nutrientVerdicts,
    ca_phosphorus_ratio: ca_phosphorus_ratio != null ? round2(ca_phosphorus_ratio) : null,
    ca_phosphorus_ratio_status,
    active_clinical_adjustments,
    summary,
    notes,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Single source for the food-verdict pipeline.
//
// Three places used to carry byte-similar copies of this logic (meal.tsx
// Quick Log, camera scan preview, and executeLog): derive the verdict
// category, assemble the pet/scan/macros/analysis/weight context payloads,
// call the gemini-verdict edge function, and fall back to the deterministic
// generateVerdict() when the network or LLM fails.
//
// Architecture (unchanged): compute ALL analysis BEFORE the LLM call, then
// pass the completed decision as context. The LLM narrates — it doesn't judge.

import { generateVerdict, type ScanResultVerdict } from './generateVerdict';
import type { FoodAnalysis } from './foodVerdict';
import { deriveGoal } from './healthMath';
import { mapMedicalConditionsToAdjustmentKeys } from './clinicalMapping';
import type { Pet } from '../store/useActivePetStore';

export type VerdictCategory = 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent';

/** Category rule shared by preview and stored verdicts. */
export function deriveVerdictCategory(
  isAllergyTrigger: boolean,
  isTreat: boolean,
  healthScore: number,
): VerdictCategory {
  if (isAllergyTrigger) return 'unsafe';
  if (isTreat) return healthScore >= 8 ? 'excellent' : healthScore >= 5 ? 'fair' : 'poor';
  return healthScore >= 7 ? 'good' : healthScore >= 4 ? 'fair' : 'poor';
}

/**
 * Best-effort meal weight for the verdict layer's g/1000 kcal calculations.
 * Per-nutrient verdicts are intrinsic to the food and don't depend on this.
 */
export function estimateMealGrams(
  proteinPct: number | null | undefined,
  proteinG: number,
  kcal: number,
): number {
  return proteinPct && proteinPct > 0 && proteinG > 0
    ? Math.round((proteinG / proteinPct) * 100)
    : Math.max(1, Math.round(kcal / 3.5));
}

export interface VerdictScanFields {
  food_name: string;
  food_type: string | null;
  is_treat: boolean;
  is_allergy_trigger: boolean;
  allergy_warnings: string[];
  ingredients_of_concern: string[];
  key_ingredients: string[] | null;
  calories_per_serving: number;
  recommendation: string;
  confidence: number;
}

export interface VerdictMacroFields {
  total_kcal: number;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  fibre_g: number;
  kcal_per_100g: number | null;
  moisture_pct: number | null;
  meal_grams: number;
}

export interface VerdictBundle {
  category: VerdictCategory;
  petContext: {
    name: string;
    species: 'dog' | 'cat';
    age_years: number | null;
    current_weight_kg: number;
    target_weight_kg: number | null;
    activity_level: 'sedentary' | 'normal' | 'active' | 'highly_active';
    goal: 'lose' | 'maintain' | 'gain';
    confirmed_condition_keys: string[];
    daily_kcal_target: number | null;
  };
  scanContext: {
    food_name: string;
    food_type: string | null;
    is_treat: boolean;
    is_allergy_trigger: boolean;
    allergy_warnings: string[];
    key_ingredients: string[] | null;
    calories_per_serving: number;
  };
  macrosContext: VerdictMacroFields;
  analysisContext: {
    health_score: number;
    health_score_reasons: string[];
    verdict_category: VerdictCategory;
    nutrient_statuses: { nutrient: string; status: string }[];
    active_clinical_adjustments: FoodAnalysis['active_clinical_adjustments'];
  };
  weightContext: {
    current_weight_kg: number;
    target_weight_kg: number | null;
    goal: 'lose' | 'maintain' | 'gain';
    weight_trend_direction: 'up' | 'down' | 'stable' | null;
    weight_gap_kg: number;
    calories_consumed_today: number;
    daily_kcal_target: number;
    calories_remaining: number;
    cal_percent: number;
    meal_pct_of_daily: number;
  };
  /** Full scan fields for the deterministic fallback path. */
  fallbackScan: VerdictScanFields & { health_score: number };
  foodAnalysis: FoodAnalysis;
}

export function buildVerdictBundle(args: {
  pet: Pet;
  scan: VerdictScanFields;
  macros: VerdictMacroFields;
  foodAnalysis: FoodAnalysis;
  healthScore: number;
  healthScoreReasons: string[];
  caloriesConsumedToday: number;
  weightTrendDirection: 'up' | 'down' | 'stable' | null;
}): VerdictBundle {
  const { pet, scan, macros, foodAnalysis } = args;

  const goal = deriveGoal(
    pet.current_weight_kg ?? 0,
    pet.target_weight_kg,
    pet.body_condition_score,
  );
  const confirmedConditionKeys = mapMedicalConditionsToAdjustmentKeys(pet.medical_conditions);
  const dailyTarget = pet.target_daily_calories ?? 0;
  const currentWeightKg = pet.current_weight_kg ?? 0;
  const targetWeightKg = pet.target_weight_kg ?? null;
  const weightGapKg = targetWeightKg ? Math.abs(currentWeightKg - targetWeightKg) : 0;

  const category = deriveVerdictCategory(
    scan.is_allergy_trigger,
    scan.is_treat,
    args.healthScore,
  );

  return {
    category,
    petContext: {
      name: pet.name,
      species: pet.species,
      age_years: pet.age_years ?? null,
      current_weight_kg: currentWeightKg,
      target_weight_kg: targetWeightKg,
      activity_level: pet.activity_level,
      goal,
      confirmed_condition_keys: confirmedConditionKeys,
      daily_kcal_target: dailyTarget,
    },
    scanContext: {
      food_name: scan.food_name,
      food_type: scan.food_type,
      is_treat: scan.is_treat,
      is_allergy_trigger: scan.is_allergy_trigger,
      allergy_warnings: scan.allergy_warnings,
      key_ingredients: scan.key_ingredients,
      calories_per_serving: scan.calories_per_serving,
    },
    macrosContext: macros,
    analysisContext: {
      health_score: args.healthScore,
      health_score_reasons: args.healthScoreReasons,
      verdict_category: category,
      nutrient_statuses: foodAnalysis.nutrients.map(n => ({
        nutrient: n.nutrient,
        status: n.status,
      })),
      active_clinical_adjustments: foodAnalysis.active_clinical_adjustments,
    },
    weightContext: {
      current_weight_kg: currentWeightKg,
      target_weight_kg: targetWeightKg,
      goal,
      weight_trend_direction: args.weightTrendDirection,
      weight_gap_kg: weightGapKg,
      calories_consumed_today: args.caloriesConsumedToday,
      daily_kcal_target: dailyTarget,
      calories_remaining: dailyTarget - args.caloriesConsumedToday,
      cal_percent: dailyTarget > 0 ? Math.round((args.caloriesConsumedToday / dailyTarget) * 100) : 0,
      meal_pct_of_daily: dailyTarget > 0 ? Math.round((macros.total_kcal / dailyTarget) * 100) : 0,
    },
    fallbackScan: { ...scan, health_score: args.healthScore },
    foodAnalysis,
  };
}

/** LLM narration only — resolves null on any failure. Never throws. */
export async function fetchVerdictLLM(bundle: VerdictBundle): Promise<string | null> {
  try {
    // Lazy import keeps this module loadable in the node-env jest suite —
    // lib/supabase.ts pulls in React Native polyfills at module scope.
    const { supabase } = await import('./supabase');
    const { data, error } = await supabase.functions.invoke('gemini-verdict', {
      body: {
        pet: bundle.petContext,
        scan: bundle.scanContext,
        macros: bundle.macrosContext,
        analysis: bundle.analysisContext,
        weight_context: bundle.weightContext,
      },
    });
    if (data?.success && data.verdict) return data.verdict as string;
    if (error) return null;
    return null;
  } catch {
    return null;
  }
}

/** Deterministic verdict — the network-free path. Null only if it throws. */
export function deterministicVerdict(bundle: VerdictBundle): ScanResultVerdict | null {
  try {
    return generateVerdict({
      scanResult: bundle.fallbackScan,
      foodAnalysis: bundle.foodAnalysis,
      pet: bundle.petContext,
      weight_context: {
        calories_consumed_today: bundle.weightContext.calories_consumed_today,
        calories_remaining: bundle.weightContext.calories_remaining,
        cal_percent: bundle.weightContext.cal_percent,
        weight_trend_direction: bundle.weightContext.weight_trend_direction,
        weight_gap_kg: bundle.weightContext.weight_gap_kg,
      },
    });
  } catch {
    return null;
  }
}

/**
 * The preview path: LLM first (category stays the pre-computed one), then the
 * deterministic fallback (its own category), then null — exactly the order the
 * inline copies used.
 */
export async function fetchVerdictWithFallback(
  bundle: VerdictBundle,
): Promise<ScanResultVerdict | null> {
  const llm = await fetchVerdictLLM(bundle);
  if (llm) return { verdict: llm, verdict_category: bundle.category };
  return deterministicVerdict(bundle);
}

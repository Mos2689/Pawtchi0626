/**
 * Quick smoke-test for generateVerdict.
 * Run: npx ts-node --esm lib/generateVerdict.test.ts
 * Or: node --import tsx lib/generateVerdict.test.ts
 */

import { generateVerdict } from './generateVerdict';
import type { FoodAnalysis } from './foodVerdict';

function makeFoodAnalysis(overrides: Partial<FoodAnalysis>): FoodAnalysis {
  return {
    product: 'Test Food',
    pet_name: 'Bruno',
    species: 'dog',
    life_stage_evaluated: 'adult_maintenance',
    meal_grams: 85,
    meal_kcal: 92,
    daily_kcal_target: 735,
    meal_pct_of_daily: 12.5,
    kcal_per_100g_as_fed: 108,
    kcal_per_100g_dry_matter: 540,
    moisture_pct_used: 80,
    moisture_was_estimated: false,
    nutrients: [
      { nutrient: 'crude_protein', as_fed_pct: 8, dry_matter_pct: 40, g_per_1000kcal: 74.07, aafco_baseline_min: 45, aafco_baseline_max: null, adjusted_target_min: null, adjusted_target_max: null, adjustment_rationale: null, status: 'meets_baseline' },
      { nutrient: 'crude_fat', as_fed_pct: 3, dry_matter_pct: 15, g_per_1000kcal: 27.78, aafco_baseline_min: 13.8, aafco_baseline_max: null, adjusted_target_min: null, adjusted_target_max: null, adjustment_rationale: null, status: 'meets_baseline' },
      { nutrient: 'crude_fiber', as_fed_pct: 1, dry_matter_pct: 5, g_per_1000kcal: 9.26, aafco_baseline_min: null, aafco_baseline_max: null, adjusted_target_min: null, adjusted_target_max: null, adjustment_rationale: null, status: 'unknown' },
      { nutrient: 'calcium', as_fed_pct: null, dry_matter_pct: null, g_per_1000kcal: null, aafco_baseline_min: 1.25, aafco_baseline_max: 6.25, adjusted_target_min: null, adjusted_target_max: null, adjustment_rationale: null, status: 'unknown' },
      { nutrient: 'phosphorus', as_fed_pct: null, dry_matter_pct: null, g_per_1000kcal: null, aafco_baseline_min: 1, aafco_baseline_max: 4, adjusted_target_min: null, adjusted_target_max: null, adjustment_rationale: null, status: 'unknown' },
    ],
    ca_phosphorus_ratio: null,
    ca_phosphorus_ratio_status: 'unknown',
    active_clinical_adjustments: [],
    summary: { nutrients_checked: 5, nutrients_meeting: 2, nutrients_below: 0, nutrients_above: 0, nutrients_unknown: 3 },
    notes: [],
    ...overrides,
  };
}

function makeCtx(overrides: {
  is_treat?: boolean;
  health_score?: number;
  is_allergy_trigger?: boolean;
  goal?: 'lose' | 'maintain' | 'gain';
  confirmed_condition_keys?: string[];
  active_clinical_adjustments?: string[];
  age_years?: number | null;
  current_weight_kg?: number;
  target_weight_kg?: number | null;
  activity_level?: 'sedentary' | 'normal' | 'active' | 'highly_active';
  daily_kcal_target?: number | null;
}) {
  const {
    is_treat = false,
    health_score = 8,
    is_allergy_trigger = false,
    goal = 'maintain',
    confirmed_condition_keys = [],
    active_clinical_adjustments = [],
    age_years = 3,
    current_weight_kg = 28,
    target_weight_kg = null,
    activity_level = 'normal',
    daily_kcal_target = 735,
  } = overrides;

  const fa = makeFoodAnalysis({
    active_clinical_adjustments: active_clinical_adjustments,
  });

  return {
    scanResult: {
      food_name: 'BlackHawk Adult Chicken & Vegetable',
      food_type: 'wet_food',
      is_treat,
      is_allergy_trigger,
      allergy_warnings: is_allergy_trigger ? ['Chicken'] : [],
      ingredients_of_concern: [],
      calories_per_serving: 92,
      health_score,
      recommendation: 'Test',
      confidence: 1.0,
    },
    foodAnalysis: fa,
    pet: {
      name: 'Bruno',
      species: 'dog' as const,
      goal,
      activity_level,
      confirmed_condition_keys,
      age_years,
      current_weight_kg,
      target_weight_kg,
      daily_kcal_target,
    },
  };
}

const tests = [
  {
    label: 'Allergen trigger (treat)',
    ctx: makeCtx({ is_allergy_trigger: true, is_treat: true }),
    expectCategory: 'unsafe',
  },
  {
    label: 'Allergen trigger (meal)',
    ctx: makeCtx({ is_allergy_trigger: true, is_treat: false }),
    expectCategory: 'unsafe',
  },
  {
    label: 'Good treat (score 8)',
    ctx: makeCtx({ is_treat: true, health_score: 8 }),
    expectCategory: 'excellent',
  },
  {
    label: 'Fair treat (score 5)',
    ctx: makeCtx({ is_treat: true, health_score: 5 }),
    expectCategory: 'fair',
  },
  {
    label: 'Poor treat (score 3)',
    ctx: makeCtx({ is_treat: true, health_score: 3 }),
    expectCategory: 'poor',
  },
  {
    label: 'Excellent meal (score 9)',
    ctx: makeCtx({ is_treat: false, health_score: 9 }),
    expectCategory: 'excellent',
  },
  {
    label: 'Good meal with obesity adjustment',
    ctx: makeCtx({ is_treat: false, health_score: 8, goal: 'lose', confirmed_condition_keys: ['obesity'], active_clinical_adjustments: ['obesity'] }),
    expectCategory: 'good',
  },
  {
    label: 'Fair meal, high fat, weight loss',
    ctx: makeCtx({
      is_treat: false,
      health_score: 5,
      goal: 'lose',
      active_clinical_adjustments: ['obesity'],
    }),
    expectCategory: 'fair',
  },
  {
    label: 'Poor meal, low protein',
    ctx: makeCtx({
      is_treat: false,
      health_score: 2,
      confirmed_condition_keys: ['obesity'],
      active_clinical_adjustments: ['obesity'],
    }),
    expectCategory: 'poor',
  },
  {
    label: 'Senior dog, excellent score',
    ctx: makeCtx({ is_treat: false, health_score: 9, age_years: 10 }),
    expectCategory: 'excellent',
  },
  {
    label: 'Puppy, good score',
    ctx: makeCtx({ is_treat: false, health_score: 8, age_years: 0.8 }),
    expectCategory: 'good',
  },
  {
    label: 'Highly active dog, good score',
    ctx: makeCtx({ is_treat: false, health_score: 8, activity_level: 'highly_active' }),
    expectCategory: 'good',
  },
  {
    label: 'Sedentary cat, fair score',
    ctx: {
      ...makeCtx({ is_treat: false, health_score: 5 }),
      pet: { ...makeCtx({ is_treat: false, health_score: 5 }).pet, species: 'cat' as const, activity_level: 'sedentary' as const },
    },
    expectCategory: 'fair',
  },
  {
    label: 'Maintain goal, good meal',
    ctx: makeCtx({ is_treat: false, health_score: 8, goal: 'maintain' }),
    expectCategory: 'good',
  },
  {
    label: 'Gain goal, excellent meal',
    ctx: makeCtx({ is_treat: false, health_score: 9, goal: 'gain', target_weight_kg: 30, current_weight_kg: 27 }),
    expectCategory: 'excellent',
  },
];

describe('generateVerdict', () => {
  for (const { label, ctx, expectCategory } of tests) {
    test(label, () => {
      const result = generateVerdict(ctx);
      expect(result.verdict_category).toBe(expectCategory);
    });
  }
});

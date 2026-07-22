// Pinning tests for lib/verdictPipeline.ts — the extracted single source of
// the verdict flow that used to live inline (3 copies) in meal.tsx. These
// tests pin the extracted behavior to the original inline rules so the
// extraction can never silently drift.

import { analyzeFood, type FoodAnalysis } from './foodVerdict';
import { generateVerdict } from './generateVerdict';
import type { Pet } from '../store/useActivePetStore';
import {
  buildVerdictBundle,
  deriveVerdictCategory,
  deterministicVerdict,
  estimateMealGrams,
  type VerdictScanFields,
} from './verdictPipeline';

// ── Fixtures ────────────────────────────────────────────────────────────────

const pet: Pet = {
  id: 'pet-1',
  owner_id: 'owner-1',
  name: 'Bruno',
  species: 'dog',
  is_neutered: true,
  age_years: 4,
  current_weight_kg: 30,
  target_weight_kg: 27,
  activity_level: 'normal',
  target_daily_calories: 1200,
  body_condition_score: 7,
  allergies: ['chicken'],
  medical_conditions: [],
};

const scan: VerdictScanFields = {
  food_name: 'Test Kibble',
  food_type: 'kibble',
  is_treat: false,
  is_allergy_trigger: false,
  allergy_warnings: [],
  ingredients_of_concern: [],
  key_ingredients: ['beef', 'rice'],
  calories_per_serving: 350,
  recommendation: 'Fine as a main meal.',
  confidence: 0.9,
};

function makeFoodAnalysis(): FoodAnalysis {
  return analyzeFood({
    food: {
      product_name: scan.food_name,
      food_type: 'kibble',
      kcal_per_100g_as_fed: 350,
      moisture_pct: 10,
      protein_pct: 26,
      fat_pct: 14,
      fiber_pct: 3,
      calcium_pct: null,
      phosphorus_pct: null,
    },
    pet: {
      name: pet.name,
      species: pet.species,
      weight_kg: pet.current_weight_kg,
      target_weight_kg: pet.target_weight_kg ?? null,
      age_months: 48,
      activity_level: pet.activity_level,
      is_neutered: pet.is_neutered,
      goal: 'lose',
      confirmed_condition_keys: [],
      breed: null,
      age_years: pet.age_years ?? null,
      body_condition_score: pet.body_condition_score ?? null,
    },
    meal_grams: 100,
  });
}

function makeBundle(overrides?: { healthScore?: number; consumed?: number }) {
  return buildVerdictBundle({
    pet,
    scan,
    macros: {
      total_kcal: 350,
      protein_g: 26,
      fat_g: 14,
      carbs_g: 40,
      fibre_g: 0,
      kcal_per_100g: 350,
      moisture_pct: 10,
      meal_grams: 100,
    },
    foodAnalysis: makeFoodAnalysis(),
    healthScore: overrides?.healthScore ?? 7,
    healthScoreReasons: ['balanced macros'],
    caloriesConsumedToday: overrides?.consumed ?? 400,
    weightTrendDirection: 'down',
  });
}

// ── deriveVerdictCategory pins the original inline rule ────────────────────

describe('deriveVerdictCategory', () => {
  // Original inline rule (copied verbatim from the pre-extraction meal.tsx):
  function inlineRule(isAllergyTrigger: boolean, isTreat: boolean, score: number) {
    let cat: 'unsafe' | 'poor' | 'fair' | 'good' | 'excellent' = 'fair';
    if (isAllergyTrigger) cat = 'unsafe';
    else if (isTreat) cat = score >= 8 ? 'excellent' : score >= 5 ? 'fair' : 'poor';
    else cat = score >= 7 ? 'good' : score >= 4 ? 'fair' : 'poor';
    return cat;
  }

  it('matches the inline rule for every combination', () => {
    for (const allergy of [true, false]) {
      for (const treat of [true, false]) {
        for (let score = 0; score <= 10; score++) {
          expect(deriveVerdictCategory(allergy, treat, score)).toBe(
            inlineRule(allergy, treat, score),
          );
        }
      }
    }
  });
});

// ── estimateMealGrams pins the original inline estimate ────────────────────

describe('estimateMealGrams', () => {
  it('uses protein back-calculation when label protein is known', () => {
    // (26 g / 26 %) × 100 = 100 g
    expect(estimateMealGrams(26, 26, 350)).toBe(100);
  });

  it('falls back to kcal / 3.5 when protein is unknown', () => {
    expect(estimateMealGrams(null, 0, 350)).toBe(Math.round(350 / 3.5));
    expect(estimateMealGrams(0, 26, 350)).toBe(Math.round(350 / 3.5));
  });

  it('never returns less than 1 gram', () => {
    expect(estimateMealGrams(null, 0, 0)).toBe(1);
  });
});

// ── buildVerdictBundle pins the original context math ──────────────────────

describe('buildVerdictBundle', () => {
  it('builds the weight context exactly as the inline copies did', () => {
    const b = makeBundle({ consumed: 400 });
    expect(b.weightContext).toEqual({
      current_weight_kg: 30,
      target_weight_kg: 27,
      goal: 'lose', // 30 kg vs 27 kg target → lose
      weight_trend_direction: 'down',
      weight_gap_kg: 3,
      calories_consumed_today: 400,
      daily_kcal_target: 1200,
      calories_remaining: 800,
      cal_percent: Math.round((400 / 1200) * 100),
      meal_pct_of_daily: Math.round((350 / 1200) * 100),
    });
  });

  it('builds the pet context from the pet row', () => {
    const b = makeBundle();
    expect(b.petContext).toEqual({
      name: 'Bruno',
      species: 'dog',
      age_years: 4,
      current_weight_kg: 30,
      target_weight_kg: 27,
      activity_level: 'normal',
      goal: 'lose',
      confirmed_condition_keys: [],
      daily_kcal_target: 1200,
    });
  });

  it('mirrors the food analysis into the analysis context', () => {
    const b = makeBundle({ healthScore: 7 });
    expect(b.analysisContext.health_score).toBe(7);
    expect(b.analysisContext.verdict_category).toBe('good');
    expect(b.analysisContext.health_score_reasons).toEqual(['balanced macros']);
    expect(b.analysisContext.nutrient_statuses.length).toBe(b.foodAnalysis.nutrients.length);
    for (let i = 0; i < b.foodAnalysis.nutrients.length; i++) {
      expect(b.analysisContext.nutrient_statuses[i]).toEqual({
        nutrient: b.foodAnalysis.nutrients[i].nutrient,
        status: b.foodAnalysis.nutrients[i].status,
      });
    }
  });

  it('zeroes the weight gap when no target weight is set', () => {
    const b = buildVerdictBundle({
      pet: { ...pet, target_weight_kg: undefined },
      scan,
      macros: {
        total_kcal: 350, protein_g: 26, fat_g: 14, carbs_g: 40, fibre_g: 0,
        kcal_per_100g: 350, moisture_pct: 10, meal_grams: 100,
      },
      foodAnalysis: makeFoodAnalysis(),
      healthScore: 7,
      healthScoreReasons: [],
      caloriesConsumedToday: 0,
      weightTrendDirection: null,
    });
    expect(b.weightContext.weight_gap_kg).toBe(0);
    expect(b.weightContext.target_weight_kg).toBeNull();
  });
});

// ── deterministicVerdict parity with a direct generateVerdict call ─────────

describe('deterministicVerdict', () => {
  it('produces exactly what generateVerdict produces for the same inputs', () => {
    const b = makeBundle();
    const viaPipeline = deterministicVerdict(b);
    const direct = generateVerdict({
      scanResult: { ...scan, health_score: 7 },
      foodAnalysis: b.foodAnalysis,
      pet: b.petContext,
      weight_context: {
        calories_consumed_today: b.weightContext.calories_consumed_today,
        calories_remaining: b.weightContext.calories_remaining,
        cal_percent: b.weightContext.cal_percent,
        weight_trend_direction: b.weightContext.weight_trend_direction,
        weight_gap_kg: b.weightContext.weight_gap_kg,
      },
    });
    expect(viaPipeline).toEqual(direct);
    expect(viaPipeline?.verdict.length).toBeGreaterThan(0);
  });

  it('flags allergy triggers as unsafe', () => {
    const b = buildVerdictBundle({
      pet,
      scan: { ...scan, is_allergy_trigger: true, allergy_warnings: ['Contains Chicken'] },
      macros: {
        total_kcal: 350, protein_g: 26, fat_g: 14, carbs_g: 40, fibre_g: 0,
        kcal_per_100g: 350, moisture_pct: 10, meal_grams: 100,
      },
      foodAnalysis: makeFoodAnalysis(),
      healthScore: 7,
      healthScoreReasons: [],
      caloriesConsumedToday: 0,
      weightTrendDirection: null,
    });
    expect(b.category).toBe('unsafe');
    const v = deterministicVerdict(b);
    expect(v?.verdict_category).toBe('unsafe');
  });
});

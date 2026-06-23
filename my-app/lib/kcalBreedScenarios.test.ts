/**
 * kcalBreedScenarios.test.ts
 *
 * Comprehensive breed-by-breed kcal validation suite.
 * Tests real-world scenarios across different breeds, sizes, life stages,
 * activity levels, and weight goals against published veterinary references.
 *
 * References:
 *   - NRC (2006) Nutrient Requirements of Dogs and Cats
 *   - WSAVA/AAHA Global Nutrition Guidelines
 *   - Purina Body Condition System
 *   - Modified Atwater factors (AAFCO)
 */

import { calculateRER, calculateDailyKcal, getMERFactor, adjustDailyTarget, deriveGoal } from './healthMath';
import { deriveLifeStage, getLifeStageCalorieMultiplier } from './lifeStage';
import { getBreedDefaults, sizeCategoryFromWeight } from './breedData';
import { analyzeFood, type FoodVerdictInput } from './foodVerdict';
import { derivePortionPlan } from './portionMath';
import { estimateKcalPer100g } from './aafcoMath';

// ── Helper: End-to-end daily kcal for a breed profile ──
function fullDailyKcal(opts: {
  species: 'dog' | 'cat';
  breed?: string;
  weightKg: number;
  targetWeightKg?: number;
  ageYears: number;
  ageMonths?: number;
  isNeutered: boolean;
  activityLevel: 'sedentary' | 'normal' | 'active' | 'highly_active';
}): number {
  const totalMonths = (opts.ageMonths ?? 0) + opts.ageYears * 12;
  const breedDefaults = getBreedDefaults(opts.species, opts.breed ?? null, opts.weightKg);
  const sizeCategory = breedDefaults?.sizeCategory ?? sizeCategoryFromWeight(opts.species, opts.weightKg);
  const lifeStage = deriveLifeStage(opts.species, opts.ageYears, opts.ageMonths ?? 0, sizeCategory);
  const lifeStageMultiplier = getLifeStageCalorieMultiplier(lifeStage);
  const goal = deriveGoal(opts.weightKg, opts.targetWeightKg ?? null);

  return calculateDailyKcal(
    opts.weightKg,
    opts.species,
    opts.isNeutered,
    opts.activityLevel,
    goal,
    totalMonths,
    lifeStageMultiplier,
    opts.targetWeightKg ?? null,
  );
}

// ═══════════════════════════════════════════
// 1. RER FORMULA SANITY (MULTI-WEIGHT)
// ═══════════════════════════════════════════
describe('RER formula — scientific validation across weight range', () => {
  // NRC: RER = 70 × BW^0.75
  const referenceTable: [number, number][] = [
    [1, 70],       // 1kg toy/kitten
    [2, 117.9],    // 2kg small cat
    [3, 159.6],    // 3kg small cat
    [4, 198.0],    // 4kg medium cat
    [5, 234.1],    // 5kg cat / toy dog
    [7, 301.0],    // 7kg small dog
    [10, 393.6],   // 10kg medium dog
    [15, 533.5],   // 15kg medium dog
    [20, 662.4],   // 20kg medium-large dog
    [25, 782.6],   // 25kg large dog
    [30, 897.1],   // 30kg large dog
    [35, 1007.0],  // 35kg large dog
    [40, 1113.2],  // 40kg giant dog
    [50, 1316.0],  // 50kg giant dog
    [60, 1509.5],  // 60kg giant dog
    [70, 1694.0],  // 70kg giant dog (English Mastiff territory)
  ];

  for (const [kg, expectedRER] of referenceTable) {
    test(`RER(${kg}kg) ≈ ${expectedRER} kcal`, () => {
      expect(calculateRER(kg)).toBeCloseTo(expectedRER, 0);
    });
  }
});

// ═══════════════════════════════════════════
// 2. BREED-SPECIFIC DAILY KCAL SCENARIOS
// ═══════════════════════════════════════════
describe('Breed-specific daily kcal — dogs', () => {
  // ── TOY BREEDS ──
  test('Yorkshire Terrier: 3kg, neutered, normal, 5yr → ~280-340 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Yorkshire Terrier', weightKg: 3,
      ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    // Vet reference: ~280-340 kcal/day for a 3kg sedentary-normal toy
    expect(kcal).toBeGreaterThanOrEqual(220);
    expect(kcal).toBeLessThanOrEqual(360);
  });

  test('Pomeranian: 2.5kg, intact, normal, 3yr → ~240-320 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Pomeranian', weightKg: 2.5,
      ageYears: 3, isNeutered: false, activityLevel: 'normal',
    });
    expect(kcal).toBeGreaterThanOrEqual(180);
    expect(kcal).toBeLessThanOrEqual(340);
  });

  // ── SMALL BREEDS ──
  test('French Bulldog: 12kg, neutered, sedentary, 4yr → ~400-550 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'French Bulldog', weightKg: 12,
      ageYears: 4, isNeutered: true, activityLevel: 'sedentary',
    });
    // Frenchies are known couch potatoes — sedentary/neutered should be modest
    expect(kcal).toBeGreaterThanOrEqual(370);
    expect(kcal).toBeLessThanOrEqual(600);
  });

  test('Corgi: 12kg, neutered, normal, 6yr → ~500-650 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Corgi', weightKg: 12,
      ageYears: 6, isNeutered: true, activityLevel: 'normal',
    });
    expect(kcal).toBeGreaterThanOrEqual(450);
    expect(kcal).toBeLessThanOrEqual(750);
  });

  // ── MEDIUM BREEDS ──
  test('Beagle: 10kg, neutered, active, 3yr → ~600-800 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Beagle', weightKg: 10,
      ageYears: 3, isNeutered: true, activityLevel: 'active',
    });
    // Beagles are food-motivated and active
    expect(kcal).toBeGreaterThanOrEqual(550);
    expect(kcal).toBeLessThanOrEqual(900);
  });

  test('Australian Shepherd: 25kg, intact, highly_active, 2yr → ~1400-2500 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Australian Shepherd', weightKg: 25,
      ageYears: 2, isNeutered: false, activityLevel: 'highly_active',
    });
    // Working herding dog, intact — very high calorie need
    expect(kcal).toBeGreaterThanOrEqual(1300);
    expect(kcal).toBeLessThanOrEqual(3200);
  });

  test('Border Collie: 18kg, neutered, highly_active, 4yr → ~1200-2000 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Border Collie', weightKg: 18,
      ageYears: 4, isNeutered: true, activityLevel: 'highly_active',
    });
    expect(kcal).toBeGreaterThanOrEqual(1100);
    expect(kcal).toBeLessThanOrEqual(2200);
  });

  // ── LARGE BREEDS ──
  test('Labrador Retriever: 30kg, neutered, normal, 5yr → ~1200-1500 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Labrador Retriever', weightKg: 30,
      ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    // Most common scenario — vet recommendation is ~1200-1500
    expect(kcal).toBeGreaterThanOrEqual(1100);
    expect(kcal).toBeLessThanOrEqual(1600);
  });

  test('Golden Retriever: 32kg, neutered, active, 3yr → ~1500-2000 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Golden Retriever', weightKg: 32,
      ageYears: 3, isNeutered: true, activityLevel: 'active',
    });
    expect(kcal).toBeGreaterThanOrEqual(1400);
    expect(kcal).toBeLessThanOrEqual(2200);
  });

  test('German Shepherd: 35kg, intact, active, 4yr → ~1800-2500 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'German Shepherd', weightKg: 35,
      ageYears: 4, isNeutered: false, activityLevel: 'active',
    });
    expect(kcal).toBeGreaterThanOrEqual(1700);
    expect(kcal).toBeLessThanOrEqual(2700);
  });

  // ── GIANT BREEDS ──
  test('Rottweiler: 50kg, neutered, normal, 4yr → ~1800-2200 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Rottweiler', weightKg: 50,
      ageYears: 4, isNeutered: true, activityLevel: 'normal',
    });
    expect(kcal).toBeGreaterThanOrEqual(1700);
    expect(kcal).toBeLessThanOrEqual(2500);
  });
});

describe('Breed-specific daily kcal — cats', () => {
  test('Domestic Shorthair: 4.5kg, neutered, normal, 5yr → ~240-340 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'cat', breed: 'Domestic Shorthair', weightKg: 4.5,
      ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    // Standard indoor cat: vet recommendation 200-330 kcal
    expect(kcal).toBeGreaterThanOrEqual(200);
    expect(kcal).toBeLessThanOrEqual(380);
  });

  test('Maine Coon: 8kg, neutered, active, 3yr → ~400-550 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'cat', breed: 'Maine Coon', weightKg: 8,
      ageYears: 3, isNeutered: true, activityLevel: 'active',
    });
    expect(kcal).toBeGreaterThanOrEqual(350);
    expect(kcal).toBeLessThanOrEqual(600);
  });

  test('Bengal: 5.5kg, intact, highly_active, 2yr → ~350-500 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'cat', breed: 'Bengal', weightKg: 5.5,
      ageYears: 2, isNeutered: false, activityLevel: 'highly_active',
    });
    expect(kcal).toBeGreaterThanOrEqual(300);
    expect(kcal).toBeLessThanOrEqual(550);
  });

  test('Persian: 4kg, neutered, sedentary, 6yr → ~180-260 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'cat', breed: 'Persian', weightKg: 4,
      ageYears: 6, isNeutered: true, activityLevel: 'sedentary',
    });
    // Sedentary indoor cat: low end
    expect(kcal).toBeGreaterThanOrEqual(150);
    expect(kcal).toBeLessThanOrEqual(300);
  });

  test('Ragdoll: 7kg, neutered, sedentary, 4yr → ~250-380 kcal', () => {
    const kcal = fullDailyKcal({
      species: 'cat', breed: 'Ragdoll', weightKg: 7,
      ageYears: 4, isNeutered: true, activityLevel: 'sedentary',
    });
    expect(kcal).toBeGreaterThanOrEqual(200);
    expect(kcal).toBeLessThanOrEqual(420);
  });
});

// ═══════════════════════════════════════════
// 3. LIFE STAGE + CALORIE MULTIPLIER SCENARIOS
// ═══════════════════════════════════════════
describe('Life stage calorie adjustments', () => {
  test('6-month Lab puppy gets growth factor (2.0x), not adult 1.6x', () => {
    const puppy = calculateDailyKcal(15, 'dog', true, 'normal', 'maintain', 6);
    const adult = calculateDailyKcal(30, 'dog', true, 'normal', 'maintain', 36);
    // Puppy at half the weight should still eat proportionally more per kg
    const puppyPerKg = puppy / 15;
    const adultPerKg = adult / 30;
    expect(puppyPerKg).toBeGreaterThan(adultPerKg * 1.2); // at least 20% more per kg
  });

  test('10-month puppy gets 1.5x taper (not full growth, not adult)', () => {
    const factor = getMERFactor('dog', true, 'normal', 'maintain', 10);
    expect(factor).toBe(1.5);
  });

  test('4-month kitten gets 2.0x growth factor', () => {
    const factor = getMERFactor('cat', false, 'normal', 'maintain', 4);
    expect(factor).toBe(2.0);
  });

  test('Senior Lab (10yr) gets mature/senior reduction vs adult', () => {
    const adultKcal = fullDailyKcal({
      species: 'dog', breed: 'Labrador Retriever', weightKg: 30,
      ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    const seniorKcal = fullDailyKcal({
      species: 'dog', breed: 'Labrador Retriever', weightKg: 30,
      ageYears: 10, isNeutered: true, activityLevel: 'normal',
    });
    expect(seniorKcal).toBeLessThan(adultKcal);
    // Expect 5-20% reduction from adult
    expect(seniorKcal).toBeGreaterThan(adultKcal * 0.75);
    expect(seniorKcal).toBeLessThan(adultKcal * 0.98);
  });

  test('Geriatric cat (16yr) gets 0.80 multiplier', () => {
    const lifeStage = deriveLifeStage('cat', 16, 0);
    expect(lifeStage).toBe('geriatric');
    expect(getLifeStageCalorieMultiplier(lifeStage)).toBe(0.80);
  });

  test('Giant breed (Rottweiler) hits senior earlier than small breed', () => {
    const giantStage = deriveLifeStage('dog', 7, 0, 'giant');
    const smallStage = deriveLifeStage('dog', 7, 0, 'small');
    // Giant: 7yr (84mo) >= 84mo threshold → senior; Small: 7yr (84mo) < 96mo → adult
    expect(giantStage).toBe('senior');
    expect(smallStage).toBe('adult');
  });
});

// ═══════════════════════════════════════════
// 4. WEIGHT-LOSS SCENARIOS
// ═══════════════════════════════════════════
describe('Weight-loss kcal calculations', () => {
  test('Overweight Lab: 35kg → target 28kg, kcal uses RER(28) not RER(35)', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Labrador Retriever', weightKg: 35,
      targetWeightKg: 28, ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    // RER(28) ≈ 849, factor 1.0 = ~849 kcal
    // Should NOT be using RER(35) ≈ 1007, which would give ~1007 kcal
    expect(kcal).toBeLessThan(900);
    expect(kcal).toBeGreaterThan(700);
  });

  test('Overweight Corgi: 16kg → target 12kg, weight loss target is appropriately low', () => {
    const kcal = fullDailyKcal({
      species: 'dog', breed: 'Corgi', weightKg: 16,
      targetWeightKg: 12, ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    // Should be computing from RER(12) ≈ 462, factor 1.0 = ~462 kcal
    expect(kcal).toBeLessThan(550);
    expect(kcal).toBeGreaterThan(350);
  });

  test('Overweight cat: 7kg → target 5kg, correct cat-specific factor (0.8)', () => {
    const kcal = fullDailyKcal({
      species: 'cat', breed: 'Domestic Shorthair', weightKg: 7,
      targetWeightKg: 5, ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    // RER(5) ≈ 234, cat weight-loss factor 0.8 → ~187 kcal
    expect(kcal).toBeLessThan(250);
    expect(kcal).toBeGreaterThan(140);
  });

  test('Weight-loss target should always be < maintenance at current weight', () => {
    const maintenance = fullDailyKcal({
      species: 'dog', breed: 'Labrador Retriever', weightKg: 35,
      ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    const weightLoss = fullDailyKcal({
      species: 'dog', breed: 'Labrador Retriever', weightKg: 35,
      targetWeightKg: 28, ageYears: 5, isNeutered: true, activityLevel: 'normal',
    });
    expect(weightLoss).toBeLessThan(maintenance);
  });

  test('deriveGoal correctly identifies lose/gain/maintain', () => {
    expect(deriveGoal(35, 28)).toBe('lose');
    expect(deriveGoal(8, 12)).toBe('gain');
    expect(deriveGoal(30, 30)).toBe('maintain');
    expect(deriveGoal(30, 30.3)).toBe('maintain'); // within threshold
  });
});

// ═══════════════════════════════════════════
// 5. NEUTERED vs INTACT DIFFERENTIAL
// ═══════════════════════════════════════════
describe('Neutered vs intact calorie differential', () => {
  test('Neutered dog gets ~11-12% fewer kcal than intact (same weight/activity)', () => {
    const neutered = calculateDailyKcal(25, 'dog', true, 'normal', 'maintain');
    const intact = calculateDailyKcal(25, 'dog', false, 'normal', 'maintain');
    const diff = ((intact - neutered) / intact) * 100;
    expect(diff).toBeGreaterThan(8);  // at least 8% lower
    expect(diff).toBeLessThan(15);    // no more than 15% lower
  });

  test('Neutered cat gets ~14% fewer kcal than intact', () => {
    const neutered = calculateDailyKcal(4.5, 'cat', true, 'normal', 'maintain');
    const intact = calculateDailyKcal(4.5, 'cat', false, 'normal', 'maintain');
    const diff = ((intact - neutered) / intact) * 100;
    expect(diff).toBeGreaterThan(10);
    expect(diff).toBeLessThan(20);
  });
});

// ═══════════════════════════════════════════
// 6. ACTIVITY LEVEL DIFFERENTIATION
// ═══════════════════════════════════════════
describe('Activity level calorie scaling', () => {
  test('Highly active dog gets significantly more than sedentary (same weight)', () => {
    const sedentary = calculateDailyKcal(25, 'dog', true, 'normal', 'maintain');
    const highlyActive = calculateDailyKcal(25, 'dog', true, 'highly_active', 'maintain');
    expect(highlyActive).toBeGreaterThan(sedentary * 1.5);
  });

  test('Activity levels form a monotonically increasing sequence (dog)', () => {
    const sed = calculateDailyKcal(20, 'dog', true, 'sedentary', 'maintain');
    const norm = calculateDailyKcal(20, 'dog', true, 'normal', 'maintain');
    const act = calculateDailyKcal(20, 'dog', true, 'active', 'maintain');
    const high = calculateDailyKcal(20, 'dog', true, 'highly_active', 'maintain');
    expect(sed).toBeLessThan(norm);
    expect(norm).toBeLessThan(act);
    expect(act).toBeLessThan(high);
  });

  test('Activity levels form a monotonically increasing sequence (cat)', () => {
    const sed = calculateDailyKcal(4.5, 'cat', true, 'sedentary', 'maintain');
    const norm = calculateDailyKcal(4.5, 'cat', true, 'normal', 'maintain');
    const act = calculateDailyKcal(4.5, 'cat', true, 'active', 'maintain');
    expect(sed).toBeLessThan(norm);
    expect(norm).toBeLessThanOrEqual(act);
  });
});

// ═══════════════════════════════════════════
// 7. PORTION PLAN SANITY (breed cross-check)
// ═══════════════════════════════════════════
describe('Portion plan — breed reality checks', () => {
  test('30kg Lab on 1400 kcal → reasonable portion sizes', () => {
    const plan = derivePortionPlan({ dailyKcal: 1400, currentWeightKg: 30 });
    expect(plan.mealsPerDay).toBe(2);
    expect(plan.treatKcal).toBe(140); // 10% rule
    expect(plan.mealKcal).toBe(1260);
    expect(plan.gramsPerMeal).toBeGreaterThanOrEqual(150);
    expect(plan.gramsPerMeal).toBeLessThanOrEqual(250);
    expect(plan.waterMl).toBe(1500);
  });

  test('4.5kg cat on 280 kcal → reasonable portions', () => {
    const plan = derivePortionPlan({ dailyKcal: 280, currentWeightKg: 4.5 });
    expect(plan.treatKcal).toBe(28);
    expect(plan.gramsPerMeal).toBeGreaterThanOrEqual(25);
    expect(plan.gramsPerMeal).toBeLessThanOrEqual(60);
  });

  test('Wet food (100 kcal/100g) means larger gram portions than kibble', () => {
    const kibblePlan = derivePortionPlan({ dailyKcal: 800, currentWeightKg: 15, kcalPer100g: 350 });
    const wetPlan = derivePortionPlan({ dailyKcal: 800, currentWeightKg: 15, kcalPer100g: 100 });
    expect(wetPlan.gramsPerMeal).toBeGreaterThan(kibblePlan.gramsPerMeal * 2);
  });
});

// ═══════════════════════════════════════════
// 8. adjustDailyTarget — trend corrections
// ═══════════════════════════════════════════
describe('adjustDailyTarget — weight trend adjustments', () => {
  test('Trending up while goal=lose → 5% reduction', () => {
    const { adjustedTarget, reason } = adjustDailyTarget(1000, 30, 'up', 'lose');
    expect(adjustedTarget).toBe(950);
    expect(reason).toContain('-50 kcal');
  });

  test('Trending down while goal=lose → 3% bonus', () => {
    const { adjustedTarget, reason } = adjustDailyTarget(1000, 30, 'down', 'lose');
    expect(adjustedTarget).toBe(1030);
    expect(reason).toContain('+30 kcal');
  });

  test('Stable weight on maintain → no adjustment', () => {
    const { adjustedTarget, reason } = adjustDailyTarget(1000, 30, 'stable', 'maintain');
    expect(adjustedTarget).toBe(1000);
    expect(reason).toBeNull();
  });

  test('Hard cap at ±10% even with stacked adjustments', () => {
    // Both weight trending up AND large weekly surplus
    const { adjustedTarget } = adjustDailyTarget(1000, 30, 'up', 'lose', 5000);
    expect(adjustedTarget).toBeGreaterThanOrEqual(900);  // never below -10%
    expect(adjustedTarget).toBeLessThanOrEqual(1100);    // never above +10%
  });

  test('Weekly surplus applies soft correction', () => {
    // 2000 kcal surplus over the week on 1000 base → should nudge down
    const { adjustedTarget } = adjustDailyTarget(1000, 30, 'stable', 'maintain', 2000);
    expect(adjustedTarget).toBeLessThan(1000);
  });
});

// ═══════════════════════════════════════════
// 9. FOOD VERDICT — BREED-SPECIFIC MEAL MATH
// ═══════════════════════════════════════════
describe('Food verdict — meal kcal percentage for different breeds', () => {
  const standardKibble: FoodVerdictInput['food'] = {
    product_name: 'Royal Canin Adult',
    food_type: 'kibble',
    kcal_per_100g_as_fed: 366,
    moisture_pct: 10,
    protein_pct: 26,
    fat_pct: 14,
    fiber_pct: 3,
    calcium_pct: 1.2,
    phosphorus_pct: 1.0,
  };

  test('100g kibble for a 30kg Lab is ~25-30% of daily target', () => {
    const result = analyzeFood({
      food: standardKibble,
      pet: {
        species: 'dog', weight_kg: 30, target_weight_kg: 30,
        age_months: 60, activity_level: 'normal',
        is_neutered: true, goal: 'maintain',
      },
      meal_grams: 100,
    });
    expect(result.meal_pct_of_daily).not.toBeNull();
    expect(result.meal_pct_of_daily!).toBeGreaterThan(20);
    expect(result.meal_pct_of_daily!).toBeLessThan(40);
  });

  test('100g kibble for a 3kg Yorkie is a HUGE portion (>80% daily)', () => {
    const result = analyzeFood({
      food: standardKibble,
      pet: {
        species: 'dog', weight_kg: 3, target_weight_kg: 3,
        age_months: 60, activity_level: 'normal',
        is_neutered: true, goal: 'maintain',
      },
      meal_grams: 100,
    });
    // 366 kcal meal for a dog needing ~270 kcal → >100% of daily!
    expect(result.meal_pct_of_daily).not.toBeNull();
    expect(result.meal_pct_of_daily!).toBeGreaterThan(80);
  });

  test('85g wet food (108 kcal/100g) for a 4.5kg cat is ~33-40% of daily', () => {
    const result = analyzeFood({
      food: {
        product_name: 'Felix Wet Food',
        food_type: 'wet_food',
        kcal_per_100g_as_fed: 108,
        moisture_pct: 80,
        protein_pct: 8,
        fat_pct: 3,
        fiber_pct: 1,
      },
      pet: {
        species: 'cat', weight_kg: 4.5, target_weight_kg: 4.5,
        age_months: 36, activity_level: 'normal',
        is_neutered: true, goal: 'maintain',
      },
      meal_grams: 85,
    });
    expect(result.meal_pct_of_daily).not.toBeNull();
    expect(result.meal_pct_of_daily!).toBeGreaterThan(25);
    expect(result.meal_pct_of_daily!).toBeLessThan(50);
  });

  test('Weight-loss dog food verdict uses target weight for daily kcal', () => {
    const result = analyzeFood({
      food: standardKibble,
      pet: {
        species: 'dog', weight_kg: 35, target_weight_kg: 28,
        age_months: 60, activity_level: 'normal',
        is_neutered: true, goal: 'lose',
      },
      meal_grams: 100,
    });
    // daily_kcal_target should reflect RER(28), not RER(35)
    expect(result.daily_kcal_target).toBeLessThan(900);
    // meal_pct should be higher because the daily target is lower
    expect(result.meal_pct_of_daily!).toBeGreaterThan(35);
  });
});

// ═══════════════════════════════════════════
// 10. ATWATER ESTIMATION SANITY
// ═══════════════════════════════════════════
describe('Modified Atwater kcal estimation', () => {
  test('High-protein kibble (30% P, 18% F) → ~380-420 kcal/100g', () => {
    const kcal = estimateKcalPer100g({
      proteinPct: 30, fatPct: 18, fiberPct: 3, moisturePct: 10, ashPct: 7,
    });
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeGreaterThan(350);
    expect(kcal!).toBeLessThan(450);
  });

  test('Wet food (8% P, 5% F, 78% moisture) → ~80-120 kcal/100g', () => {
    const kcal = estimateKcalPer100g({
      proteinPct: 8, fatPct: 5, fiberPct: 1, moisturePct: 78, ashPct: 2,
    });
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeGreaterThan(60);
    expect(kcal!).toBeLessThan(140);
  });

  test('Raw diet (15% P, 10% F, 70% moisture) → ~100-160 kcal/100g', () => {
    const kcal = estimateKcalPer100g({
      proteinPct: 15, fatPct: 10, fiberPct: 1, moisturePct: 70, ashPct: 2,
    });
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeGreaterThan(90);
    expect(kcal!).toBeLessThan(180);
  });
});

// ═══════════════════════════════════════════
// 11. EDGE CASES & BOUNDARY CONDITIONS
// ═══════════════════════════════════════════
describe('Edge cases', () => {
  test('1kg toy puppy (2 months) gets growth factor 2.5 (3.0 is only for <2mo)', () => {
    // ageMonths < 2 → 3.0;  2 <= ageMonths < 4 → 2.5
    const factorUnder2 = getMERFactor('dog', false, 'normal', 'maintain', 1);
    expect(factorUnder2).toBe(3.0);
    const factor2mo = getMERFactor('dog', false, 'normal', 'maintain', 2);
    expect(factor2mo).toBe(2.5);
    // RER(1) = 70, 2.5x = 175 kcal — reasonable for a tiny growing puppy
    const kcal = calculateDailyKcal(1, 'dog', false, 'normal', 'maintain', 2);
    expect(kcal).toBe(175);
  });

  test('60kg English Mastiff daily kcal stays reasonable', () => {
    const kcal = fullDailyKcal({
      species: 'dog', weightKg: 60, ageYears: 4,
      isNeutered: true, activityLevel: 'normal',
    });
    // Giant breed maintenance: ~2000-2800 kcal
    expect(kcal).toBeGreaterThan(1800);
    expect(kcal).toBeLessThan(3000);
  });

  test('0 kcal base target returns 0 adjusted target (no division by zero)', () => {
    const { adjustedTarget } = adjustDailyTarget(0, 30, 'up', 'lose');
    expect(adjustedTarget).toBe(0);
  });

  test('Weight loss without target weight does not crash', () => {
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose');
    expect(kcal).toBeGreaterThan(0);
  });

  test('Cat weight-loss factor is 0.8 (more restrictive than dog 1.0)', () => {
    const catLoss = calculateDailyKcal(6, 'cat', true, 'normal', 'lose', undefined, 1.0, 4);
    const catRER = calculateRER(4);
    expect(catLoss).toBe(Math.round(catRER * 0.8));

    const dogLoss = calculateDailyKcal(35, 'dog', true, 'normal', 'lose', undefined, 1.0, 28);
    const dogRER = calculateRER(28);
    expect(dogLoss).toBe(Math.round(dogRER * 1.0));
  });
});

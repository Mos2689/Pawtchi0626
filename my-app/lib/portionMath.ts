// Pure portion-plate helper for the reveal screen.
//
// Turns the calculated daily calorie target into concrete numbers an owner can
// act on tonight: grams per meal, treat-cap grams, and water target. All values
// are deterministic from data already on the device — no server calls.

const DEFAULT_KCAL_PER_100G = 350; // typical adult-maintenance dry kibble
const MEALS_PER_DAY = 2;
const TREAT_CAP_PERCENT_MAINTAIN = 0.10; // vets' "10% rule" — treats stay under 10% of daily calories
const TREAT_CAP_PERCENT_STRICT = 0.05;   // weight-loss mode: tighter buffer for owner under-estimation
const WATER_ML_PER_KG = 50; // matches the in-app target used elsewhere

export interface PortionInput {
  dailyKcal: number;
  currentWeightKg: number;
  /** Override when the owner is on wet or raw food. */
  kcalPer100g?: number;
  /** When 'lose', the treat cap tightens to 5% to protect the deficit. */
  goal?: 'lose' | 'maintain' | 'gain';
}

export interface PortionPlan {
  /** Calories left for meals after the treat cap. */
  mealKcal: number;
  /** Calories budgeted for treats. */
  treatKcal: number;
  mealsPerDay: number;
  /** Grams of food per meal, rounded to 5g. */
  gramsPerMeal: number;
  /** Grams of treats available for the day, rounded to 5g. */
  treatGrams: number;
  /** Daily water target in ml, rounded to 10ml. */
  waterMl: number;
  /** Treat cap as a 0-1 fraction: 0.10 for maintenance, 0.05 for weight-loss strict mode. */
  treatCapPercent: number;
}

function roundTo(value: number, step: number): number {
  if (!isFinite(value) || value <= 0) return 0;
  return Math.max(step, Math.round(value / step) * step);
}

export function derivePortionPlan({
  dailyKcal,
  currentWeightKg,
  kcalPer100g = DEFAULT_KCAL_PER_100G,
  goal,
}: PortionInput): PortionPlan {
  const safeKcal = Math.max(0, Math.round(dailyKcal || 0));
  const safeWeight = Math.max(0, currentWeightKg || 0);
  const safeDensity = kcalPer100g > 0 ? kcalPer100g : DEFAULT_KCAL_PER_100G;

  const treatCapPercent = goal === 'lose' ? TREAT_CAP_PERCENT_STRICT : TREAT_CAP_PERCENT_MAINTAIN;
  const treatKcal = Math.round(safeKcal * treatCapPercent);
  const mealKcal = Math.max(0, safeKcal - treatKcal);

  // grams = (kcal / kcal_per_100g) * 100 — applied per-meal and to the treat slice.
  const gramsPerMealRaw = (mealKcal / MEALS_PER_DAY) * (100 / safeDensity);
  const treatGramsRaw = treatKcal * (100 / safeDensity);

  return {
    mealKcal,
    treatKcal,
    mealsPerDay: MEALS_PER_DAY,
    gramsPerMeal: roundTo(gramsPerMealRaw, 5),
    treatGrams: roundTo(treatGramsRaw, 5),
    waterMl: roundTo(safeWeight * WATER_ML_PER_KG, 10),
    treatCapPercent,
  };
}

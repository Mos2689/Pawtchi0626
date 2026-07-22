/**
 * activityBurn — client-side activity calorie math.
 *
 * Mirrors the burn table in supabase/functions/generate-schedule/index.ts
 * (kcal/kg/hr per type × intensity — NRC / Pendlebury-derived estimates).
 * Keep both copies in sync if the rates change.
 *
 * Having this on-device lets the Activity screen derive "burn this week"
 * from the actual activity rows instead of caching the last generate-schedule
 * response in component state (which evaporated on app restart).
 *
 * Also owns computeDailyDeficitKcal — the honest deficit the burn card
 * compares against. The old edge-function version assumed a flat 20% deficit;
 * the real deficit is estimated maintenance (RER × maintenance MER factor)
 * minus the prescribed target_daily_calories, and is zero for maintain/gain
 * plans.
 */

import { calculateRER, getMERFactor, type ActivityLevel, type Species } from './healthMath';
import { deriveLifeStage, getAgeMonths, getLifeStageCalorieMultiplier } from './lifeStage';
import { getBreedDefaults, sizeCategoryFromWeight } from './breedData';

export const BURN_RATES: Record<string, Record<string, number>> = {
  walk:     { low: 1.5, moderate: 3.0, high: 5.0 },
  play:     { low: 2.0, moderate: 4.0, high: 6.0 },
  training: { low: 1.8, moderate: 3.5, high: 5.5 },
  grooming: { low: 0.3, moderate: 0.5, high: 0.8 },
  other:    { low: 1.0, moderate: 2.0, high: 3.0 },
  water:    { low: 0,   moderate: 0,   high: 0 },
  medicine: { low: 0,   moderate: 0,   high: 0 },
  feeding:  { low: 0,   moderate: 0,   high: 0 },
};

export function estimateActivityBurn(
  activityType: string,
  intensity: string | null | undefined,
  durationMinutes: number | null | undefined,
  weightKg: number,
): number {
  if (!durationMinutes || durationMinutes <= 0 || weightKg <= 0) return 0;
  const rates = BURN_RATES[activityType] || BURN_RATES['other'];
  const rate = rates[(intensity as keyof typeof rates) || 'moderate'] ?? rates.moderate;
  return Math.round(rate * weightKg * (durationMinutes / 60) * 10) / 10;
}

export interface ActivityBurnRow {
  activity_type: string;
  intensity?: string | null;
  duration_minutes?: number | null;
  /** Tracked walks: GPS moving time. Kcal must derive from this when present —
   *  duration_minutes is elapsed time and includes stationary spells. */
  active_minutes?: number | null;
  status?: string | null;
}

/** The minutes a row actually BURNED for: moving time when measured (tracked
 *  walks), elapsed duration otherwise (manual logs, planned rows). */
export function burnMinutes(row: ActivityBurnRow): number | null | undefined {
  return row.active_minutes ?? row.duration_minutes;
}

export interface WeeklyBurn {
  /** kcal from completed activities. */
  completedKcal: number;
  /** kcal if every scheduled activity in the window were completed. */
  plannedKcal: number;
  completedMinutes: number;
  plannedMinutes: number;
}

export function computeWeeklyBurn(rows: ActivityBurnRow[], weightKg: number): WeeklyBurn {
  let completedKcal = 0;
  let plannedKcal = 0;
  let completedMinutes = 0;
  let plannedMinutes = 0;

  for (const row of rows) {
    const kcal = estimateActivityBurn(row.activity_type, row.intensity, burnMinutes(row), weightKg);
    const mins = row.duration_minutes || 0;
    if (row.status !== 'skipped') {
      plannedKcal += kcal;
      plannedMinutes += mins;
    }
    if (row.status === 'completed') {
      completedKcal += kcal;
      completedMinutes += mins;
    }
  }

  return {
    completedKcal: Math.round(completedKcal),
    plannedKcal: Math.round(plannedKcal),
    completedMinutes,
    plannedMinutes,
  };
}

export interface DeficitPet {
  species?: string | null;
  current_weight_kg?: number | null;
  target_daily_calories?: number | null;
  is_neutered?: boolean | null;
  activity_level?: string | null;
  breed?: string | null;
  age_years?: number | null;
  age_months?: number | null;
}

/**
 * Estimated maintenance kcal at the pet's CURRENT weight — the same pipeline
 * health.tsx uses when recomputing targets (RER × maintenance MER factor ×
 * life-stage × breed metabolic modifier), with goal forced to 'maintain'.
 */
export function estimateMaintenanceKcal(pet: DeficitPet): number {
  const weightKg = pet.current_weight_kg ?? 0;
  if (weightKg <= 0) return 0;

  const species: Species = pet.species === 'cat' ? 'cat' : 'dog';
  const activityLevel = (pet.activity_level || 'normal') as ActivityLevel;
  const isNeutered = pet.is_neutered ?? true;
  const ageMonths = getAgeMonths(pet);

  const breedDefs = getBreedDefaults(species, pet.breed, weightKg);
  const sizeCategory = breedDefs?.sizeCategory ?? sizeCategoryFromWeight(species, weightKg);
  const metabolicModifier = breedDefs?.metabolicModifier ?? 1.0;

  const ageYears = typeof ageMonths === 'number' ? ageMonths / 12 : 3;
  const lifeStage = deriveLifeStage(species, Math.floor(ageYears), Math.round((ageYears % 1) * 12), sizeCategory);
  const lifeStageMultiplier = getLifeStageCalorieMultiplier(lifeStage, species);

  const factor = getMERFactor(
    species, isNeutered, activityLevel, 'maintain', ageMonths, lifeStageMultiplier, metabolicModifier,
  );
  return Math.round(calculateRER(weightKg) * factor);
}

/**
 * The pet's actual planned daily deficit: estimated maintenance minus the
 * prescribed daily target. Zero when the plan isn't hypocaloric (maintain or
 * gain goals), so callers can suppress "% of deficit" framing entirely.
 */
export function computeDailyDeficitKcal(pet: DeficitPet): number {
  const target = pet.target_daily_calories ?? 0;
  if (target <= 0) return 0;
  const maintenance = estimateMaintenanceKcal(pet);
  return Math.max(0, maintenance - target);
}

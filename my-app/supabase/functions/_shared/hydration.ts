/**
 * hydration — Deno mirror of my-app/lib/hydration.ts. Keep both in sync.
 *
 * Daily drinking-water target: ~50 ml/kg total requirement, scaled down for
 * wet/mixed diets because food moisture (wet food ≈ 75% water) covers most of
 * the requirement. Unknown diet defaults to 'dry' (full drinking target).
 */

export type DietMoisture = 'dry' | 'mixed' | 'wet';

export const WATER_ML_PER_KG = 50;

export const DIET_WATER_MULTIPLIER: Record<DietMoisture, number> = {
  dry: 1.0,
  mixed: 0.7,
  wet: 0.4,
};

const WET_KEYWORDS = ['wet', 'canned', 'raw', 'fresh', 'cooked', 'home', 'human', 'pouch'];
const DRY_KEYWORDS = ['dry', 'kibble', 'biscuit'];

export function classifyDietMoisture(dietType: string[] | null | undefined): DietMoisture {
  if (!dietType || dietType.length === 0) return 'dry';
  const tags = dietType.map((t) => t.toLowerCase());
  const hasWet = tags.some((t) => WET_KEYWORDS.some((k) => t.includes(k)));
  const hasDry = tags.some((t) => DRY_KEYWORDS.some((k) => t.includes(k)));
  if (hasWet && hasDry) return 'mixed';
  if (hasWet) return 'wet';
  return 'dry';
}

/** Daily drinking-water target in ml, rounded to the nearest 10 ml. */
export function computeWaterTargetMl(
  weightKg: number | null | undefined,
  dietType?: string[] | null,
): number {
  if (!weightKg || weightKg <= 0) return 0;
  const moisture = classifyDietMoisture(dietType);
  return Math.round((weightKg * WATER_ML_PER_KG * DIET_WATER_MULTIPLIER[moisture]) / 10) * 10;
}

/** Per-session amount for the schedule's 3 hydration tasks. */
export function waterPerSessionMl(
  weightKg: number | null | undefined,
  dietType?: string[] | null,
): number {
  return Math.round(computeWaterTargetMl(weightKg, dietType) / 3);
}

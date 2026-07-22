/**
 * hydration — single source of truth for daily drinking-water targets.
 *
 * Total daily water requirement is ~50 ml/kg for dogs and cats (NRC / WSAVA
 * guidance: 40–60 ml/kg/day). But the app tracks DRINKING water (bowl refills
 * and water tasks), and food moisture counts toward the total:
 *
 *   - Dry food / kibble: ~10% moisture → nearly all water must be drunk.
 *   - Wet / canned / raw / fresh-cooked: ~70–80% moisture → the diet itself
 *     supplies most of the daily requirement. Wet-fed cats in particular
 *     drink very little by design — holding them to the full 50 ml/kg
 *     drinking target makes the water ring unreachable.
 *
 * The diet multiplier converts the physiological total into a realistic
 * drinking target. Unknown/uncaptured diet defaults to 'dry' (full target),
 * which preserves the app's historical behavior.
 *
 * MIRRORED in supabase/functions/_shared/hydration.ts (Deno can't import app
 * libs) — keep both copies in sync.
 */

export type DietMoisture = 'dry' | 'mixed' | 'wet';

export const WATER_ML_PER_KG = 50;

export const DIET_WATER_MULTIPLIER: Record<DietMoisture, number> = {
  dry: 1.0,   // ~10% food moisture → drink the full requirement
  mixed: 0.7, // some meals wet, some dry
  wet: 0.4,   // ~75% food moisture → food covers most of the requirement
};

const WET_KEYWORDS = ['wet', 'canned', 'raw', 'fresh', 'cooked', 'home', 'human', 'pouch'];
const DRY_KEYWORDS = ['dry', 'kibble', 'biscuit'];

/** Pantry food_types that are meals (drive the diet); treats/supplements don't. */
const NON_MEAL_FOOD_TYPES = ['treat', 'supplement'];

/**
 * Derive diet tags from the pet's food pantry — the pantry already knows
 * whether the pet eats kibble, wet food, raw, etc., so nobody has to be asked.
 * Used to keep pets.diet_type in sync (useActivePetStore.fetchPantry).
 */
export function dietTagsFromPantry(
  items: { food_type?: string | null; is_archived?: boolean }[] | null | undefined,
): string[] {
  if (!items || items.length === 0) return [];
  const tags = items
    .filter(i => !i.is_archived && i.food_type && !NON_MEAL_FOOD_TYPES.includes(i.food_type))
    .map(i => i.food_type as string);
  return Array.from(new Set(tags)).sort();
}

/**
 * Classify a pet's diet_type tags into a moisture profile.
 * Empty/unknown → 'dry' (full drinking target — the safe default).
 */
export function classifyDietMoisture(dietType: string[] | null | undefined): DietMoisture {
  if (!dietType || dietType.length === 0) return 'dry';
  const tags = dietType.map(t => t.toLowerCase());
  const hasWet = tags.some(t => WET_KEYWORDS.some(k => t.includes(k)));
  const hasDry = tags.some(t => DRY_KEYWORDS.some(k => t.includes(k)));
  if (hasWet && hasDry) return 'mixed';
  if (hasWet) return 'wet';
  return 'dry';
}

/**
 * Daily drinking-water target in ml, rounded to the nearest 10 ml.
 */
export function computeWaterTargetMl(
  weightKg: number | null | undefined,
  dietType?: string[] | null,
): number {
  if (!weightKg || weightKg <= 0) return 0;
  const moisture = classifyDietMoisture(dietType);
  return Math.round((weightKg * WATER_ML_PER_KG * DIET_WATER_MULTIPLIER[moisture]) / 10) * 10;
}

/**
 * Per-session amount for the schedule's 3 hydration tasks. Everything that
 * writes water_ml onto activity rows must use this so that
 * 3 × session === daily target (the bug where sessions were target/3 but only
 * 2 existed came from call sites doing this math independently).
 */
export function waterPerSessionMl(
  weightKg: number | null | undefined,
  dietType?: string[] | null,
): number {
  return Math.round(computeWaterTargetMl(weightKg, dietType) / 3);
}

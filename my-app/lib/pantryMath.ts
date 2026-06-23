/**
 * pantryMath.ts
 *
 * Deterministic macro computation when a pantry item is selected at scan time.
 *
 * When a user selects a known pantry item at scan, we already have the label-accurate
 * values (protein_pct, fat_pct, kcal_per_serving etc.). We use these to compute
 * macro grams deterministically — no Gemini guesswork, no rescans variation.
 *
 * This ensures identical output when the same pantry item is scanned multiple times.
 */

import type { PantryItem } from '../store/useActivePetStore';

export type BowlSize = 'small' | 'medium' | 'large' | 'xl';

/**
 * Default serving weights by unit type (grams), species-aware where it matters.
 * Cats eat smaller portions: their "cup" / "pouch" / "can" are ~30% smaller.
 */
export const DEFAULT_SERVING_GRAMS_BY_SPECIES: Record<'dog' | 'cat', Record<string, number>> = {
  dog: {
    pouch: 85, can: 150, tray: 100, sachet: 80, cup: 100, piece: 10, gram: 1,
  },
  cat: {
    pouch: 60, can: 85, tray: 70, sachet: 55, cup: 70, piece: 5, gram: 1,
  },
};

/** Legacy global table — kept for callers that don't know the species. */
export const DEFAULT_SERVING_GRAMS: Record<string, number> = DEFAULT_SERVING_GRAMS_BY_SPECIES.dog;

/** Bowl-size → grams of kibble in a "full bowl" (species-blind; rough but honest). */
export const BOWL_SIZE_GRAMS: Record<BowlSize, number> = {
  small: 100, medium: 200, large: 300, xl: 400,
};

/** Bowl-fraction labels used by the result-screen chip row. */
export type BowlFraction = 'quarter' | 'half' | 'full';
export const BOWL_FRACTION_RATIO: Record<BowlFraction, number> = {
  quarter: 0.25, half: 0.5, full: 1,
};

export type MacroResult = {
  /** Grams of protein in the selected serving(s) */
  protein_g: number;
  /** Grams of fat in the selected serving(s) */
  fat_g: number;
  /** Grams of carbs in the selected serving(s) */
  carbs_g: number;
  /** Total kcal = kcal_per_serving × servings */
  total_kcal: number;
  /** Grams of fiber in the selected serving(s) */
  fibre_g: number;
  /** Estimated meal weight in grams */
  meal_grams: number;
  /** Moisture % used (pantry value or default) */
  moisture_pct: number;
  /** kcal per 100g as-fed (pantry value or estimated) */
  kcal_per_100g: number;
};

/**
 * Compute macro grams deterministically from a pantry item + serving count.
 *
 * Uses label-accurate values from the pantry to ensure identical output
 * across rescans of the same pantry item.
 *
 * @param pantryItem — selected pantry item (from foodPantry store)
 * @param servings — number of servings (default 1)
 * @param opts — optional species + bowl context. When `bowl` is set AND the
 *   serving_unit is unspecified or `cup`, the bowl table is used instead of
 *   the per-unit grams (this is what makes bowl_size actually drive math).
 * @returns macro grams and derived values
 */
export interface PantryMacroOpts {
  species?: 'dog' | 'cat';
  /** When set, treat servings as bowl-fractions of this size (overrides unit grams for cup/unspecified). */
  bowl?: { size: BowlSize };
}

export function computePantryMacros(
  pantryItem: PantryItem,
  servings: number = 1,
  opts?: PantryMacroOpts,
): MacroResult {
  const { kcal_per_serving, kcal_per_100g_as_fed, moisture_pct, protein_pct, fat_pct, fibre_pct, serving_unit } = pantryItem;

  // --- Resolve serving weight ---
  const unit = serving_unit ?? '';
  const speciesTable = opts?.species ? DEFAULT_SERVING_GRAMS_BY_SPECIES[opts.species] : DEFAULT_SERVING_GRAMS;
  // When the pet has a bowl_size and the unit is unspecified or a cup, the
  // bowl drives the per-serving grams. Otherwise fall back to the unit table.
  const useBowl = !!opts?.bowl && (unit === 'cup' || unit === '');
  const gramsPerServing = useBowl
    ? BOWL_SIZE_GRAMS[opts!.bowl!.size]
    : (speciesTable[unit] ?? 100);
  const meal_grams = Math.round(gramsPerServing * servings);

  // --- Resolve kcal ---
  // If we have label kcal_per_100g_as_fed and a bowl-based meal weight, prefer
  // the density math so a "half bowl" actually scales kcal, not just one tap.
  const labelDensity = kcal_per_100g_as_fed && kcal_per_100g_as_fed > 0 ? kcal_per_100g_as_fed : null;
  const servingKcal = useBowl && labelDensity
    ? Math.round(labelDensity * gramsPerServing / 100)
    : (kcal_per_serving && kcal_per_serving > 0
        ? kcal_per_serving
        : 350); // generic fallback for pantry items without label data

  const total_kcal = Math.round(servingKcal * servings);

  // --- Resolve kcal/100g ---
  const kcalPer100g = kcal_per_100g_as_fed && kcal_per_100g_as_fed > 0
    ? kcal_per_100g_as_fed
    : gramsPerServing > 0
    ? Math.round((servingKcal / gramsPerServing) * 100)
    : 350;

  // --- Resolve moisture ---
  const moistureUsed = moisture_pct ?? (pantryItem.food_type === 'wet_food' ? 80 : 10);

  // --- Compute carbs as-fed % ---
  // Carbs are not always stated on labels. Estimate as:
  // carbs% = 100 - (protein% + fat% + fibre% + moisture% + ash%)
  // We assume ~3% ash for wet food, ~8% ash for dry/kibble.
  const ashPct = pantryItem.food_type === 'wet_food' ? 3 : 8;
  const carbsAsFedPct = Math.max(
    0,
    100 - (protein_pct ?? 0) - (fat_pct ?? 0) - (fibre_pct ?? 0) - moistureUsed - ashPct,
  );

  // --- Macro grams ---
  const protein_g = Math.round((protein_pct ?? 0) / 100 * meal_grams * 10) / 10;
  const fat_g     = Math.round((fat_pct ?? 0) / 100 * meal_grams * 10) / 10;
  const fibre_g   = Math.round((fibre_pct ?? 0) / 100 * meal_grams * 10) / 10;
  const carbs_g   = Math.round(carbsAsFedPct / 100 * meal_grams * 10) / 10;

  return {
    protein_g,
    fat_g,
    carbs_g,
    total_kcal,
    fibre_g,
    meal_grams,
    moisture_pct: moistureUsed,
    kcal_per_100g: kcalPer100g,
  };
}
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

/** Default serving weights by unit type (grams). */
export const DEFAULT_SERVING_GRAMS: Record<string, number> = {
  pouch: 85,    // standard wet food pouch (85g for Black Hawk / Royal Canin)
  can: 150,     // standard can size
  tray: 100,    // wet food tray
  sachet: 80,   // single-serve sachet
  cup: 100,     // dry food cup (~100g for kibble)
  piece: 10,    // individual treat piece
  gram: 1,     // per-gram
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
 * @returns macro grams and derived values
 */
export function computePantryMacros(
  pantryItem: PantryItem,
  servings: number = 1,
): MacroResult {
  const { kcal_per_serving, kcal_per_100g_as_fed, moisture_pct, protein_pct, fat_pct, fibre_pct, serving_unit } = pantryItem;

  // --- Resolve serving weight ---
  const unit = serving_unit ?? '';
  const gramsPerServing = DEFAULT_SERVING_GRAMS[unit] ?? 100;
  const meal_grams = Math.round(gramsPerServing * servings);

  // --- Resolve kcal ---
  // If pantry has label-accurate kcal_per_serving, use it. Otherwise fall back.
  // Note: kcal_per_serving from label is already per-serving (e.g. 92 kcal/pouch).
  const servingKcal = kcal_per_serving && kcal_per_serving > 0
    ? kcal_per_serving
    : 350; // generic fallback for pantry items without label data

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
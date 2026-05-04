import type { PantryItem } from '../store/useActivePetStore';
import { detectAllergens } from './allergenMatcher';

/**
 * Synthesize a scanner-shaped result from a known pantry item, so the existing
 * confirm/log pipeline can be reused for one-tap Quick Log without going through
 * camera capture or Gemini.
 *
 * IMPORTANT: returns PER-SINGLE-SERVING calories. The downstream `executeLog`
 * pantry path multiplies by `servingCount` via `computePantryMacros`, and the
 * `confirmLog` overage check multiplies by `servingCount` as well — so passing
 * the per-serving value keeps both branches correct.
 *
 * Pass `petAllergies` (and optionally `petName`) so allergens are matched on
 * the spot — same outcome as the Gemini-driven scan path, since allergies can
 * change after a food was first added to the pantry.
 */
export type SyntheticScanResult = {
  food_name: string;
  brand: string | null;
  product_name: string | null;
  food_type: PantryItem['food_type'];
  calories_per_serving: number;
  serving_size: string;
  serving_unit: string | null;
  protein_pct: number | null;
  fat_pct: number | null;
  fibre_pct: number | null;
  moisture_pct: number | null;
  kcal_per_100g_as_fed: number | null;
  key_ingredients: string[] | null;
  is_treat: boolean;
  is_allergy_trigger: boolean;
  allergy_warnings: string[];
  ingredients_of_concern: string[];
  recommendation: string;
  confidence: number;
  is_labeled_product: boolean;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  ingredients?: string[];
};

export function pantryItemToScanResult(
  item: PantryItem,
  petAllergies?: string[] | null,
  petName?: string,
): SyntheticScanResult {
  const productLabel = item.product_name?.trim() || '';
  const food_name = productLabel
    ? `${item.brand} ${productLabel}`.trim()
    : item.brand;

  // Re-match allergens against the pet's CURRENT allergy list. Don't rely on
  // the pantry's persisted `allergy_flags` — those may be stale if allergies
  // were added after the food was first scanned.
  const allergenMatch = detectAllergens(
    [food_name, item.brand, item.product_name, ...(item.key_ingredients ?? [])],
    petAllergies,
    petName,
  );

  return {
    food_name,
    brand: item.brand,
    product_name: item.product_name || null,
    food_type: item.food_type,
    // Per-single-serving kcal — multiplied by servingCount downstream.
    calories_per_serving: item.kcal_per_serving ?? 350,
    serving_size: item.serving_unit ? `1 ${item.serving_unit}` : '1 serving',
    serving_unit: item.serving_unit,
    protein_pct: item.protein_pct,
    fat_pct: item.fat_pct,
    fibre_pct: item.fibre_pct,
    moisture_pct: item.moisture_pct,
    kcal_per_100g_as_fed: item.kcal_per_100g_as_fed,
    key_ingredients: item.key_ingredients,
    is_treat: item.food_type === 'treat',
    is_allergy_trigger: allergenMatch.isMatch,
    allergy_warnings: allergenMatch.warnings,
    ingredients_of_concern: [],
    recommendation: '',
    // Label-derived data is high-confidence by definition.
    confidence: 1.0,
    is_labeled_product: true,
    // Macro grams are recomputed from pct in executeLog's pantry branch via
    // computePantryMacros; these placeholders are never read on that path.
    protein_g: 0,
    carbs_g: 0,
    fat_g: 0,
    ingredients: item.key_ingredients ?? undefined,
  };
}

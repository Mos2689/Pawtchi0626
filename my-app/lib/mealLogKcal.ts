/**
 * mealLogKcal.ts
 *
 * Single source of truth for "how many kcal does this meal log actually add?".
 *
 * The meal screen asks that question in three places — the overage guard, the
 * result-screen receipt line, and the row it writes to food_scans / daily_logs.
 * They used to answer it three different ways, and the log path was the one
 * that forgot to apply the portion multiplier: every portion (Less / Usual /
 * More / Custom) stored the same number whenever the scan wasn't explicitly
 * pointed at a pantry item. Calories are the whole weight-management loop, so
 * the resolution lives here, pure and tested, and every caller reads from it.
 *
 * Contract: the scan values passed in are always for ONE serving. The
 * multiplier is applied exactly once, here.
 */

import { computePantryMacros, type PantryMacroOpts } from './pantryMath';
import type { PantryItem } from '../store/useActivePetStore';

/**
 * How confident the server's pantry auto-match must be before we treat the
 * log as "this is that pantry item" — which means using its label math for
 * kcal, speaking in bowls on the portion chips, and counting the scan against
 * it. Below this, the scan stands on its own and the Source row asks the owner
 * to confirm. One threshold for all of it: a screen that says "auto-matched"
 * while quietly costing the meal from a different set of numbers is worse than
 * one that asks.
 */
export const AUTO_MATCH_TRUST_THRESHOLD = 0.7;

/** The per-ONE-serving macro/label values carried on a scan result. */
export interface ScanMacroSource {
  /** kcal for a single serving — never pre-multiplied. */
  calories_per_serving: number;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  kcal_per_100g_as_fed?: number | null;
  moisture_pct?: number | null;
  protein_pct?: number | null;
  fat_pct?: number | null;
  fibre_pct?: number | null;
}

export interface LoggedTotals {
  /** kcal actually written to food_scans + daily_logs. Always an integer. */
  totalCalories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  /** Label percentages for the verdict layer — pantry values win when present. */
  kcal_per_100g: number | null;
  moisture_pct: number | null;
  protein_pct: number | null;
  fat_pct: number | null;
  fibre_pct: number | null;
  /** Which side of the branch produced these numbers (useful in tests + logs). */
  source: 'pantry' | 'scan';
  /** The multiplier actually applied, after sanitising. */
  servings: number;
}

/**
 * A portion multiplier we're willing to do arithmetic with.
 *
 * NaN / Infinity / 0 / negatives all mean "we don't know what the owner
 * picked". Falling back to 1 logs the honest single serving rather than 0 kcal
 * (which would silently under-count the day) or NaN (which would poison the
 * daily total).
 */
export function sanitiseServings(servings: unknown): number {
  const n = typeof servings === 'number' ? servings : Number(servings);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

/** Macro grams are stored to one decimal — matches computePantryMacros. */
function round1(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10) / 10;
}

/**
 * Which pantry item this log counts against.
 *
 * Explicit owner pick always wins. Otherwise the server's auto-match is used
 * only when it clears AUTO_MATCH_TRUST_THRESHOLD and the model didn't flag a
 * food-type mismatch (a "kibble scan matched to a wet-food row" match is the
 * one we most want to refuse).
 */
export function resolvePantrySourceId(
  scan:
    | {
        matched_pantry_id?: string | null;
        match_confidence?: number | null;
        food_type_mismatch?: boolean | null;
      }
    | null
    | undefined,
  explicitPantryId: string | null | undefined,
): string | null {
  if (explicitPantryId) return explicitPantryId;
  if (!scan?.matched_pantry_id) return null;
  if (scan.food_type_mismatch === true) return null;
  const confidence = scan.match_confidence ?? 0;
  return confidence >= AUTO_MATCH_TRUST_THRESHOLD ? scan.matched_pantry_id : null;
}

/**
 * Resolve the totals a log should write.
 *
 * When a pantry item backs the log, its label data drives the math
 * (deterministic, identical across rescans). Otherwise the scan's own
 * per-serving values are scaled. Either way the multiplier is applied once.
 */
export function resolveLoggedTotals(
  scan: ScanMacroSource,
  pantryItem: PantryItem | null | undefined,
  servings: number,
  opts?: PantryMacroOpts,
): LoggedTotals {
  const s = sanitiseServings(servings);

  if (pantryItem) {
    const macros = computePantryMacros(pantryItem, s, opts);
    return {
      totalCalories: macros.total_kcal,
      protein_g: macros.protein_g,
      carbs_g: macros.carbs_g,
      fat_g: macros.fat_g,
      kcal_per_100g: macros.kcal_per_100g,
      moisture_pct: macros.moisture_pct,
      protein_pct: pantryItem.protein_pct ?? null,
      fat_pct: pantryItem.fat_pct ?? null,
      fibre_pct: pantryItem.fibre_pct ?? null,
      source: 'pantry',
      servings: s,
    };
  }

  const perServingKcal = Number.isFinite(scan.calories_per_serving)
    ? scan.calories_per_serving
    : 0;

  return {
    totalCalories: Math.max(0, Math.round(perServingKcal * s)),
    protein_g: round1((scan.protein_g ?? 0) * s),
    carbs_g: round1((scan.carbs_g ?? 0) * s),
    fat_g: round1((scan.fat_g ?? 0) * s),
    kcal_per_100g: scan.kcal_per_100g_as_fed ?? null,
    moisture_pct: scan.moisture_pct ?? null,
    protein_pct: scan.protein_pct ?? null,
    fat_pct: scan.fat_pct ?? null,
    fibre_pct: scan.fibre_pct ?? null,
    source: 'scan',
    servings: s,
  };
}

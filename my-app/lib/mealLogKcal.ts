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

import {
  computePantryMacros,
  fieldProvenance,
  isObserved,
  resolveServingWeight,
  type PantryMacroOpts,
} from './pantryMath';
import type { NutritionField, PantryItem, Provenance } from '../store/useActivePetStore';

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

// ─── Reading a label that prices by mass ─────────────────────────────────────
//
// Most pet food does not print "kcal per serving". It prints a metabolisable
// energy density — "3650 kcal/kg", "Typical ME: 475 kcal/100g" — and a feeding
// table in cups or grams per day. The extractor is right to return null for
// `calories_per_serving` there: the figure genuinely is not on the packet, and
// substituting an average would be inventing one.
//
// But null is not the same as unreadable, and treating it that way is what sent
// perfectly legible labels to "Couldn't read that photo". When the packet states
// a density AND a serving weight, the per-serving figure is fully determined by
// two printed numbers. Multiplying them is transcription, not estimation.
//
// The one thing this must not do is manufacture agreement. It only fires when
// `calories_per_serving` was absent, so it can never overwrite an independently
// read figure — which is what keeps the three-way label cross-check (in the
// pantry editor, and in the food_pantry trigger) honest. A serving kcal derived
// here will always match density × grams, so it is evidence of nothing, and the
// basis it reports says exactly that.

export interface ScanLabelRead {
  calories_per_serving?: number | null;
  kcal_per_100g_as_fed?: number | null;
  serving_grams?: number | null;
}

export type ScanKcalBasis = 'label_serving' | 'label_density' | 'unknown';

export interface ResolvedScanKcal {
  /** kcal in one serving, or null when the label supports no honest figure. */
  kcalPerServing: number | null;
  basis: ScanKcalBasis;
}

/** Same ceiling the extractor uses — past this, a unit error is likelier than a meal. */
const MAX_SERVING_KCAL = 5000;

export function resolveScanKcal(scan: ScanLabelRead | null | undefined): ResolvedScanKcal {
  const stated = scan?.calories_per_serving;
  if (typeof stated === 'number' && Number.isFinite(stated) && stated > 0) {
    return { kcalPerServing: stated, basis: 'label_serving' };
  }

  const density = scan?.kcal_per_100g_as_fed;
  const grams = scan?.serving_grams;
  if (
    typeof density === 'number' && Number.isFinite(density) && density > 0 &&
    typeof grams === 'number' && Number.isFinite(grams) && grams > 0
  ) {
    const derived = Math.round((density * grams) / 100);
    if (derived >= 1 && derived <= MAX_SERVING_KCAL) {
      return { kcalPerServing: derived, basis: 'label_density' };
    }
  }

  return { kcalPerServing: null, basis: 'unknown' };
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

// ─── The canonical meal ───────────────────────────────────────────────────────
//
// `resolveLoggedTotals` answers "how many kcal?". This answers the harder and
// more useful question: "what is this number MADE of, and was any part of it
// actually observed rather than assumed?"
//
// ── Why that question, and not a cross-check ────────────────────────────────
//
// The obvious design is to compute the meal two ways and compare. It does not
// work here, and the way it fails is instructive: `computePantryMacros` derives
// density from serving kcal when the label lacks it, and the old log path
// derived meal weight back out of protein grams. Feed a 200x portion through
// both and you get 120 x 200 = 24,000 kcal and 120 x 20,000/100 = 24,000 kcal —
// perfect agreement on a hundredfold error. Two numbers derived from each other
// cannot check each other, however independent the code paths look.
//
// So verification is layered instead:
//
//   1. INPUT INVARIANTS  (per meal, in the UI) — the portion is finite and
//      inside the stepper's own range. This is validation, not evidence.
//   2. LABEL CONSISTENCY (per pantry item, in the database) — kcal_per_serving,
//      kcal_per_100g_as_fed and serving_grams are over-determined, so any two
//      fix the third. Genuinely independent, but ONLY when each was separately
//      observed. Owned by the food_pantry trigger, read here — never recomputed,
//      because a second implementation is a second thing to drift.
//   3. THIS LAYER inherits (2) and records what it used.
//
// The honest consequence: a meal cannot be verified beyond the quality of the
// label facts behind it. `quality: 'unverifiable'` is the correct answer for
// most of today's data, and saying so is more useful than a check that returns
// 'ok' because it compared a number with itself.

export type LabelConsistency = 'consistent' | 'inconsistent' | 'unverifiable';
export type MealQuality = 'verified' | 'unverifiable' | 'anomalous' | 'ambiguous';
export type KcalBasis = 'label_density' | 'label_serving' | 'owner_corrected' | 'estimated';

/**
 * The label facts as used, frozen at log time.
 *
 * This is what makes a historical meal auditable after the pantry item has been
 * corrected — and what stops an adjustment silently re-pricing an old meal at
 * today's numbers.
 */
export interface NutritionSnapshot {
  kcal_per_serving: number | null;
  kcal_per_100g_as_fed: number | null;
  serving_grams: number | null;
  protein_pct: number | null;
  fat_pct: number | null;
  fibre_pct: number | null;
  moisture_pct: number | null;
  provenance: Partial<Record<NutritionField, Provenance>>;
  nutrition_revision: number | null;
  label_consistency: LabelConsistency;
}

export interface CanonicalMeal {
  kcal: number;
  /** Canonical. Never re-derived downstream — that is how one row came to store 240 and 24,000 at once. */
  mealGrams: number | null;
  protein_g: number;
  fat_g: number;
  carbs_g: number;
  /** Label percentages the verdict layer needs. */
  kcal_per_100g: number | null;
  moisture_pct: number | null;
  protein_pct: number | null;
  fat_pct: number | null;
  fibre_pct: number | null;
  nutritionSnapshot: NutritionSnapshot | null;
  kcalBasis: KcalBasis;
  labelConsistency: LabelConsistency;
  quality: MealQuality;
  /** Behavioural anomalies. Populated in stage 9, once thresholds are signed off. */
  anomalies: string[];
  portion: {
    mode: 'weight' | 'count' | 'fraction';
    /** Native units: grams | whole pieces | multiples of one serving unit. */
    quantity: number;
    unitBasis: 'manufacturer' | 'bowl';
  };
  source: 'pantry' | 'scan';
  servings: number;
}

// ── Dimensional tolerances ──────────────────────────────────────────────────
//
// Mass and energy get separate rules because they are separate quantities; a
// single `max(2 g, 2 kcal, 4%)` is dimensionally meaningless. Both are
// absolute-plus-relative because a flat percentage is too tight on a 5 g
// supplement dose and too loose on a 400 g bowl.
//
// The energy figures mirror the food_pantry trigger exactly. If you change one,
// change both — they are checking the same arithmetic on opposite sides of the
// wire.

/** Labels round mass to whole grams. */
export function massTolerance(expectedGrams: number): number {
  return Math.max(1, 0.02 * Math.abs(expectedGrams));
}

/** Labels round energy to roughly 5-10 kcal. */
export function energyTolerance(expectedKcal: number): number {
  return Math.max(5, 0.03 * Math.abs(expectedKcal));
}

export function massAgrees(a: number, b: number): boolean {
  return Math.abs(a - b) <= massTolerance(b);
}

export function energyAgrees(a: number, b: number): boolean {
  return Math.abs(a - b) <= energyTolerance(b);
}

/** The fields whose provenance the kcal figure actually depends on. */
const KCAL_FIELDS: NutritionField[] = [
  'kcal_per_serving',
  'kcal_per_100g_as_fed',
  'serving_grams',
];

function buildSnapshot(item: PantryItem, opts?: PantryMacroOpts): NutritionSnapshot {
  const serving = resolveServingWeight(item, opts);
  const provenance: Partial<Record<NutritionField, Provenance>> = {};
  const fields: NutritionField[] = [
    'kcal_per_serving',
    'kcal_per_100g_as_fed',
    'serving_grams',
    'protein_pct',
    'fat_pct',
    'fibre_pct',
    'moisture_pct',
  ];
  for (const f of fields) provenance[f] = fieldProvenance(item, f);
  // A serving weight we computed is 'derived' regardless of what the pantry row
  // claims, because the derivation is what makes it circular.
  if (item.serving_grams == null || !(item.serving_grams > 0)) {
    provenance.serving_grams = serving.provenance;
  }

  return {
    kcal_per_serving: item.kcal_per_serving ?? null,
    kcal_per_100g_as_fed: item.kcal_per_100g_as_fed ?? null,
    serving_grams: item.serving_grams ?? serving.grams,
    protein_pct: item.protein_pct ?? null,
    fat_pct: item.fat_pct ?? null,
    fibre_pct: item.fibre_pct ?? null,
    moisture_pct: item.moisture_pct ?? null,
    provenance,
    nutrition_revision: item.nutrition_revision ?? null,
    // Read, never recomputed — the database trigger owns this.
    label_consistency: item.label_consistency ?? 'unverifiable',
  };
}

function resolveKcalBasis(
  item: PantryItem,
  snapshot: NutritionSnapshot,
  usedDensity: boolean,
): KcalBasis {
  const touched = KCAL_FIELDS.some((f) => snapshot.provenance[f] === 'owner_corrected');
  if (touched) return 'owner_corrected';
  if (usedDensity && (item.kcal_per_100g_as_fed ?? 0) > 0) return 'label_density';
  if ((item.kcal_per_serving ?? 0) > 0) return 'label_serving';
  // computePantryMacros falls back to a flat 350 kcal here. That figure may
  // support display guidance, but a meal written on it is an estimate and must
  // say so — it is never 'default', which would imply it needed no owner.
  return 'estimated';
}

/**
 * Resolve everything a meal write needs, in one object.
 *
 * The same object drives `food_scans`, `food_analysis`, the preview UI, the
 * daily aggregate and monitoring. Nothing downstream recomputes any part of it.
 */
export function resolveCanonicalMeal(
  scan: ScanMacroSource,
  pantryItem: PantryItem | null | undefined,
  servings: number,
  opts?: PantryMacroOpts,
): CanonicalMeal {
  const totals = resolveLoggedTotals(scan, pantryItem, servings, opts);
  const s = totals.servings;

  if (!pantryItem) {
    // An unmatched scan has no pantry row behind it, so there is no second
    // observed fact anywhere and no snapshot to freeze. Explicit branch, not an
    // oversight: it is 'estimated' and 'unverifiable', and stage 5 asks the
    // owner to confirm it rather than quietly counting it as known.
    return {
      kcal: totals.totalCalories,
      mealGrams: null,
      protein_g: totals.protein_g,
      fat_g: totals.fat_g,
      carbs_g: totals.carbs_g,
      kcal_per_100g: totals.kcal_per_100g,
      moisture_pct: totals.moisture_pct,
      protein_pct: totals.protein_pct,
      fat_pct: totals.fat_pct,
      fibre_pct: totals.fibre_pct,
      nutritionSnapshot: null,
      kcalBasis: 'estimated',
      labelConsistency: 'unverifiable',
      quality: 'unverifiable',
      anomalies: [],
      portion: { mode: 'fraction', quantity: s, unitBasis: 'manufacturer' },
      source: 'scan',
      servings: s,
    };
  }

  const serving = resolveServingWeight(pantryItem, opts);
  const snapshot = buildSnapshot(pantryItem, opts);
  const macros = computePantryMacros(pantryItem, s, opts);
  const usedDensity = serving.basis === 'bowl' && (pantryItem.kcal_per_100g_as_fed ?? 0) > 0;
  const kcalBasis = resolveKcalBasis(pantryItem, snapshot, usedDensity);
  const labelConsistency = snapshot.label_consistency;

  // A meal is only as verified as the facts behind it. Requiring every
  // kcal-relevant field to be independently observed is what stops a derived
  // number certifying itself.
  const allObserved = KCAL_FIELDS.every((f) => isObserved(snapshot.provenance[f]));
  const quality: MealQuality =
    labelConsistency === 'consistent' && allObserved ? 'verified' : 'unverifiable';

  const mode: 'weight' | 'count' | 'fraction' =
    (pantryItem.serving_unit ?? '').toLowerCase() === 'gram' ||
    (pantryItem.serving_unit ?? '').toLowerCase() === 'g'
      ? 'weight'
      : (pantryItem.serving_unit ?? '').toLowerCase() === 'piece'
      ? 'count'
      : 'fraction';

  return {
    kcal: totals.totalCalories,
    mealGrams: macros.meal_grams,
    protein_g: totals.protein_g,
    fat_g: totals.fat_g,
    carbs_g: totals.carbs_g,
    kcal_per_100g: totals.kcal_per_100g,
    moisture_pct: totals.moisture_pct,
    protein_pct: totals.protein_pct,
    fat_pct: totals.fat_pct,
    fibre_pct: totals.fibre_pct,
    nutritionSnapshot: snapshot,
    kcalBasis,
    labelConsistency,
    quality,
    anomalies: [],
    portion: {
      mode,
      // Native units per mode: grams for weight, pieces/unit-multiples otherwise.
      quantity: mode === 'weight' ? Math.round(serving.grams * s) : s,
      unitBasis: serving.basis,
    },
    source: 'pantry',
    servings: s,
  };
}

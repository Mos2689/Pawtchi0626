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

import type { NutritionField, PantryItem, Provenance } from '../store/useActivePetStore';

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

// ─── Portion presets ──────────────────────────────────────────────────────────
// One central function maps (unit, species, bowlSize) to a chip set. The
// MealHero is a pure consumer — the multiplier sent to onLog is always
// `gramsFed / gramsPerUnit`, so kcal math stays single-sourced regardless of
// which vocabulary the chips speak.

export type PortionMode = 'fraction' | 'count' | 'weight';

/**
 * Meals per day assumed when turning a daily kcal target into a per-meal one.
 *
 * Only used to derive a sensible weight-mode chip baseline when the label has
 * no serving weight. Lives here because it is an input to `getPortionPresets`,
 * and every caller must feed it the same number or two screens will disagree
 * about what a normal portion looks like.
 */
export const MEALS_PER_DAY = 2;

export interface PortionPreset {
  label: string;          // top line on chip — '½ pouch' / '2 pieces' / '50 g'
  gramsFed: number;       // canonical grams this preset represents
}

export interface PortionPresets {
  mode: PortionMode;
  /** Grams that 1.0× of this item represents (bowl_g for cup+bowl, else species table). */
  gramsPerUnit: number;
  /** Display word — 'bowl', 'pouch', 'piece', 'g', 'serving'. */
  unitLabel: string;
  presets: PortionPreset[];
  /** Range + step for the Custom stepper, expressed in chip-native units (unit-multiplier for fraction/count, grams for weight). */
  stepper: { min: number; max: number; step: number };
}

const FRACTION_UNITS = new Set(['cup', 'pouch', 'can', 'sachet', 'tray', '']);

/** Serving weight assumed for a gram-unit item whose label data is missing. */
export const DEFAULT_GRAM_SERVING_GRAMS = 100;

/**
 * How many grams "1 serving" means for a gram-unit item.
 *
 * `serving_unit: 'gram'` does NOT mean the label quotes calories per single
 * gram — the extractor returns `calories_per_serving` for whatever serving the
 * label states (typically 100 g). Treating one serving as 1 g made a 50 g
 * portion multiply the whole serving's calories by fifty: a 350 kcal meal
 * logged as 17,500 kcal.
 *
 * Both the chip row and the kcal math resolve the weight through here so they
 * can never disagree about what a multiplier of 1 means.
 */
export function gramUnitServingGrams(
  kcalPerServing?: number | null,
  kcalPer100g?: number | null,
): number {
  if (kcalPerServing && kcalPerServing > 0 && kcalPer100g && kcalPer100g > 0) {
    const grams = (kcalPerServing * 100) / kcalPer100g;
    // Round to 5 g and keep it inside a sane band — a garbage density reading
    // must not reintroduce an order-of-magnitude error by the back door.
    return Math.min(1000, Math.max(5, Math.round(grams / 5) * 5));
  }
  return DEFAULT_GRAM_SERVING_GRAMS;
}

/** True for the units that are measured by weight rather than by container. */
function isWeightUnit(unit: string): boolean {
  return unit === 'gram' || unit === 'g';
}

/** Provenance values that count as independently observed. */
const OBSERVED: ReadonlySet<Provenance> = new Set<Provenance>(['label', 'owner_corrected']);

export function isObserved(p: Provenance | undefined | null): boolean {
  return !!p && OBSERVED.has(p);
}

/** The recorded provenance of one field, or 'estimated' when we were never told. */
export function fieldProvenance(
  item: Pick<PantryItem, 'nutrition_provenance'>,
  field: NutritionField,
): Provenance {
  return item.nutrition_provenance?.[field] ?? 'estimated';
}

/**
 * What one serving of this food weighs, and how much that answer is worth.
 *
 * ── Precedence, and why it is this way round ────────────────────────────────
 *
 * 1. The owner's bowl, when the food is measured in cups and they told us their
 *    bowl size. This is `basis: 'bowl'` and is deliberately NOT treated as a
 *    manufacturer fact — "medium bowl" is a size bucket, not a measurement, so
 *    a meal resolved this way can never be called label-consistent.
 * 2. An explicit `serving_grams`. This is the number printed on the packet and
 *    it wins over anything we could compute. **Never clamped** — a 4.6 g
 *    supplement dose is real, and rounding it up to a "sane" 5 g would corrupt
 *    correct data to protect against incorrect data.
 * 3. Derivation from label density, for weight-measured foods. This IS a guess,
 *    so it keeps the sanity band: a garbage density reading must not
 *    reintroduce an order-of-magnitude error by the back door.
 * 4. The species table, then a flat default.
 *
 * Every branch reports its provenance, because the whole point of the exercise
 * is that a number derived from another number cannot be used to check it.
 */
export interface ServingWeight {
  grams: number;
  /** Whose measure this is — the manufacturer's, or the owner's bowl. */
  basis: 'manufacturer' | 'bowl';
  provenance: Provenance;
}

export function resolveServingWeight(
  item: Pick<
    PantryItem,
    'serving_unit' | 'serving_grams' | 'kcal_per_serving' | 'kcal_per_100g_as_fed' | 'nutrition_provenance'
  >,
  opts?: PantryMacroOpts,
): ServingWeight {
  const unit = (item.serving_unit ?? '').toLowerCase();

  if (opts?.bowl && (unit === 'cup' || unit === '')) {
    return {
      grams: BOWL_SIZE_GRAMS[opts.bowl.size],
      basis: 'bowl',
      // An owner-declared size bucket, not a measurement of this food.
      provenance: 'default',
    };
  }

  if (item.serving_grams != null && item.serving_grams > 0) {
    return {
      grams: item.serving_grams,
      basis: 'manufacturer',
      provenance: fieldProvenance(item, 'serving_grams'),
    };
  }

  if (isWeightUnit(unit)) {
    const kcalPerServing = item.kcal_per_serving;
    const kcalPer100g = item.kcal_per_100g_as_fed;
    if (kcalPerServing && kcalPerServing > 0 && kcalPer100g && kcalPer100g > 0) {
      const grams = (kcalPerServing * 100) / kcalPer100g;
      return {
        grams: Math.min(1000, Math.max(5, Math.round(grams / 5) * 5)),
        basis: 'manufacturer',
        // Computed FROM the two calorie figures, so it can never be used to
        // check them — that circularity is the whole reason provenance exists.
        provenance: 'derived',
      };
    }
    return { grams: DEFAULT_GRAM_SERVING_GRAMS, basis: 'manufacturer', provenance: 'default' };
  }

  const speciesTable = opts?.species
    ? DEFAULT_SERVING_GRAMS_BY_SPECIES[opts.species]
    : DEFAULT_SERVING_GRAMS;
  return {
    grams: speciesTable[unit] ?? 100,
    basis: 'manufacturer',
    provenance: 'default',
  };
}

/**
 * Resolve the chip set + stepper for a given serving unit.
 *
 * @param unit          item.serving_unit ('cup' | 'pouch' | 'can' | … | null)
 * @param species       'dog' | 'cat' — picks the species-aware gram table
 * @param bowlSize      if set AND unit is cup/empty, bowl table drives gramsPerUnit
 * @param weightContext optional context for weight-mode chip derivation:
 *                      - labelGramsPerServing: kcal_per_serving × 100 / kcal_per_100g_as_fed when both exist
 *                      - perMealKcalTarget:    pet's daily kcal target ÷ meals/day (fallback when label is missing)
 *                      - kcalPer100g:          item kcal_per_100g_as_fed (used to convert per-meal kcal → grams)
 *                      - kcalPerServing:       item kcal_per_serving (with kcalPer100g, defines the serving weight)
 */
export function getPortionPresets(
  unit: string | null | undefined,
  species: 'dog' | 'cat',
  bowlSize?: BowlSize | null,
  weightContext?: {
    labelGramsPerServing?: number | null;
    perMealKcalTarget?: number | null;
    kcalPer100g?: number | null;
    kcalPerServing?: number | null;
    /**
     * The manufacturer's printed serving weight. Authoritative when present,
     * for EVERY unit — a pouch or can prints one too, and re-deriving it from
     * density when the packet already states it is how the app ended up
     * disagreeing with the label in the first place.
     */
    servingGrams?: number | null;
  },
): PortionPresets {
  const u = (unit ?? '').toLowerCase();
  const speciesTable = DEFAULT_SERVING_GRAMS_BY_SPECIES[species];
  const statedGrams =
    weightContext?.servingGrams != null && weightContext.servingGrams > 0
      ? weightContext.servingGrams
      : null;

  // gram unit → weight mode
  if (isWeightUnit(u)) {
    const labelBaseline = statedGrams
      ?? (weightContext?.labelGramsPerServing && weightContext.labelGramsPerServing > 0
        ? weightContext.labelGramsPerServing
        : null);
    const fallbackBaseline = (() => {
      const kcal = weightContext?.perMealKcalTarget;
      const dens = weightContext?.kcalPer100g;
      if (kcal && kcal > 0 && dens && dens > 0) return (kcal / dens) * 100;
      return null;
    })();
    const baselineRaw = labelBaseline ?? fallbackBaseline ?? 50;
    const baseline = Math.max(5, Math.round(baselineRaw / 5) * 5);
    const half = Math.max(5, Math.round((baseline * 0.5) / 5) * 5);
    const oneAndHalf = Math.max(5, Math.round((baseline * 1.5) / 5) * 5);
    // One serving = the label's serving weight, resolved exactly as
    // computePantryMacros resolves it. The caller divides gramsFed by this to
    // get the multiplier, so the two sides must agree to the gram.
    // A stated weight is never clamped; only a derived one is.
    const gramsPerUnit = statedGrams ?? gramUnitServingGrams(
      weightContext?.kcalPerServing ?? null,
      weightContext?.kcalPer100g ?? null,
    );
    return {
      mode: 'weight',
      gramsPerUnit,
      unitLabel: 'g',
      presets: [
        { label: `${half} g`,        gramsFed: half },
        { label: `${baseline} g`,    gramsFed: baseline },
        { label: `${oneAndHalf} g`,  gramsFed: oneAndHalf },
        { label: 'Custom',           gramsFed: baseline },
      ],
      // Stepper bounds are chip-native (unit multipliers), as in every other
      // mode — 5 g / 500 g expressed against this item's serving weight.
      stepper: { min: 5 / gramsPerUnit, max: 500 / gramsPerUnit, step: 5 / gramsPerUnit },
    };
  }

  // piece → count mode
  if (u === 'piece') {
    // A printed per-piece weight beats the species table's generic 10 g.
    const grams = statedGrams ?? speciesTable.piece ?? 10;
    return {
      mode: 'count',
      gramsPerUnit: grams,
      unitLabel: 'piece',
      presets: [
        { label: '1 piece',  gramsFed: grams * 1 },
        { label: '2 pieces', gramsFed: grams * 2 },
        { label: '3 pieces', gramsFed: grams * 3 },
        { label: 'Custom',   gramsFed: grams * 1 },
      ],
      stepper: { min: 1, max: 20, step: 1 },
    };
  }

  // everything else → fraction mode (cup/bowl, pouch, can, sachet, tray, null)
  //
  // The bowl still wins for cup-measured food: the owner is scooping from their
  // own bowl, and that is a different measure from the manufacturer's serving.
  // Otherwise a printed weight beats the species table — a 100 g tray is a
  // 100 g tray, whatever our generic figure for "tray" happens to be.
  const useBowl = !!bowlSize && (u === 'cup' || u === '');
  const gramsPerUnit = useBowl
    ? BOWL_SIZE_GRAMS[bowlSize as BowlSize]
    : (statedGrams ?? speciesTable[u] ?? 100);
  const unitLabel = useBowl ? 'bowl' : (u || 'serving');
  return {
    mode: 'fraction',
    gramsPerUnit,
    unitLabel,
    presets: [
      { label: `¼ ${unitLabel}`,    gramsFed: Math.round(gramsPerUnit * 0.25) },
      { label: `½ ${unitLabel}`,    gramsFed: Math.round(gramsPerUnit * 0.5)  },
      { label: `Full ${unitLabel}`, gramsFed: gramsPerUnit                    },
      { label: `1½ ${unitLabel}`,   gramsFed: Math.round(gramsPerUnit * 1.5)  },
    ],
    stepper: { min: 0.25, max: 4, step: 0.25 },
  };
}

/**
 * The bounds a portion may take, expressed in the mode's NATIVE units.
 *
 * `PortionPresets.stepper` speaks chip-native units, which for weight mode means
 * unit-multipliers rather than grams — MealHero has always had to multiply by
 * `gramsPerUnit` to get a usable range. That conversion now lives here so every
 * consumer (the stepper, portion learning, the initial-portion resolver) reads
 * one definition of "how much is allowed". A learned portion that the stepper
 * would refuse must never be applied, and two copies of this arithmetic is
 * exactly how that guarantee gets lost.
 *
 * Native units, per `portion_mode`:
 *   weight   → grams
 *   count    → whole pieces
 *   fraction → multiples of one serving unit (0.5 = half a bowl/pouch/can)
 */
export interface PortionBounds {
  mode: PortionMode;
  /** Inclusive minimum, native units. */
  min: number;
  /** Inclusive maximum, native units. */
  max: number;
  /** Grams represented by 1.0 of the mode's unit — the conversion factor. */
  gramsPerUnit: number;
}

export function getPortionBounds(presets: PortionPresets): PortionBounds {
  const { mode, stepper, gramsPerUnit } = presets;
  if (mode === 'weight') {
    return {
      mode,
      min: Math.max(1, Math.round(stepper.min * gramsPerUnit)),
      max: Math.max(1, Math.round(stepper.max * gramsPerUnit)),
      gramsPerUnit,
    };
  }
  return { mode, min: stepper.min, max: stepper.max, gramsPerUnit };
}

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
  // `serving_unit` is deliberately not destructured here any more — the serving
  // weight is resolved below rather than switched on inline, so the unit is
  // read in exactly one place.
  const { kcal_per_serving, kcal_per_100g_as_fed, moisture_pct, protein_pct, fat_pct, fibre_pct } = pantryItem;

  // --- Resolve serving weight ---
  // One resolver decides what a serving weighs, so the chip row, the macro
  // math and the canonical meal can never disagree about it. See
  // resolveServingWeight for the precedence and why each branch is ordered
  // where it is.
  const serving = resolveServingWeight(pantryItem, opts);
  const gramsPerServing = serving.grams;
  const useBowl = serving.basis === 'bowl';
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
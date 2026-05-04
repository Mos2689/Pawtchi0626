/**
 * Pure-function nutrition math.
 *
 * No I/O, no LLM calls, no randomness — these functions are referenced by
 * the verdict layer and the deterministic health-score calculator, and are
 * unit-tested in aafcoMath.test.ts.
 *
 * All percentages are expressed 0–100 (e.g. "25" for 25% protein), not 0–1.
 */

/**
 * Convert an as-fed nutrient % to dry-matter basis %.
 *
 * Formula: (asFedPct / (100 - moisturePct)) * 100
 *
 * Worked example: 25% protein at 10% moisture
 *   = 25 / (100 - 10) * 100
 *   = 25 / 90 * 100
 *   = 27.78% DMB
 *
 * This is the conversion that makes wet vs kibble protein comparable.
 * A wet food at 8% protein / 78% moisture is 36.4% DMB — actually higher
 * protein than 25%/10% kibble (27.8% DMB) once you strip out water weight.
 */
export function toDryMatterBasis(asFedPct: number, moisturePct: number): number {
  if (moisturePct < 0 || moisturePct >= 100) {
    throw new Error(`toDryMatterBasis: moisturePct must be in [0, 100), got ${moisturePct}`);
  }
  if (asFedPct < 0) {
    throw new Error(`toDryMatterBasis: asFedPct must be >= 0, got ${asFedPct}`);
  }
  return (asFedPct / (100 - moisturePct)) * 100;
}

/**
 * Convert kcal per 100g as-fed to kcal per 100g dry matter.
 * Same denominator trick as the DMB conversion.
 */
export function kcalPer100gDryMatter(kcalPer100gAsFed: number, moisturePct: number): number {
  if (moisturePct < 0 || moisturePct >= 100) {
    throw new Error(`kcalPer100gDryMatter: moisturePct must be in [0, 100), got ${moisturePct}`);
  }
  if (kcalPer100gAsFed < 0) {
    throw new Error(`kcalPer100gDryMatter: kcalPer100gAsFed must be >= 0, got ${kcalPer100gAsFed}`);
  }
  return (kcalPer100gAsFed / (100 - moisturePct)) * 100;
}

/**
 * Compute grams of nutrient per 1000 kcal ME.
 *
 * Derivation:
 *   nutrientDMPct is grams of nutrient per 100g dry matter (since % is g/100g).
 *   So per 1g DM there are nutrientDMPct/100 grams of nutrient.
 *   Per 1 kcal there are (nutrientDMPct/100) / (kcalPer100gDM/100)
 *                      = nutrientDMPct / kcalPer100gDM grams of nutrient.
 *   Per 1000 kcal: 1000 * nutrientDMPct / kcalPer100gDM grams.
 *
 * This is the unit AAFCO 2014 reference values are expressed in.
 */
export function gramsPer1000kcal(nutrientDMPct: number, kcalPer100gDM: number): number {
  if (kcalPer100gDM <= 0) {
    throw new Error(`gramsPer1000kcal: kcalPer100gDM must be > 0, got ${kcalPer100gDM}`);
  }
  if (nutrientDMPct < 0) {
    throw new Error(`gramsPer1000kcal: nutrientDMPct must be >= 0, got ${nutrientDMPct}`);
  }
  return (1000 * nutrientDMPct) / kcalPer100gDM;
}

/**
 * Calcium-to-phosphorus ratio. Both inputs must be in the same unit
 * (e.g. both as-fed %, or both DMB %, or both grams).
 *
 * AAFCO reference range for adult dogs: 1.0–2.0.
 * Returns 0 if phosphorus is 0 (caller should treat as "unknown").
 */
export function caPhosphorusRatio(calcium: number, phosphorus: number): number {
  if (calcium < 0 || phosphorus < 0) {
    throw new Error(`caPhosphorusRatio: inputs must be >= 0, got Ca=${calcium} P=${phosphorus}`);
  }
  if (phosphorus === 0) return 0;
  return calcium / phosphorus;
}

/**
 * Estimate moisture % when the label doesn't state it.
 *
 * Per the design call: consumer UX needs a fallback rather than null/blank.
 * These are AAFCO-typical averages for each food type. Callers MUST surface
 * "estimated from food type — label did not state" in the UI when this is used.
 */
export function defaultMoisturePct(foodType: string): number {
  switch (foodType) {
    case 'kibble':
      return 10;
    case 'wet_food':
    case 'wet':
      return 78;
    case 'raw':
      return 70;
    case 'freeze_dried':
      return 5;
    case 'home_cooked':
      return 65;
    case 'treat':
      return 12;
    case 'supplement':
      return 5;
    default:
      return 10;
  }
}

/**
 * Estimate kcal/100g (as-fed) from macros using the modified Atwater factors
 * AAFCO uses for pet food: 3.5 kcal/g protein, 8.5 kcal/g fat, 3.5 kcal/g carbs.
 *
 * Carbs are computed as 100 - (protein + fat + fiber + moisture + ash) when ash
 * is unknown, default to 6% — typical for commercial pet foods.
 *
 * Returns null if any required input is missing — caller decides on fallback.
 */
export function estimateKcalPer100g(input: {
  proteinPct: number | null;
  fatPct: number | null;
  fiberPct?: number | null;
  moisturePct?: number | null;
  ashPct?: number | null;
}): number | null {
  const { proteinPct, fatPct } = input;
  if (proteinPct == null || fatPct == null) return null;

  const fiber = input.fiberPct ?? 3;
  const moisture = input.moisturePct ?? 10;
  const ash = input.ashPct ?? 6;

  const carbs = Math.max(0, 100 - proteinPct - fatPct - fiber - moisture - ash);
  return proteinPct * 3.5 + fatPct * 8.5 + carbs * 3.5;
}

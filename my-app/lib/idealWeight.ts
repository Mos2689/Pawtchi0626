/**
 * Ideal-weight estimator — deterministic, offline, BCS-first with breed-band
 * reconciliation.
 *
 * Design principle: the current weight is a MEASUREMENT, never an error.
 * Data-entry mistakes are caught upstream at the input step (weightBounds
 * hard/soft bounds in body-basics). By the time a weight reaches this module
 * it is treated as the pet's real condition, and the job here is assessment:
 * classify it, estimate the scientifically appropriate ideal, and hand the
 * plan math to the caller. Out-of-band weights produce an advisory and a
 * band-clamped target — they never block.
 *
 * Method (AAHA 2021 / WSAVA weight-management guidelines, Purina BCS):
 *   1. Growth gate — puppies/kittens don't get an adult-style ideal weight.
 *   2. BCS-derived estimate is the primary signal:
 *        bcsEstimate = currentKg / (1 + perPoint × (bcs − 5))
 *      Dogs use 10%/point; cats 12%/point above BCS 5.
 *   3. Breed reference band (breedData weightRange, sex-aware, widened
 *      ×[0.8, 1.2] for frame variation) reconciles the estimate: inside the
 *      band it stands as-is; outside, the final ideal clamps to the nearest
 *      band edge at low confidence with a vet advisory.
 *   4. Staged targets in BOTH directions: the first actionable target never
 *      moves more than ±12% from current (AAHA staged-loss practice; the
 *      mirror cap on gains respects refeeding safety).
 *   5. Classification (underweight/ideal/overweight/obese) comes from BCS,
 *      overridden by band position when the scale grossly contradicts the
 *      owner's score — owner BCS is least reliable exactly then.
 */

import { getBreedDefaults, SizeCategory } from './breedData';
import { SAFE_PCT_PER_WEEK } from './weightLossRate';

export type Species = 'dog' | 'cat';
export type Sex = 'male' | 'female' | null | undefined;

export interface IdealWeightInput {
  species: Species;
  breed: string | null | undefined;
  sex: Sex;
  /** Total age in months. `null`/`undefined` treated as adult of unknown age. */
  ageMonths: number | null | undefined;
  currentWeightKg: number;
  /** Owner-reported BCS on the 1–9 Purina scale. `null` if not asked. */
  bcs: number | null | undefined;
}

export type IdealWeightMode = 'ok' | 'growth' | 'invalid';
export type WeightClassification = 'underweight' | 'ideal' | 'overweight' | 'obese';
export type WeightSeverity = 'none' | 'severe';

export interface IdealWeightBand {
  low: number;
  high: number;
}

export interface IdealWeightResult {
  mode: IdealWeightMode;
  /** First actionable target in kg (staged if the final ideal is >12% away). */
  targetKg?: number;
  /** Reconciled final ideal in kg (band-clamped when out of band). */
  finalIdealKg?: number;
  /** True when targetKg is a staged first step rather than the final ideal. */
  staged?: boolean;
  /** 'high' when the BCS estimate sat inside the breed band; 'low' otherwise. */
  confidence?: 'high' | 'low';
  /** The expanded breed band used for reconciliation (when breed is known). */
  band?: IdealWeightBand;
  /** Raw BCS-only estimate, pre-clamp — kept for transparency/analytics. */
  bcsEstimate?: number;
  /** Health assessment of the CURRENT weight. */
  classification?: WeightClassification;
  /** 'severe' cases should surface the vet-acknowledgment checkbox. */
  severity?: WeightSeverity;
  /** Non-blocking vet advisory; null when the inputs agree. */
  advisory?: string | null;
  /** finalIdealKg − currentWeightKg (signed; negative = needs to lose). */
  deltaKg?: number;
  /** Species-safe weekly change rate, % of body weight (AAHA/WSAVA). */
  safeWeeklyPct?: number;
  /** Rough weeks to reach finalIdealKg at the safe rate. 0 when at ideal. */
  estimatedWeeks?: number;
  /** Machine reason tag for analytics / UI switching. */
  reason?: string;
  /** Short human-readable explanation — mirrors the number, never contradicts it. */
  explanation: string;
}

/** Minimum age (months) at which we treat an animal as adult for ideal-weight purposes. */
export function adultAgeMonths(species: Species, size: SizeCategory | undefined): number {
  if (species === 'cat') return 12;
  switch (size) {
    case 'giant': return 18;
    case 'large': return 15;
    default: return 12; // toy/small/medium/undefined
  }
}

/** Per-BCS-point excess-body-weight fraction. Species- and side-aware. */
function bcsPerPoint(species: Species, bcs: number): number {
  if (species === 'cat' && bcs > 5) return 0.12;
  return 0.10;
}

/**
 * Compute the sex-aware breed band from `breedData.ts`, widened by the frame-
 * variation tolerance. Returns `null` when the breed is unknown/mixed AND we
 * have no weight anchor to synthesize a band from.
 */
export function getBreedBand(
  species: Species,
  breed: string | null | undefined,
  sex: Sex,
  currentWeightKg: number | null | undefined,
): IdealWeightBand | null {
  const defaults = getBreedDefaults(species, breed, currentWeightKg ?? null);
  if (!defaults) return null;
  const { weightRange } = defaults;
  // Guard against the mixed-breed fallback returning a zero-range when weight
  // wasn't supplied — a [0,0] band would mark every non-zero input low-confidence.
  const hasMale = weightRange.male[1] > 0;
  const hasFemale = weightRange.female[1] > 0;
  if (!hasMale && !hasFemale) return null;

  let low: number;
  let high: number;
  if (sex === 'male' && hasMale) {
    [low, high] = weightRange.male;
  } else if (sex === 'female' && hasFemale) {
    [low, high] = weightRange.female;
  } else {
    // Unknown sex → union of both sides so we don't over-flag either sex.
    low = Math.min(hasMale ? weightRange.male[0] : Infinity, hasFemale ? weightRange.female[0] : Infinity);
    high = Math.max(hasMale ? weightRange.male[1] : 0, hasFemale ? weightRange.female[1] : 0);
  }
  // ±20% frame-variation tolerance — individual healthy frames vary well
  // beyond the published show-standard range.
  return { low: low * 0.8, high: high * 1.2 };
}

/** Round to 0.1 kg for small pets, 0.5 kg otherwise — display precision. */
export function roundTargetKg(kg: number): number {
  return kg < 10 ? Math.round(kg * 10) / 10 : Math.round(kg * 2) / 2;
}

/**
 * Proportional slider bounds for the goal-screen target-weight slider.
 *
 * Anchors to the reconciled breed band (padded ±10%) when available so a
 * 45 kg Lab and a 3 kg cat get slider ranges appropriate to their scale, and
 * unions with `current × [0.85, 1.15]` so the current weight is always
 * within reach. Step size drops to 0.1 kg for pets under 10 kg — a 3 kg cat
 * cannot express its 0.3 kg target at 0.5-kg increments.
 *
 * Pure so it can be unit-tested against the smoke cases without a device.
 */
export function computeSliderBounds(
  species: Species,
  currentWeightKg: number,
  band: IdealWeightBand | null | undefined,
): { min: number; max: number; step: number } {
  const hardMin = species === 'cat' ? 0.3 : 0.5;
  const proportionalLo = Math.max(hardMin, currentWeightKg * 0.7);
  const proportionalHi = currentWeightKg * 1.3;
  const bandLo = band ? band.low * 0.9 : proportionalLo;
  const bandHi = band ? band.high * 1.1 : proportionalHi;
  const min = Math.max(hardMin, Math.min(bandLo, proportionalLo, currentWeightKg * 0.85));
  const max = Math.max(bandHi, proportionalHi, currentWeightKg * 1.15);
  const step = currentWeightKg < 10 ? 0.1 : 0.5;
  return { min, max, step };
}

/**
 * Static exercise line per classification. Deliberately gentle: activity is
 * an assist, not the engine, of weight change — MER math already accounts
 * for activity level, and severe cases are vet-supervised anyway.
 */
export function activitySuggestion(species: Species, classification: WeightClassification): string {
  if (species === 'cat') {
    switch (classification) {
      case 'obese': return 'Start with short daily play sessions — a few minutes counts.';
      case 'overweight': return 'Two 10-minute play sessions a day — wand toys work wonders.';
      case 'underweight': return 'Keep play gentle until your vet gives the all-clear.';
      default: return 'Keep the current routine — it’s working.';
    }
  }
  switch (classification) {
    case 'obese': return 'Short, frequent walks to start — build up gently as the weight comes off.';
    case 'overweight': return 'Add two 15-minute walks a day — steady beats intense.';
    case 'underweight': return 'Keep exercise light until your vet gives the all-clear.';
    default: return 'Keep the current routine — it’s working.';
  }
}

/** Classification from BCS bands: 1–3 under, 4–5 ideal, 6–7 over, 8–9 obese. */
function classificationFromBcs(bcs: number): WeightClassification {
  if (bcs <= 3) return 'underweight';
  if (bcs <= 5) return 'ideal';
  if (bcs <= 7) return 'overweight';
  return 'obese';
}

/**
 * Band-position override: when the scale grossly contradicts the owner's BCS,
 * trust the scale for the classification (owners systematically under-score).
 */
function reconcileClassification(
  base: WeightClassification,
  currentKg: number,
  band: IdealWeightBand | null,
): WeightClassification {
  if (!band) return base;
  if (currentKg < band.low) return 'underweight';
  if (currentKg > band.high * 1.25) return 'obese';
  if (currentKg > band.high) return base === 'obese' ? 'obese' : 'overweight';
  return base;
}

/** Timeline plan-math shared by the BCS and no-BCS paths. */
function planMath(species: Species, currentKg: number, finalIdealKg: number): {
  deltaKg: number; safeWeeklyPct: number; estimatedWeeks: number;
} {
  const deltaKg = Math.round((finalIdealKg - currentKg) * 10) / 10;
  const safeWeeklyPct = SAFE_PCT_PER_WEEK[species];
  const estimatedWeeks = Math.abs(deltaKg) < 0.05
    ? 0
    : Math.ceil((Math.abs(deltaKg) / currentKg) * 100 / safeWeeklyPct);
  return { deltaKg, safeWeeklyPct, estimatedWeeks };
}

// First actionable target never moves more than ±12% from current weight.
const STAGE_FRACTION = 0.12;

export function estimateIdealWeight(input: IdealWeightInput): IdealWeightResult {
  const { species, breed, sex, ageMonths, currentWeightKg, bcs } = input;

  if (!Number.isFinite(currentWeightKg) || currentWeightKg <= 0) {
    return { mode: 'invalid', reason: 'invalid_current_weight', explanation: 'Enter a valid current weight to see the target.' };
  }

  const defaults = getBreedDefaults(species, breed, currentWeightKg);
  const size = defaults?.sizeCategory;
  const adultAt = adultAgeMonths(species, size);

  // Growth gate — ideal weight isn't a meaningful concept for a growing animal.
  if (typeof ageMonths === 'number' && Number.isFinite(ageMonths) && ageMonths < adultAt) {
    return {
      mode: 'growth',
      reason: 'still_growing',
      band: getBreedBand(species, breed, sex, currentWeightKg) ?? undefined,
      explanation: species === 'cat' ? 'Growing kitten — focus on healthy portions, not a target' : 'Growing puppy — focus on healthy portions, not a target',
    };
  }

  const band = getBreedBand(species, breed, sex, currentWeightKg);
  const breedName = breed && breed !== 'Mixed Breed' && breed !== 'Mixed Breed / Domestic Shorthair' && breed !== 'Other' ? breed : null;
  const speciesWord = species === 'cat' ? 'cat' : 'dog';
  const frameWord = breedName ?? speciesWord;
  // Mixed/unknown breeds get a SYNTHETIC band anchored to current weight
  // (getMixedBreedDefaults) — reconciling the estimate against it is circular
  // and would clamp legitimate BCS-driven targets. Only real-breed bands are
  // used for reconciliation/classification; the synthetic band still feeds
  // the slider via `band` in the result.
  const reconBand = breedName ? band : null;

  // ── No BCS: breed-band midpoint at low confidence, or hold current. ──
  if (bcs == null || !Number.isFinite(bcs)) {
    const finalIdealRaw = reconBand ? (reconBand.low + reconBand.high) / 2 : currentWeightKg;
    const classification = reconcileClassification('ideal', currentWeightKg, reconBand);
    const severity: WeightSeverity =
      (reconBand && currentWeightKg < reconBand.low) || classification === 'obese' ? 'severe' : 'none';
    const { target, staged } = applyStaging(currentWeightKg, finalIdealRaw);
    return {
      mode: 'ok',
      targetKg: roundTargetKg(target),
      finalIdealKg: roundTargetKg(finalIdealRaw),
      staged,
      confidence: 'low',
      band: band ?? undefined,
      classification,
      severity,
      advisory: null,
      ...planMath(species, currentWeightKg, finalIdealRaw),
      reason: reconBand ? 'breed_midpoint_no_bcs' : 'no_signal',
      explanation: reconBand
        ? `Typical ${frameWord} — set a body shape for a personalized target`
        : 'Set a body shape to personalize this target',
    };
  }

  // ── BCS path: estimate → band-reconcile → classify → stage. ──
  const clampedBcs = Math.max(1, Math.min(9, bcs));
  const perPoint = bcsPerPoint(species, clampedBcs);
  const bcsEstimateRaw = currentWeightKg / (1 + perPoint * (clampedBcs - 5));

  // Reconcile against the band by CLAMPING, never by refusing. An out-of-band
  // estimate means the frame reference and the owner's assessment disagree —
  // the honest answer is the nearest edge of the healthy range, flagged
  // low-confidence with a vet advisory.
  let finalIdealRaw = bcsEstimateRaw;
  let advisory: string | null = null;
  let confidence: 'high' | 'low' = reconBand ? 'high' : 'low';
  let reason = clampedBcs === 5 ? 'bcs_ideal' : clampedBcs < 5 ? 'bcs_underweight' : 'bcs_overweight';
  if (reconBand && bcsEstimateRaw < reconBand.low) {
    finalIdealRaw = reconBand.low;
    confidence = 'low';
    reason = 'clamped_to_band_low';
    advisory = `Well below the typical ${frameWord} range — we’ve set a safe recovery target. Please involve your vet.`;
  } else if (reconBand && bcsEstimateRaw > reconBand.high) {
    finalIdealRaw = reconBand.high;
    confidence = 'low';
    reason = 'clamped_to_band_high';
    advisory = `Well above the typical ${frameWord} range — we’ve set the target at the top of the healthy range. Please involve your vet.`;
  }

  const classification = reconcileClassification(classificationFromBcs(clampedBcs), currentWeightKg, reconBand);
  // Severe = vet-supervision territory: grossly under the healthy band
  // (recovery feeding), emaciation (BCS 1–2), or obesity (BCS 8–9 / scale
  // >25% above the band even when the owner under-scored).
  const severity: WeightSeverity =
    (reconBand && currentWeightKg < reconBand.low) || clampedBcs <= 2 || clampedBcs >= 8 || classification === 'obese'
      ? 'severe'
      : 'none';

  const { target, staged } = applyStaging(currentWeightKg, finalIdealRaw);

  const explanation = staged
    ? `First-stage target — we’ll re-check as they progress toward ${roundTargetKg(finalIdealRaw)} kg`
    : `Ideal for an adult ${frameWord} at body condition ${clampedBcs}`;

  return {
    mode: 'ok',
    targetKg: roundTargetKg(target),
    finalIdealKg: roundTargetKg(finalIdealRaw),
    staged,
    confidence,
    band: band ?? undefined,
    bcsEstimate: roundTargetKg(bcsEstimateRaw),
    classification,
    severity,
    advisory,
    ...planMath(species, currentWeightKg, finalIdealRaw),
    reason,
    explanation,
  };
}

/**
 * Approximate number of ±12% stages between current and final ideal — powers
 * the "Milestone 1 of ~N" framing on the goal screen. Mirrors applyStaging's
 * multiplicative ladder: each stage re-anchors to the weight the previous one
 * reached, so loss stages shrink by (1 − f) and gain stages grow by (1 + f).
 */
export function stageCount(currentKg: number, finalIdealKg: number): number {
  if (!Number.isFinite(currentKg) || currentKg <= 0) return 1;
  if (!Number.isFinite(finalIdealKg) || finalIdealKg <= 0) return 1;
  const ratio = finalIdealKg / currentKg;
  if (ratio === 1) return 1;
  const perStage = ratio > 1 ? Math.log(1 + STAGE_FRACTION) : -Math.log(1 - STAGE_FRACTION);
  // Epsilon absorbs float noise at exact stage multiples (e.g. ratio = 0.88).
  return Math.max(1, Math.ceil(Math.abs(Math.log(ratio)) / perStage - 1e-9));
}

/**
 * Stage the first actionable target: never more than ±12% from current.
 * Distant single-jump targets fail behaviorally (AAHA staged-loss practice)
 * and, on the gain side, violate refeeding safety.
 */
function applyStaging(currentKg: number, finalIdealKg: number): { target: number; staged: boolean } {
  const lossFloor = currentKg * (1 - STAGE_FRACTION);
  const gainCeil = currentKg * (1 + STAGE_FRACTION);
  if (finalIdealKg < lossFloor) return { target: lossFloor, staged: true };
  if (finalIdealKg > gainCeil) return { target: gainCeil, staged: true };
  return { target: finalIdealKg, staged: false };
}

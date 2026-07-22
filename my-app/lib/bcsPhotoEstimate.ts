/**
 * Photo-based BCS suggestion — pure gating and reconciliation logic.
 *
 * The estimate-bcs edge function returns a sanitized raw read of the pet's
 * photo (a BCS band + visibility/quality facts). This module decides whether
 * that read is trustworthy enough to SUGGEST a silhouette on the goal screen,
 * and which of the five picker buckets it maps to.
 *
 * Design principles:
 *  - The AI never writes `bodyConditionScore`; it pre-selects a card the
 *    owner confirms with a tap. Everything here is advisory.
 *  - Gate on observable facts (full body visible, band width), not just the
 *    model's self-reported confidence — LLM confidence is poorly calibrated.
 *  - Deterministic cross-check against the breed weight band: when the photo
 *    read grossly contradicts what the scale says, suppress the suggestion —
 *    coat and camera angle fail exactly where the scale is most reliable.
 *
 * Kept free of React Native / Expo imports so it runs under jest;
 * the network call lives in `bcsPhotoEstimateClient.ts`.
 */

import { getBreedBand, Sex, Species } from './idealWeight';

/** Sanitized response shape from the estimate-bcs edge function. */
export interface BcsPhotoEstimateRaw {
  pet_visible: boolean;
  full_body_visible: boolean;
  is_side_profile: boolean;
  is_standing: boolean;
  coat_length: 'short' | 'medium' | 'long' | null;
  photo_quality_issues: string[];
  bcs_low: number | null;
  bcs_high: number | null;
  confidence: number;
  visual_indicators: string[];
  reasoning_short: string | null;
}

/** The five silhouette buckets of the picker (see lib/bcsOptions.ts). */
export type BcsBucket = 3 | 5 | 7 | 8 | 9;

export interface BcsPhotoSuggestion {
  /** Picker bucket to pre-highlight. */
  bucket: BcsBucket;
  /** Raw model band, kept for analytics/persistence. */
  bandLow: number;
  bandHigh: number;
  confidence: number;
  /** Concrete visual cues, e.g. "visible waist tuck from above". */
  indicators: string[];
}

export type BcsSuggestionSuppressedReason =
  | 'no_pet'
  | 'not_full_body'
  | 'no_band'
  | 'band_too_wide'
  | 'low_confidence'
  | 'scale_conflict';

export interface BcsSuggestionDecision {
  suggestion: BcsPhotoSuggestion | null;
  /** Why no suggestion is shown; null when `suggestion` is set. */
  suppressedReason: BcsSuggestionSuppressedReason | null;
}

/** How the confirmed BCS was arrived at — persisted for calibration analytics. */
export type BcsSource = 'owner' | 'ai_confirmed' | 'ai_overridden' | 'vet_report' | 'guided_check';

// Gate thresholds. Confidence is the model's belief the true BCS falls in a
// usefully narrow band; the width cap keeps the band inside at most two
// adjacent picker buckets so the pre-selection isn't a coin flip.
export const MIN_SUGGESTION_CONFIDENCE = 0.7;
export const MAX_SUGGESTION_BAND_WIDTH = 2;

/** Map a 1-9 BCS onto the picker's five silhouette buckets. */
export function bucketForBcs(bcs: number): BcsBucket {
  if (bcs <= 3) return 3;
  if (bcs <= 5) return 5;
  if (bcs <= 7) return 7;
  if (bcs <= 8) return 8;
  return 9;
}

export interface BcsSuggestionContext {
  species: Species;
  breed: string | null | undefined;
  sex: Sex;
  currentWeightKg: number;
}

// Only real-breed bands can veto the photo read. Mixed/unknown breeds get a
// synthetic band anchored to the current weight (see idealWeight.ts), which
// would make the cross-check circular.
function realBreedName(breed: string | null | undefined): string | null {
  if (!breed || breed === 'Mixed Breed' || breed === 'Mixed Breed / Domestic Shorthair' || breed === 'Other') {
    return null;
  }
  return breed;
}

/**
 * Decide whether a raw photo estimate becomes a picker suggestion.
 * Pure — call it at display time so the cross-check always uses the live
 * weight/breed, even if the owner edited them after the photo was analyzed.
 */
export function deriveBcsSuggestion(
  raw: BcsPhotoEstimateRaw,
  ctx: BcsSuggestionContext,
): BcsSuggestionDecision {
  if (!raw.pet_visible) return { suggestion: null, suppressedReason: 'no_pet' };
  if (!raw.full_body_visible) return { suggestion: null, suppressedReason: 'not_full_body' };
  if (raw.bcs_low == null || raw.bcs_high == null) {
    return { suggestion: null, suppressedReason: 'no_band' };
  }
  if (raw.bcs_high - raw.bcs_low > MAX_SUGGESTION_BAND_WIDTH) {
    return { suggestion: null, suppressedReason: 'band_too_wide' };
  }
  if (raw.confidence < MIN_SUGGESTION_CONFIDENCE) {
    return { suggestion: null, suppressedReason: 'low_confidence' };
  }

  // Scale cross-check: the photo says thin while the scale sits above the
  // healthy breed band (or the mirror case). That combination is the coat /
  // camera-angle failure signature — the suggestion would anchor the owner
  // to exactly the wrong silhouette.
  if (Number.isFinite(ctx.currentWeightKg) && ctx.currentWeightKg > 0 && realBreedName(ctx.breed)) {
    const band = getBreedBand(ctx.species, ctx.breed, ctx.sex, ctx.currentWeightKg);
    if (band) {
      const photoSaysThin = raw.bcs_high <= 4;
      const photoSaysHeavy = raw.bcs_low >= 7;
      if (photoSaysThin && ctx.currentWeightKg > band.high) {
        return { suggestion: null, suppressedReason: 'scale_conflict' };
      }
      if (photoSaysHeavy && ctx.currentWeightKg < band.low) {
        return { suggestion: null, suppressedReason: 'scale_conflict' };
      }
    }
  }

  const midpoint = Math.round((raw.bcs_low + raw.bcs_high) / 2);
  return {
    suggestion: {
      bucket: bucketForBcs(midpoint),
      bandLow: raw.bcs_low,
      bandHigh: raw.bcs_high,
      confidence: raw.confidence,
      indicators: raw.visual_indicators,
    },
    suppressedReason: null,
  };
}

/**
 * Resolve the persisted `bcs_source` for a confirmed score. A suggestion the
 * owner saw and matched is a confirmation; one they saw and picked past is an
 * override; no suggestion means the pick is theirs alone.
 */
export function resolveBcsSource(
  pickedBcs: number,
  suggestion: BcsPhotoSuggestion | null,
): BcsSource {
  if (!suggestion) return 'owner';
  return pickedBcs === suggestion.bucket ? 'ai_confirmed' : 'ai_overridden';
}

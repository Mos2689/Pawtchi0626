/**
 * Photo BCS suggestion gating — the rules that decide whether an AI photo
 * read is allowed to pre-highlight a silhouette on the goal screen.
 *
 * The invariant under test: anything short of a confident, full-body,
 * scale-consistent read renders as NO suggestion (the picker ships exactly
 * as before the feature existed). The AI never writes the score.
 */

import {
  bucketForBcs,
  deriveBcsSuggestion,
  resolveBcsSource,
  BcsPhotoEstimateRaw,
  BcsSuggestionContext,
  MIN_SUGGESTION_CONFIDENCE,
} from './bcsPhotoEstimate';

function raw(overrides: Partial<BcsPhotoEstimateRaw> = {}): BcsPhotoEstimateRaw {
  return {
    pet_visible: true,
    full_body_visible: true,
    is_side_profile: true,
    is_standing: true,
    coat_length: 'short',
    photo_quality_issues: [],
    bcs_low: 6,
    bcs_high: 7,
    confidence: 0.8,
    visual_indicators: ['waist barely visible from above'],
    reasoning_short: 'Waist is barely visible and ribs are covered.',
    ...overrides,
  };
}

function ctx(overrides: Partial<BcsSuggestionContext> = {}): BcsSuggestionContext {
  return {
    species: 'dog',
    breed: 'Mixed Breed',
    sex: 'male',
    currentWeightKg: 20,
    ...overrides,
  };
}

describe('bucketForBcs', () => {
  it('maps the 9-point scale onto the five picker buckets', () => {
    expect(bucketForBcs(1)).toBe(3);
    expect(bucketForBcs(3)).toBe(3);
    expect(bucketForBcs(4)).toBe(5);
    expect(bucketForBcs(5)).toBe(5);
    expect(bucketForBcs(6)).toBe(7);
    expect(bucketForBcs(7)).toBe(7);
    expect(bucketForBcs(8)).toBe(8);
    expect(bucketForBcs(9)).toBe(9);
  });
});

describe('deriveBcsSuggestion — quality gates', () => {
  it('suggests on a confident full-body read', () => {
    const { suggestion, suppressedReason } = deriveBcsSuggestion(raw(), ctx());
    expect(suppressedReason).toBeNull();
    expect(suggestion).not.toBeNull();
    expect(suggestion!.bucket).toBe(7); // midpoint of 6–7 rounds to 7
    expect(suggestion!.bandLow).toBe(6);
    expect(suggestion!.bandHigh).toBe(7);
    expect(suggestion!.indicators).toEqual(['waist barely visible from above']);
  });

  it('suppresses when no pet is in the photo (cartoon avatars included)', () => {
    const { suggestion, suppressedReason } = deriveBcsSuggestion(
      raw({ pet_visible: false }),
      ctx(),
    );
    expect(suggestion).toBeNull();
    expect(suppressedReason).toBe('no_pet');
  });

  it('suppresses face close-ups — full body is a hard requirement', () => {
    const { suggestion, suppressedReason } = deriveBcsSuggestion(
      raw({ full_body_visible: false }),
      ctx(),
    );
    expect(suggestion).toBeNull();
    expect(suppressedReason).toBe('not_full_body');
  });

  it('suppresses when the model returned no band', () => {
    const { suppressedReason } = deriveBcsSuggestion(
      raw({ bcs_low: null, bcs_high: null }),
      ctx(),
    );
    expect(suppressedReason).toBe('no_band');
  });

  it('suppresses a band too wide to map to adjacent buckets', () => {
    // 4–7 spans three picker buckets — a coin flip, not a suggestion.
    const { suppressedReason } = deriveBcsSuggestion(
      raw({ bcs_low: 4, bcs_high: 7 }),
      ctx(),
    );
    expect(suppressedReason).toBe('band_too_wide');
  });

  it('suppresses below the confidence threshold', () => {
    const { suppressedReason } = deriveBcsSuggestion(
      raw({ confidence: MIN_SUGGESTION_CONFIDENCE - 0.01 }),
      ctx(),
    );
    expect(suppressedReason).toBe('low_confidence');
  });
});

describe('deriveBcsSuggestion — scale cross-check', () => {
  // The coat/camera-angle failure signature: photo and scale disagree
  // grossly. Only REAL breed bands may veto — mixed-breed bands are
  // synthesized from the current weight, so checking against them is circular.

  it('suppresses "looks thin" when the scale sits far above the breed band', () => {
    const { suggestion, suppressedReason } = deriveBcsSuggestion(
      raw({ bcs_low: 3, bcs_high: 4 }),
      ctx({ breed: 'Labrador Retriever', currentWeightKg: 100 }),
    );
    expect(suggestion).toBeNull();
    expect(suppressedReason).toBe('scale_conflict');
  });

  it('suppresses "looks heavy" when the scale sits far below the breed band', () => {
    const { suggestion, suppressedReason } = deriveBcsSuggestion(
      raw({ bcs_low: 7, bcs_high: 8 }),
      ctx({ breed: 'Labrador Retriever', currentWeightKg: 5 }),
    );
    expect(suggestion).toBeNull();
    expect(suppressedReason).toBe('scale_conflict');
  });

  it('does not cross-check mixed breeds — their band is weight-anchored', () => {
    const { suggestion } = deriveBcsSuggestion(
      raw({ bcs_low: 3, bcs_high: 3 }),
      ctx({ breed: 'Mixed Breed', currentWeightKg: 100 }),
    );
    expect(suggestion).not.toBeNull();
    expect(suggestion!.bucket).toBe(3);
  });

  it('allows agreement: heavy photo read + heavy scale', () => {
    const { suggestion, suppressedReason } = deriveBcsSuggestion(
      raw({ bcs_low: 8, bcs_high: 9 }),
      ctx({ breed: 'Labrador Retriever', currentWeightKg: 55 }),
    );
    expect(suppressedReason).toBeNull();
    expect(suggestion!.bucket).toBe(9); // midpoint 8.5 rounds to 9
  });
});

describe('resolveBcsSource', () => {
  const suggestion = {
    bucket: 7 as const,
    bandLow: 6,
    bandHigh: 7,
    confidence: 0.8,
    indicators: [],
  };

  it('is owner when no suggestion was shown', () => {
    expect(resolveBcsSource(7, null)).toBe('owner');
  });

  it('is ai_confirmed when the pick matches the suggested bucket', () => {
    expect(resolveBcsSource(7, suggestion)).toBe('ai_confirmed');
  });

  it('is ai_overridden when the pick differs', () => {
    expect(resolveBcsSource(5, suggestion)).toBe('ai_overridden');
  });
});

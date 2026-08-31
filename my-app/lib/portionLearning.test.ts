import {
  isValidLearnedPortion,
  pickSuggestionFromHistory,
  SUGGEST_THRESHOLD,
  type LearnedPortion,
} from './portionLearning';
import { getPortionBounds, getPortionPresets } from './pantryMath';

// Bounds are always derived from real presets rather than hand-written, so a
// change to the stepper's range is caught here instead of silently widening
// what learning is willing to replay.
const weightBounds = getPortionBounds(
  getPortionPresets('gram', 'dog', null, {
    kcalPerServing: 120,
    kcalPer100g: 120,
    labelGramsPerServing: 100,
  }),
);
const countBounds = getPortionBounds(getPortionPresets('piece', 'dog', null));
const fractionBounds = getPortionBounds(getPortionPresets('cup', 'dog', 'medium'));

const weight = (grams: number): LearnedPortion => ({ mode: 'weight', quantity: grams });
const count = (pieces: number): LearnedPortion => ({ mode: 'count', quantity: pieces, gramsFed: pieces * 10 });
const fraction = (mult: number): LearnedPortion => ({ mode: 'fraction', quantity: mult, gramsFed: mult * 200 });

describe('bounds are mode-specific, not universal', () => {
  // A single global cap cannot serve all three modes: 20 pieces is legitimate,
  // and a small-serving weight item legitimately exceeds 4x its serving.
  test('count mode allows up to 20 pieces', () => {
    expect(countBounds.max).toBe(20);
    expect(isValidLearnedPortion(count(20), countBounds)).toBe(true);
    expect(isValidLearnedPortion(count(21), countBounds)).toBe(false);
  });

  test('weight mode is bounded in grams, not multiples', () => {
    expect(weightBounds.mode).toBe('weight');
    expect(weightBounds.min).toBe(5);
    expect(weightBounds.max).toBe(500);
    expect(isValidLearnedPortion(weight(500), weightBounds)).toBe(true);
    expect(isValidLearnedPortion(weight(501), weightBounds)).toBe(false);
  });

  test('a small manufacturer serving may legitimately exceed 4x', () => {
    // 44.2 kcal per serving at 960.87 kcal/100g is a real supplement oil: a
    // ~5 g dose. Feeding 50 g is 10x the serving and must remain expressible.
    const smallServing = getPortionBounds(
      getPortionPresets('gram', 'dog', null, {
        kcalPerServing: 44.2,
        kcalPer100g: 960.87,
        labelGramsPerServing: 4.6,
      }),
    );
    expect(isValidLearnedPortion(weight(50), smallServing)).toBe(true);
  });

  test('fraction mode allows quarter-bowl through 4 bowls', () => {
    expect(isValidLearnedPortion(fraction(0.25), fractionBounds)).toBe(true);
    expect(isValidLearnedPortion(fraction(4), fractionBounds)).toBe(true);
    expect(isValidLearnedPortion(fraction(4.5), fractionBounds)).toBe(false);
  });
});

describe('isValidLearnedPortion rejects unusable entries', () => {
  test('legacy bare scalars are rejected on shape', () => {
    // This is the poisoned v1 shape. It carries no unit, so there is nothing to
    // validate it against and nothing to safely reinterpret it as.
    expect(isValidLearnedPortion(200, weightBounds)).toBe(false);
    expect(isValidLearnedPortion(1, weightBounds)).toBe(false);
    expect(isValidLearnedPortion(0.75, fractionBounds)).toBe(false);
  });

  test('a portion from a different mode is rejected', () => {
    // The owner re-scanned the food and it is now measured in grams; a saved
    // "3 pieces" no longer describes anything.
    expect(isValidLearnedPortion(count(3), weightBounds)).toBe(false);
    expect(isValidLearnedPortion(weight(100), countBounds)).toBe(false);
  });

  test('non-finite, negative and fractional-count quantities are rejected', () => {
    expect(isValidLearnedPortion(weight(Number.NaN), weightBounds)).toBe(false);
    expect(isValidLearnedPortion(weight(Infinity), weightBounds)).toBe(false);
    expect(isValidLearnedPortion(weight(-100), weightBounds)).toBe(false);
    expect(isValidLearnedPortion(count(2.5), countBounds)).toBe(false);
  });

  test('null, arrays and empty objects are rejected', () => {
    expect(isValidLearnedPortion(null, weightBounds)).toBe(false);
    expect(isValidLearnedPortion([200], weightBounds)).toBe(false);
    expect(isValidLearnedPortion({}, weightBounds)).toBe(false);
  });
});

describe('pickSuggestionFromHistory', () => {
  test('returns null when history is too short', () => {
    expect(pickSuggestionFromHistory([fraction(0.75)], fractionBounds)).toBeNull();
  });

  test('returns the repeated portion when the last N picks all match', () => {
    const picked = pickSuggestionFromHistory(
      [fraction(1), fraction(1), fraction(0.75), fraction(0.75)],
      fractionBounds,
      { threshold: SUGGEST_THRESHOLD },
    );
    expect(picked?.quantity).toBeCloseTo(0.75);
    expect(picked?.mode).toBe('fraction');
  });

  test('returns null when the picks disagree', () => {
    expect(pickSuggestionFromHistory([fraction(0.75), fraction(1.25)], fractionBounds)).toBeNull();
    expect(pickSuggestionFromHistory([weight(100), weight(150)], weightBounds)).toBeNull();
  });

  test('returns null when the repeated portion is already the default', () => {
    expect(
      pickSuggestionFromHistory([fraction(1), fraction(1)], fractionBounds, { defaultQuantity: 1 }),
    ).toBeNull();
  });

  // The regression that motivated the rewrite: the owner's device holds three
  // consecutive 200s from a build where a gram-unit bug produced a 200x
  // multiplier. Replaying that on a fixed build reproduces a 24,000 kcal meal.
  test('poisoned legacy history [200, 200, 200] yields no suggestion', () => {
    expect(pickSuggestionFromHistory([200, 200, 200], weightBounds)).toBeNull();
    expect(pickSuggestionFromHistory([200, 200, 200], fractionBounds)).toBeNull();
    expect(pickSuggestionFromHistory([200, 200, 200], countBounds)).toBeNull();
  });

  test('an out-of-range typed portion is refused too', () => {
    // Not just the legacy shape: a typed portion above the stepper's ceiling is
    // equally unreplayable, however it got there.
    expect(pickSuggestionFromHistory([weight(20000), weight(20000)], weightBounds)).toBeNull();
  });

  test('one invalid entry breaks the streak rather than being skipped', () => {
    // Filtering first would let two non-adjacent picks masquerade as
    // consecutive, which is a quieter way to resurrect a bad portion.
    expect(
      pickSuggestionFromHistory([weight(150), 200, weight(150)], weightBounds, { threshold: 2 }),
    ).toBeNull();
  });
});

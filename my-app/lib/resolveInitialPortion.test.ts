import {
  boundsInGrams,
  gramsToQuantity,
  learnedPortionToMultiplier,
  multiplierToLearnedPortion,
  quantityToGrams,
  resolveInitialPortion,
} from './resolveInitialPortion';
import { getPortionBounds, getPortionPresets } from './pantryMath';
import type { LearnedPortion } from './portionLearning';

// PRIME100 SPD Kangaroo & Pumpkin, the food from the original report:
// 120 kcal per serving, 120 kcal/100 g, so one serving is 100 g.
const gramPresets = getPortionPresets('gram', 'dog', null, {
  kcalPerServing: 120,
  kcalPer100g: 120,
  labelGramsPerServing: 100,
});
const piecePresets = getPortionPresets('piece', 'dog', null);
const bowlPresets = getPortionPresets('cup', 'dog', 'medium');

describe('resolveInitialPortion — the F1 regression', () => {
  // A device that logged 200 g on the pre-fix build stored the multiplier 200.
  // Applied naively that is 200 x 100 g = 20,000 g, which at 120 kcal/100 g is
  // 24,000 kcal: the original bug, reproduced on a patched build.
  test('a poisoned 200x learned portion cannot open the card at 20,000 g', () => {
    const poisoned = { mode: 'weight', quantity: 20000 } as LearnedPortion;
    const { gramsFed } = resolveInitialPortion(poisoned, gramPresets);

    expect(gramsFed).toBe(500); // the stepper's own ceiling
    expect(gramsFed).toBeLessThanOrEqual(boundsInGrams(getPortionBounds(gramPresets)).max);
  });

  test('the resulting kcal is bounded too', () => {
    const poisoned = { mode: 'weight', quantity: 20000 } as LearnedPortion;
    const { gramsFed } = resolveInitialPortion(poisoned, gramPresets);
    const kcal = Math.round((120 * gramsFed) / 100);

    expect(kcal).toBe(600);
    expect(kcal).toBeLessThan(24000);
  });

  test('a portion whose mode no longer matches is discarded, not reinterpreted', () => {
    // Saved as pieces, item is now measured in grams. Reinterpreting 3 as
    // 3 grams (or 3 servings) would both be wrong; falling back is the only
    // honest option.
    const stale = { mode: 'count', quantity: 3, gramsFed: 30 } as LearnedPortion;
    expect(resolveInitialPortion(stale, gramPresets).gramsFed).toBe(100);
  });

  test('no learned portion opens on one serving', () => {
    expect(resolveInitialPortion(null, gramPresets).gramsFed).toBe(100);
    expect(resolveInitialPortion(undefined, bowlPresets).gramsFed).toBe(200);
  });
});

describe('resolveInitialPortion — legitimate portions survive', () => {
  test('an in-range weight portion is applied as-is', () => {
    const learned = { mode: 'weight', quantity: 150 } as LearnedPortion;
    expect(resolveInitialPortion(learned, gramPresets).gramsFed).toBe(150);
  });

  test('a 20-piece portion is applied, not clamped to 4', () => {
    const learned = { mode: 'count', quantity: 20, gramsFed: 200 } as LearnedPortion;
    const { gramsFed } = resolveInitialPortion(learned, piecePresets);
    expect(gramsFed).toBe(200); // 20 pieces x 10 g
  });

  test('a sub-5 g supplement serving is not rounded away', () => {
    // Natural Animal Solutions Omega oil: 44.2 kcal per 4.6 g dose.
    const oilPresets = getPortionPresets('gram', 'dog', null, {
      kcalPerServing: 44.2,
      kcalPer100g: 960.87,
      labelGramsPerServing: 4.6,
    });
    const learned = { mode: 'weight', quantity: 25 } as LearnedPortion;
    expect(resolveInitialPortion(learned, oilPresets).gramsFed).toBe(25);
  });

  test('half a bowl stays half a bowl', () => {
    const learned = { mode: 'fraction', quantity: 0.5, gramsFed: 100 } as LearnedPortion;
    const { gramsFed, isCustom } = resolveInitialPortion(learned, bowlPresets);
    expect(gramsFed).toBe(100);
    expect(isCustom).toBe(false); // matches the "half bowl" chip
  });

  test('a portion between chips is flagged custom', () => {
    const learned = { mode: 'weight', quantity: 135 } as LearnedPortion;
    expect(resolveInitialPortion(learned, gramPresets).isCustom).toBe(true);
  });
});

describe('the owner’s declared usual outranks what we inferred', () => {
  const learned = { mode: 'weight', quantity: 150 } as LearnedPortion;
  const usual = { mode: 'weight', quantity: 250 } as LearnedPortion;

  test('a declared usual wins over the learned history', () => {
    // One is a statement; the other is an inference from a handful of taps.
    expect(resolveInitialPortion(learned, gramPresets, usual).gramsFed).toBe(250);
  });

  test('the learned portion still applies when nothing was declared', () => {
    expect(resolveInitialPortion(learned, gramPresets, null).gramsFed).toBe(150);
  });

  test('a declared usual is bounded exactly like everything else', () => {
    const poisoned = { mode: 'weight', quantity: 20000 } as LearnedPortion;
    expect(resolveInitialPortion(null, gramPresets, poisoned).gramsFed).toBe(500);
  });

  test('a declared usual in the wrong mode is discarded, not reinterpreted', () => {
    const stale = { mode: 'count', quantity: 3 } as LearnedPortion;
    // Falls through to the learned weight portion rather than reading "3" as grams.
    expect(resolveInitialPortion(learned, gramPresets, stale).gramsFed).toBe(150);
  });
});

describe('unit conversions round-trip', () => {
  test('weight quantity is grams, unconverted', () => {
    expect(quantityToGrams(200, 'weight', 100)).toBe(200);
    expect(gramsToQuantity(200, 'weight', 100)).toBe(200);
  });

  test('count and fraction scale by the unit weight', () => {
    expect(quantityToGrams(3, 'count', 10)).toBe(30);
    expect(quantityToGrams(0.5, 'fraction', 200)).toBe(100);
    expect(gramsToQuantity(30, 'count', 10)).toBe(3);
  });

  test('multiplier <-> portion round-trips in every mode', () => {
    const cases: { presets: ReturnType<typeof getPortionPresets>; multiplier: number }[] = [
      { presets: gramPresets, multiplier: 2 },
      { presets: piecePresets, multiplier: 3 },
      { presets: bowlPresets, multiplier: 0.5 },
    ];
    for (const { presets, multiplier } of cases) {
      const portion = multiplierToLearnedPortion(multiplier, presets);
      expect(learnedPortionToMultiplier(portion, presets)).toBeCloseTo(multiplier, 6);
    }
  });

  test('a 200x multiplier becomes a self-describing 20,000 g portion', () => {
    // The conversion itself is faithful — it is validation, not conversion,
    // that refuses the value. Recording it typed is what lets that happen.
    const portion = multiplierToLearnedPortion(200, gramPresets);
    expect(portion).toEqual({ mode: 'weight', quantity: 20000 });
  });
});

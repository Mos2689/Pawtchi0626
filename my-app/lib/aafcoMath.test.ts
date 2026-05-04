import {
  toDryMatterBasis,
  kcalPer100gDryMatter,
  gramsPer1000kcal,
  caPhosphorusRatio,
  defaultMoisturePct,
  estimateKcalPer100g,
} from './aafcoMath';

describe('toDryMatterBasis', () => {
  test('25% protein at 10% moisture → 27.78% DMB', () => {
    expect(toDryMatterBasis(25, 10)).toBeCloseTo(27.78, 2);
  });

  test('8% protein at 78% moisture (typical wet food) → 36.36% DMB', () => {
    expect(toDryMatterBasis(8, 78)).toBeCloseTo(36.36, 2);
  });

  test('wet food beats kibble on DMB protein when label looks lower', () => {
    // Real-world bug fix: wet food at 8%/78% looks "lower protein" than
    // 25%/10% kibble until you do the DMB conversion.
    const wetDMB = toDryMatterBasis(8, 78);
    const kibbleDMB = toDryMatterBasis(25, 10);
    expect(wetDMB).toBeGreaterThan(kibbleDMB);
  });

  test('throws on moisture >= 100', () => {
    expect(() => toDryMatterBasis(25, 100)).toThrow();
    expect(() => toDryMatterBasis(25, 105)).toThrow();
  });

  test('throws on negative inputs', () => {
    expect(() => toDryMatterBasis(25, -5)).toThrow();
    expect(() => toDryMatterBasis(-1, 10)).toThrow();
  });
});

describe('kcalPer100gDryMatter', () => {
  test('366 kcal/100g at 10% moisture → ~407 kcal/100g DM', () => {
    expect(kcalPer100gDryMatter(366, 10)).toBeCloseTo(406.67, 1);
  });

  test('100 kcal/100g at 78% moisture (wet food) → ~454.5 kcal/100g DM', () => {
    expect(kcalPer100gDryMatter(100, 78)).toBeCloseTo(454.55, 1);
  });

  test('throws on invalid moisture', () => {
    expect(() => kcalPer100gDryMatter(366, 100)).toThrow();
  });
});

describe('gramsPer1000kcal', () => {
  test('28% protein DMB at 400 kcal/100g DM → 70g protein per 1000 kcal', () => {
    // Hand-derivation:
    //   per 100g DM: 28g protein at 400 kcal → 28/400 = 0.07 g/kcal → 70 g/1000 kcal
    expect(gramsPer1000kcal(28, 400)).toBeCloseTo(70, 5);
  });

  test('1% calcium DMB at 400 kcal/100g DM → 2.5 g/1000 kcal', () => {
    expect(gramsPer1000kcal(1, 400)).toBeCloseTo(2.5, 5);
  });

  test('throws on zero or negative kcal', () => {
    expect(() => gramsPer1000kcal(28, 0)).toThrow();
    expect(() => gramsPer1000kcal(28, -1)).toThrow();
  });
});

describe('caPhosphorusRatio', () => {
  test('1.2% Ca / 1.0% P → 1.2 ratio', () => {
    expect(caPhosphorusRatio(1.2, 1.0)).toBeCloseTo(1.2, 5);
  });

  test('returns 0 when phosphorus is 0 (caller treats as unknown)', () => {
    expect(caPhosphorusRatio(1.2, 0)).toBe(0);
  });

  test('throws on negative inputs', () => {
    expect(() => caPhosphorusRatio(-1, 1)).toThrow();
  });
});

describe('defaultMoisturePct', () => {
  test('kibble defaults to 10%', () => {
    expect(defaultMoisturePct('kibble')).toBe(10);
  });

  test('wet_food defaults to 78%', () => {
    expect(defaultMoisturePct('wet_food')).toBe(78);
    expect(defaultMoisturePct('wet')).toBe(78);
  });

  test('unknown food type falls back to 10%', () => {
    expect(defaultMoisturePct('martian_jerky')).toBe(10);
  });
});

describe('estimateKcalPer100g', () => {
  test('returns null if protein or fat missing', () => {
    expect(estimateKcalPer100g({ proteinPct: null, fatPct: 15 })).toBeNull();
    expect(estimateKcalPer100g({ proteinPct: 25, fatPct: null })).toBeNull();
  });

  test('typical kibble (25% protein, 15% fat) → ~340 kcal/100g', () => {
    const kcal = estimateKcalPer100g({
      proteinPct: 25,
      fatPct: 15,
      fiberPct: 3,
      moisturePct: 10,
      ashPct: 6,
    });
    // protein 25*3.5 + fat 15*8.5 + carbs 41*3.5 = 87.5 + 127.5 + 143.5 = 358.5
    expect(kcal).not.toBeNull();
    expect(kcal!).toBeGreaterThan(300);
    expect(kcal!).toBeLessThan(420);
  });
});

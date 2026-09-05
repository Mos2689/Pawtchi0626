import { resolveScanKcal } from './mealLogKcal';

/**
 * The cases here are two real packets that used to fail.
 *
 * A Royal Canin Medium Puppy bag prints a feeding table in cups and grams per
 * day and no energy figure at all on the back panel — nothing to derive from,
 * so the owner has to be asked. A Prime100 SPD tin prints "Typical ME: 475
 * kcal/100g" and a tray weight — two printed numbers that fully determine the
 * third.
 *
 * Both used to end at "Couldn't read that photo". Only the first one is
 * genuinely a gap.
 */
describe('resolveScanKcal', () => {
  it('uses the label’s own per-serving figure when it states one', () => {
    expect(
      resolveScanKcal({ calories_per_serving: 364, kcal_per_100g_as_fed: 400, serving_grams: 100 }),
    ).toEqual({ kcalPerServing: 364, basis: 'label_serving' });
  });

  it('never overwrites a stated figure with the density product', () => {
    // 400 × 100 / 100 = 400, but the packet says 364. Preferring the derived
    // value would fabricate agreement and disarm the three-way cross-check.
    const { kcalPerServing } = resolveScanKcal({
      calories_per_serving: 364,
      kcal_per_100g_as_fed: 400,
      serving_grams: 100,
    });
    expect(kcalPerServing).toBe(364);
  });

  it('derives per-serving kcal from density × serving weight', () => {
    expect(
      resolveScanKcal({ calories_per_serving: null, kcal_per_100g_as_fed: 475, serving_grams: 120 }),
    ).toEqual({ kcalPerServing: 570, basis: 'label_density' });
  });

  it('reports a gap when the packet prints a density but no serving weight', () => {
    expect(
      resolveScanKcal({ calories_per_serving: null, kcal_per_100g_as_fed: 475, serving_grams: null }),
    ).toEqual({ kcalPerServing: null, basis: 'unknown' });
  });

  it('reports a gap when the packet prints neither', () => {
    // The Royal Canin back panel: a feeding table, no kcal anywhere.
    expect(
      resolveScanKcal({ calories_per_serving: null, kcal_per_100g_as_fed: null, serving_grams: null }),
    ).toEqual({ kcalPerServing: null, basis: 'unknown' });
  });

  it('refuses a derived figure that lands outside a real serving', () => {
    // A kcal/kg value that was never divided by ten, against a 400 g bowl.
    expect(
      resolveScanKcal({ calories_per_serving: null, kcal_per_100g_as_fed: 3650, serving_grams: 400 }),
    ).toEqual({ kcalPerServing: null, basis: 'unknown' });
  });

  it('handles a small supplement dose without rounding it away', () => {
    expect(
      resolveScanKcal({ calories_per_serving: null, kcal_per_100g_as_fed: 500, serving_grams: 4.6 }),
    ).toEqual({ kcalPerServing: 23, basis: 'label_density' });
  });

  it('treats non-finite and non-positive inputs as absent', () => {
    for (const bad of [0, -1, NaN, Infinity, undefined, null]) {
      expect(resolveScanKcal({ calories_per_serving: bad as number }).basis).toBe('unknown');
      expect(
        resolveScanKcal({ kcal_per_100g_as_fed: bad as number, serving_grams: 100 }).basis,
      ).toBe('unknown');
      expect(
        resolveScanKcal({ kcal_per_100g_as_fed: 400, serving_grams: bad as number }).basis,
      ).toBe('unknown');
    }
    expect(resolveScanKcal(null).basis).toBe('unknown');
    expect(resolveScanKcal(undefined).basis).toBe('unknown');
  });
});

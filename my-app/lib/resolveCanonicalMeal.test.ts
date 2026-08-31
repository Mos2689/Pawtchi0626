import {
  energyAgrees,
  energyTolerance,
  massAgrees,
  massTolerance,
  resolveCanonicalMeal,
} from './mealLogKcal';
import { resolveServingWeight } from './pantryMath';
import type { PantryItem } from '../store/useActivePetStore';

// Shared with the pgTAP suite in stage 6. Both runtimes must agree on every
// vector, or the number on screen and the number in the database diverge the
// moment the server becomes the authoritative calculator.
const { vectors } = require('../supabase/tests/fixtures/kcal_vectors.json') as {
  vectors: Vector[];
};

interface Vector {
  name: string;
  why: string;
  item: Partial<PantryItem>;
  servings: number;
  opts: { species: 'dog' | 'cat'; bowl?: { size: 'small' | 'medium' | 'large' | 'xl' } };
  expect: {
    kcal: number;
    mealGrams: number | null;
    kcalBasis: string;
    labelConsistency: string;
    quality: string;
    portionMode: string;
    portionQuantity: number;
    unitBasis: string;
  };
}

const asItem = (over: Partial<PantryItem>): PantryItem => ({
  id: 'p1',
  pet_id: 'pet1',
  brand: 'Brand',
  product_name: 'Product',
  food_type: 'kibble',
  kcal_per_serving: null,
  kcal_per_100g_as_fed: null,
  moisture_pct: null,
  serving_unit: null,
  protein_pct: null,
  fat_pct: null,
  fibre_pct: null,
  key_ingredients: null,
  allergy_flags: null,
  is_primary: true,
  scan_count: 1,
  first_scanned_at: '',
  last_scanned_at: '',
  ...over,
});

/** The scan carries per-serving values; the pantry item overrides them. */
const scanFor = (item: PantryItem) => ({
  calories_per_serving: item.kcal_per_serving ?? 0,
  protein_g: 0,
  carbs_g: 0,
  fat_g: 0,
});

describe('golden vectors — TS and SQL must agree on every one', () => {
  test.each(vectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    const item = asItem(v.item);
    const meal = resolveCanonicalMeal(scanFor(item), item, v.servings, v.opts);

    expect(meal.kcal).toBe(v.expect.kcal);
    expect(meal.mealGrams).toBe(v.expect.mealGrams);
    expect(meal.kcalBasis).toBe(v.expect.kcalBasis);
    expect(meal.labelConsistency).toBe(v.expect.labelConsistency);
    expect(meal.quality).toBe(v.expect.quality);
    expect(meal.portion.mode).toBe(v.expect.portionMode);
    expect(meal.portion.quantity).toBeCloseTo(v.expect.portionQuantity, 6);
    expect(meal.portion.unitBasis).toBe(v.expect.unitBasis);
  });

  test('every vector explains why it exists', () => {
    // A fixture nobody can read is a fixture nobody maintains.
    for (const v of vectors) expect(v.why.length).toBeGreaterThan(20);
  });

  test('no vector persists a "default" basis', () => {
    // A default-derived figure may drive display guidance; it must never be
    // written as a meal without an owner confirming it.
    for (const v of vectors) expect(v.expect.kcalBasis).not.toBe('default');
  });
});

describe('verification cannot be circular', () => {
  const base: Partial<PantryItem> = {
    serving_unit: 'gram',
    kcal_per_serving: 120,
    kcal_per_100g_as_fed: 120,
    protein_pct: 9,
    label_consistency: 'consistent',
  };

  test('a derived serving weight blocks "verified" even when the DB says consistent', () => {
    const item = asItem({
      ...base,
      nutrition_provenance: { kcal_per_serving: 'label', kcal_per_100g_as_fed: 'label' },
    });
    const meal = resolveCanonicalMeal(scanFor(item), item, 1, { species: 'dog' });

    expect(meal.labelConsistency).toBe('consistent');
    expect(meal.nutritionSnapshot?.provenance.serving_grams).toBe('derived');
    expect(meal.quality).toBe('unverifiable');
  });

  test('adding the printed serving weight is what unlocks "verified"', () => {
    const item = asItem({
      ...base,
      serving_grams: 100,
      nutrition_provenance: {
        kcal_per_serving: 'label',
        kcal_per_100g_as_fed: 'label',
        serving_grams: 'label',
      },
    });
    expect(resolveCanonicalMeal(scanFor(item), item, 1, { species: 'dog' }).quality).toBe('verified');
  });

  test('an estimated density blocks it too', () => {
    const item = asItem({
      ...base,
      serving_grams: 100,
      nutrition_provenance: {
        kcal_per_serving: 'label',
        kcal_per_100g_as_fed: 'estimated',
        serving_grams: 'label',
      },
    });
    expect(resolveCanonicalMeal(scanFor(item), item, 1, { species: 'dog' }).quality).toBe('unverifiable');
  });

  test('the label consistency verdict is read, never recomputed', () => {
    // The database trigger owns it. A second implementation here would be a
    // second thing to drift, and the two would disagree exactly when it mattered.
    const item = asItem({ ...base, label_consistency: 'inconsistent' });
    expect(resolveCanonicalMeal(scanFor(item), item, 1, { species: 'dog' }).labelConsistency)
      .toBe('inconsistent');
  });
});

describe('an unmatched scan is honest about having nothing behind it', () => {
  test('no snapshot, estimated basis, unverifiable', () => {
    const meal = resolveCanonicalMeal(
      { calories_per_serving: 200, protein_g: 5, carbs_g: 10, fat_g: 3 },
      null,
      1.5,
    );
    expect(meal.kcal).toBe(300);
    expect(meal.mealGrams).toBeNull();
    expect(meal.nutritionSnapshot).toBeNull();
    expect(meal.kcalBasis).toBe('estimated');
    expect(meal.quality).toBe('unverifiable');
    expect(meal.source).toBe('scan');
  });
});

describe('a stated serving weight is never clamped', () => {
  test('4.6 g survives; a derived weight in the same range does not', () => {
    const stated = asItem({
      serving_unit: 'gram',
      kcal_per_serving: 44.2,
      kcal_per_100g_as_fed: 960.87,
      serving_grams: 4.6,
    });
    expect(resolveServingWeight(stated, { species: 'dog' }).grams).toBe(4.6);

    // Same food without the printed weight: the derivation is a guess, so it
    // keeps the sanity band and lands on the 5 g floor.
    const derived = asItem({
      serving_unit: 'gram',
      kcal_per_serving: 44.2,
      kcal_per_100g_as_fed: 960.87,
    });
    const d = resolveServingWeight(derived, { species: 'dog' });
    expect(d.grams).toBe(5);
    expect(d.provenance).toBe('derived');
  });
});

describe('tolerances are dimensional', () => {
  test('mass and energy have separate rules', () => {
    // A single max(2 g, 2 kcal, 4%) compares a mass with an energy, which is
    // meaningless. These never mix.
    expect(massTolerance(100)).toBeCloseTo(2);
    expect(massTolerance(10)).toBeCloseTo(1); // absolute floor dominates
    expect(energyTolerance(1000)).toBeCloseTo(30);
    expect(energyTolerance(50)).toBeCloseTo(5); // absolute floor dominates
  });

  test('label rounding is inside tolerance, a real error is not', () => {
    expect(massAgrees(100, 101)).toBe(true);
    expect(massAgrees(100, 140)).toBe(false);
    expect(energyAgrees(240, 245)).toBe(true);
    expect(energyAgrees(240, 24000)).toBe(false);
  });
});

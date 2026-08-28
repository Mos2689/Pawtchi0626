import {
  computePantryMacros,
  getPortionPresets,
  BOWL_SIZE_GRAMS,
  DEFAULT_SERVING_GRAMS_BY_SPECIES,
  DEFAULT_GRAM_SERVING_GRAMS,
} from './pantryMath';
import type { PantryItem } from '../store/useActivePetStore';

const baseItem = (over: Partial<PantryItem> = {}): PantryItem => ({
  id: 'p1',
  pet_id: 'pet1',
  brand: 'BrandX',
  product_name: 'Chicken',
  food_type: 'kibble',
  kcal_per_serving: 100,
  kcal_per_100g_as_fed: 400,
  moisture_pct: 10,
  serving_unit: 'cup',
  protein_pct: 26,
  fat_pct: 14,
  fibre_pct: 3,
  key_ingredients: ['Chicken'],
  allergy_flags: null,
  is_primary: true,
  scan_count: 1,
  first_scanned_at: '',
  last_scanned_at: '',
  ...over,
});

describe('computePantryMacros — bowl mode', () => {
  test('uses bowl grams for cup-unit items when a bowl size is given', () => {
    // small bowl = 100g, density 400 kcal/100g → 400 kcal for a full bowl.
    const r = computePantryMacros(baseItem(), 1, { species: 'dog', bowl: { size: 'small' } });
    expect(r.meal_grams).toBe(BOWL_SIZE_GRAMS.small);
    expect(r.total_kcal).toBe(400);
  });

  test('half a bowl is half the kcal', () => {
    const full = computePantryMacros(baseItem(), 1, { bowl: { size: 'medium' } });
    const half = computePantryMacros(baseItem(), 0.5, { bowl: { size: 'medium' } });
    expect(half.total_kcal).toBe(Math.round(full.total_kcal * 0.5));
    expect(half.meal_grams).toBe(Math.round(full.meal_grams * 0.5));
  });

  test('bowl mode is ignored for non-cup units (e.g. pouch)', () => {
    const r = computePantryMacros(baseItem({ serving_unit: 'pouch' }), 1, { bowl: { size: 'large' } });
    // Pouch → species table, not the bowl table.
    expect(r.meal_grams).toBe(DEFAULT_SERVING_GRAMS_BY_SPECIES.dog.pouch);
  });
});

describe('computePantryMacros — species defaults', () => {
  test('cat cup is smaller than dog cup', () => {
    expect(DEFAULT_SERVING_GRAMS_BY_SPECIES.cat.cup).toBeLessThan(
      DEFAULT_SERVING_GRAMS_BY_SPECIES.dog.cup,
    );
  });

  test('a cat pouch resolves to the cat table weight', () => {
    const r = computePantryMacros(baseItem({ serving_unit: 'pouch' }), 1, { species: 'cat' });
    expect(r.meal_grams).toBe(DEFAULT_SERVING_GRAMS_BY_SPECIES.cat.pouch);
  });

  test('falls back to dog table when species not provided', () => {
    const r = computePantryMacros(baseItem({ serving_unit: 'pouch' }), 1);
    expect(r.meal_grams).toBe(DEFAULT_SERVING_GRAMS_BY_SPECIES.dog.pouch);
  });
});

// `serving_unit: 'gram'` means the label quotes calories for a stated weight
// (usually 100 g) — not for a single gram. Treating one serving as 1 g turned a
// 50 g portion into 50 servings: 350 kcal logged as 17,500.
describe('computePantryMacros — gram-unit items', () => {
  const gramItem = (over: Partial<PantryItem> = {}) =>
    baseItem({ serving_unit: 'gram', kcal_per_serving: 350, kcal_per_100g_as_fed: 350, ...over });

  test('one serving is the label serving weight, not one gram', () => {
    const r = computePantryMacros(gramItem(), 1, { species: 'dog' });
    expect(r.meal_grams).toBe(100);
    expect(r.total_kcal).toBe(350);
  });

  test('half a label serving is half the calories', () => {
    const r = computePantryMacros(gramItem(), 0.5, { species: 'dog' });
    expect(r.meal_grams).toBe(50);
    expect(r.total_kcal).toBe(175);
  });

  test('kcal/100g stays a real density', () => {
    // Previously (servingKcal / 1g) × 100 → 35,000 kcal per 100 g.
    const r = computePantryMacros(
      gramItem({ kcal_per_100g_as_fed: null }),
      1,
      { species: 'dog' },
    );
    expect(r.kcal_per_100g).toBeLessThan(1000);
  });

  test('a denser food has a smaller serving weight for the same kcal', () => {
    // 350 kcal per serving at 700 kcal/100 g → the serving is 50 g.
    const r = computePantryMacros(gramItem({ kcal_per_100g_as_fed: 700 }), 1, { species: 'dog' });
    expect(r.meal_grams).toBe(50);
    expect(r.total_kcal).toBe(350);
  });

  test('missing label data falls back to a 100 g serving, not 1 g', () => {
    const r = computePantryMacros(
      gramItem({ kcal_per_serving: null as unknown as number, kcal_per_100g_as_fed: null }),
      1,
      { species: 'dog' },
    );
    expect(r.meal_grams).toBe(DEFAULT_GRAM_SERVING_GRAMS);
  });
});

// MealHero sends `gramsFed / gramsPerUnit` as the multiplier and
// computePantryMacros consumes it. If the two disagree about what one serving
// weighs, the kcal is wrong by exactly that ratio.
describe('chip presets and macro math agree on the serving weight', () => {
  const cases: { unit: string; item: Partial<PantryItem> }[] = [
    { unit: 'cup', item: { serving_unit: 'cup' } },
    { unit: 'pouch', item: { serving_unit: 'pouch' } },
    { unit: 'piece', item: { serving_unit: 'piece' } },
    { unit: 'gram', item: { serving_unit: 'gram', kcal_per_serving: 350, kcal_per_100g_as_fed: 350 } },
  ];

  test.each(cases)('$unit: every preset logs the kcal its chip promises', ({ item }) => {
    const pantryItem = baseItem(item);
    const presets = getPortionPresets(pantryItem.serving_unit, 'dog', null, {
      kcalPer100g: pantryItem.kcal_per_100g_as_fed,
      kcalPerServing: pantryItem.kcal_per_serving,
      labelGramsPerServing:
        pantryItem.kcal_per_serving && pantryItem.kcal_per_100g_as_fed
          ? (pantryItem.kcal_per_serving * 100) / pantryItem.kcal_per_100g_as_fed
          : null,
    });

    for (const chip of presets.presets) {
      const multiplier = chip.gramsFed / presets.gramsPerUnit;
      const macros = computePantryMacros(pantryItem, multiplier, { species: 'dog' });
      // The grams the chip promised are the grams the log records.
      expect(macros.meal_grams).toBe(Math.round(chip.gramsFed));
      // And the calories track the label density, never an order of magnitude out.
      expect(macros.total_kcal).toBe(
        Math.round((pantryItem.kcal_per_serving ?? 350) * multiplier),
      );
    }
  });

  test('a 50 g portion of a 350 kcal/100 g food is 175 kcal, not 17,500', () => {
    const pantryItem = baseItem({
      serving_unit: 'gram',
      kcal_per_serving: 350,
      kcal_per_100g_as_fed: 350,
    });
    const presets = getPortionPresets('gram', 'dog', null, {
      kcalPer100g: 350,
      kcalPerServing: 350,
      labelGramsPerServing: 100,
    });
    const multiplier = 50 / presets.gramsPerUnit;
    expect(computePantryMacros(pantryItem, multiplier, { species: 'dog' }).total_kcal).toBe(175);
  });

  test('the weight-mode stepper still moves in 5 g steps', () => {
    const presets = getPortionPresets('gram', 'dog', null, {
      kcalPer100g: 350,
      kcalPerServing: 350,
      labelGramsPerServing: 100,
    });
    // MealHero converts chip-native stepper units to grams via gramsPerUnit.
    expect(presets.stepper.step * presets.gramsPerUnit).toBeCloseTo(5, 6);
    expect(presets.stepper.min * presets.gramsPerUnit).toBeCloseTo(5, 6);
    expect(presets.stepper.max * presets.gramsPerUnit).toBeCloseTo(500, 6);
  });
});

import {
  computePantryMacros,
  BOWL_SIZE_GRAMS,
  DEFAULT_SERVING_GRAMS_BY_SPECIES,
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

import {
  resolveLoggedTotals,
  resolvePantrySourceId,
  sanitiseServings,
  AUTO_MATCH_TRUST_THRESHOLD,
  type ScanMacroSource,
} from './mealLogKcal';
import type { PantryItem } from '../store/useActivePetStore';

const pantry = (over: Partial<PantryItem> = {}): PantryItem => ({
  id: 'p1',
  pet_id: 'pet1',
  brand: 'Pedigree',
  product_name: 'Adult With Real Beef',
  food_type: 'kibble',
  kcal_per_serving: 350,
  kcal_per_100g_as_fed: 350,
  moisture_pct: 10,
  serving_unit: 'cup',
  protein_pct: 21,
  fat_pct: 10,
  fibre_pct: 4,
  key_ingredients: ['Beef'],
  allergy_flags: null,
  is_primary: true,
  scan_count: 1,
  first_scanned_at: '',
  last_scanned_at: '',
  ...over,
});

const scan = (over: Partial<ScanMacroSource> = {}): ScanMacroSource => ({
  calories_per_serving: 350,
  protein_g: 21,
  carbs_g: 47,
  fat_g: 10,
  kcal_per_100g_as_fed: 350,
  moisture_pct: 10,
  protein_pct: 21,
  fat_pct: 10,
  fibre_pct: 4,
  ...over,
});

// The reported bug: an owner tapped Less / Usual / More / Custom on the same
// food and every log landed at an identical 350 kcal, because the multiplier
// was only applied when a pantry item had been picked by hand.
describe('portion multiplier reaches the logged kcal', () => {
  const PORTIONS = [
    { label: 'Less', servings: 0.75, expected: 263 },
    { label: 'Usual', servings: 1, expected: 350 },
    { label: 'More', servings: 1.25, expected: 438 },
    { label: 'Custom 0.5', servings: 0.5, expected: 175 },
    { label: 'Custom 2.25', servings: 2.25, expected: 788 },
  ];

  test.each(PORTIONS)('unmatched scan · $label → $expected kcal', ({ servings, expected }) => {
    const totals = resolveLoggedTotals(scan(), null, servings);
    expect(totals.totalCalories).toBe(expected);
    expect(totals.source).toBe('scan');
  });

  test.each(PORTIONS)('pantry-backed · $label → $expected kcal', ({ servings, expected }) => {
    // No bowl context → per-serving label kcal drives the math.
    const totals = resolveLoggedTotals(scan(), pantry(), servings, { species: 'dog' });
    expect(totals.totalCalories).toBe(expected);
    expect(totals.source).toBe('pantry');
  });

  test('every portion produces a distinct total (the regression itself)', () => {
    const totals = PORTIONS.map(p => resolveLoggedTotals(scan(), null, p.servings).totalCalories);
    expect(new Set(totals).size).toBe(PORTIONS.length);
  });

  test('macros scale with the portion, not just calories', () => {
    const more = resolveLoggedTotals(scan(), null, 1.25);
    expect(more.protein_g).toBeCloseTo(26.3, 1);
    expect(more.carbs_g).toBeCloseTo(58.8, 1);
    expect(more.fat_g).toBeCloseTo(12.5, 1);
  });

  test('a pantry item with no label kcal still scales off the fallback', () => {
    // 350 is the no-label fallback in computePantryMacros — it must not be a
    // fixed number that every portion collapses onto.
    const item = pantry({ kcal_per_serving: null as unknown as number, kcal_per_100g_as_fed: null });
    expect(resolveLoggedTotals(scan(), item, 0.5, { species: 'dog' }).totalCalories).toBe(175);
    expect(resolveLoggedTotals(scan(), item, 1.5, { species: 'dog' }).totalCalories).toBe(525);
  });
});

describe('bowl-fraction portions', () => {
  const opts = { species: 'dog' as const, bowl: { size: 'medium' as const } };

  test('¼ / ½ / full bowl are proportional', () => {
    const quarter = resolveLoggedTotals(scan(), pantry(), 0.25, opts).totalCalories;
    const half = resolveLoggedTotals(scan(), pantry(), 0.5, opts).totalCalories;
    const full = resolveLoggedTotals(scan(), pantry(), 1, opts).totalCalories;
    // medium bowl = 200 g at 350 kcal/100 g → 700 kcal full.
    expect(full).toBe(700);
    expect(half).toBe(350);
    expect(quarter).toBe(175);
  });

  test('the receipt reads true: perServing × servings === total', () => {
    // The result screen renders "N × 1.25 = M kcal" off these two calls.
    const perServing = resolveLoggedTotals(scan(), pantry(), 1, opts).totalCalories;
    const total = resolveLoggedTotals(scan(), pantry(), 1.25, opts).totalCalories;
    expect(total).toBe(Math.round(perServing * 1.25));
  });
});

describe('sanitiseServings', () => {
  test.each([
    [NaN, 1],
    [Infinity, 1],
    [0, 1],
    [-2, 1],
    [undefined, 1],
    [null, 1],
    [0.75, 0.75],
    [3, 3],
  ])('%p → %p', (input, expected) => {
    expect(sanitiseServings(input)).toBe(expected);
  });

  test('a broken multiplier logs one honest serving, never 0 or NaN', () => {
    const totals = resolveLoggedTotals(scan(), null, NaN);
    expect(totals.totalCalories).toBe(350);
    expect(Number.isNaN(totals.totalCalories)).toBe(false);
  });
});

describe('resolvePantrySourceId', () => {
  test('an explicit owner pick always wins', () => {
    const id = resolvePantrySourceId(
      { matched_pantry_id: 'auto', match_confidence: 0.99 },
      'chosen',
    );
    expect(id).toBe('chosen');
  });

  test('a trusted auto-match is used when there is no explicit pick', () => {
    const id = resolvePantrySourceId(
      { matched_pantry_id: 'auto', match_confidence: AUTO_MATCH_TRUST_THRESHOLD },
      null,
    );
    expect(id).toBe('auto');
  });

  test('a weak auto-match is refused', () => {
    const id = resolvePantrySourceId(
      { matched_pantry_id: 'auto', match_confidence: AUTO_MATCH_TRUST_THRESHOLD - 0.01 },
      null,
    );
    expect(id).toBeNull();
  });

  test('a food-type mismatch is refused however confident the match', () => {
    const id = resolvePantrySourceId(
      { matched_pantry_id: 'auto', match_confidence: 0.99, food_type_mismatch: true },
      null,
    );
    expect(id).toBeNull();
  });

  test('no match and no pick resolves to nothing', () => {
    expect(resolvePantrySourceId({}, null)).toBeNull();
    expect(resolvePantrySourceId(null, null)).toBeNull();
    expect(resolvePantrySourceId(undefined, undefined)).toBeNull();
  });

  test('an auto-matched scan is still portion-scaled once resolved', () => {
    // The auto-match path is what produced the four identical 350s: the id was
    // known but never reached the log, so the multiplier was dropped.
    const sourceId = resolvePantrySourceId({ matched_pantry_id: 'p1', match_confidence: 0.8 }, null);
    expect(sourceId).toBe('p1');
    const totals = resolveLoggedTotals(scan(), pantry({ id: sourceId! }), 0.75, { species: 'dog' });
    expect(totals.totalCalories).toBe(263);
  });
});

describe('degenerate scan data', () => {
  test('a non-numeric calorie value logs 0 rather than NaN', () => {
    const totals = resolveLoggedTotals(
      scan({ calories_per_serving: NaN }),
      null,
      1.25,
    );
    expect(totals.totalCalories).toBe(0);
  });

  test('missing macros default to 0, not undefined', () => {
    const totals = resolveLoggedTotals(
      { calories_per_serving: 100 },
      null,
      2,
    );
    expect(totals).toMatchObject({ totalCalories: 200, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });

  test('negative calories never credit the daily total', () => {
    const totals = resolveLoggedTotals(scan({ calories_per_serving: -50 }), null, 2);
    expect(totals.totalCalories).toBe(0);
  });
});

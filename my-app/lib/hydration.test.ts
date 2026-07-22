import {
  classifyDietMoisture,
  computeWaterTargetMl,
  waterPerSessionMl,
  dietTagsFromPantry,
} from './hydration';

describe('classifyDietMoisture', () => {
  test('empty/unknown → dry (preserves historical full target)', () => {
    expect(classifyDietMoisture(null)).toBe('dry');
    expect(classifyDietMoisture(undefined)).toBe('dry');
    expect(classifyDietMoisture([])).toBe('dry');
    expect(classifyDietMoisture(['freeze_dried'])).toBe('dry');
  });

  test('kibble-only → dry', () => {
    expect(classifyDietMoisture(['kibble'])).toBe('dry');
    expect(classifyDietMoisture(['Dry food'])).toBe('dry');
  });

  test('wet-only diets → wet', () => {
    expect(classifyDietMoisture(['wet_food'])).toBe('wet');
    expect(classifyDietMoisture(['raw'])).toBe('wet');
    expect(classifyDietMoisture(['human_food'])).toBe('wet');
    expect(classifyDietMoisture(['Canned'])).toBe('wet');
  });

  test('wet + dry → mixed', () => {
    expect(classifyDietMoisture(['kibble', 'wet_food'])).toBe('mixed');
  });
});

describe('computeWaterTargetMl', () => {
  test('28kg dry-fed dog → 1400 ml (weight × 50, the legacy target)', () => {
    expect(computeWaterTargetMl(28, ['kibble'])).toBe(1400);
    expect(computeWaterTargetMl(28, null)).toBe(1400);
  });

  test('wet-fed pet → 40% of total (food supplies the rest)', () => {
    expect(computeWaterTargetMl(4, ['wet_food'])).toBe(80); // 4kg cat: 200 × 0.4
  });

  test('mixed diet → 70% of total', () => {
    expect(computeWaterTargetMl(10, ['kibble', 'wet_food'])).toBe(350);
  });

  test('rounded to nearest 10 ml', () => {
    expect(computeWaterTargetMl(4.3, ['kibble']) % 10).toBe(0);
  });

  test('no weight → 0', () => {
    expect(computeWaterTargetMl(0, ['kibble'])).toBe(0);
    expect(computeWaterTargetMl(null)).toBe(0);
  });
});

describe('waterPerSessionMl', () => {
  test('3 × session ≈ daily target (the 934ml-of-1.4L bug guard)', () => {
    const target = computeWaterTargetMl(28, null);
    const session = waterPerSessionMl(28, null);
    expect(Math.abs(session * 3 - target)).toBeLessThanOrEqual(2); // rounding only
  });
});

describe('dietTagsFromPantry', () => {
  test('meal items become sorted unique tags; treats/supplements ignored', () => {
    const tags = dietTagsFromPantry([
      { food_type: 'wet_food' },
      { food_type: 'kibble' },
      { food_type: 'kibble' },
      { food_type: 'treat' },
      { food_type: 'supplement' },
    ]);
    expect(tags).toEqual(['kibble', 'wet_food']);
  });

  test('archived items are excluded', () => {
    expect(dietTagsFromPantry([{ food_type: 'wet_food', is_archived: true }])).toEqual([]);
  });

  test('empty pantry → no tags (sync keeps stored diet)', () => {
    expect(dietTagsFromPantry([])).toEqual([]);
    expect(dietTagsFromPantry(null)).toEqual([]);
  });

  test('treat-only pantry proves nothing about the diet', () => {
    expect(dietTagsFromPantry([{ food_type: 'treat' }])).toEqual([]);
  });
});

import { lookupSeedFood, listSeedFoods } from './pantrySeed';

describe('lookupSeedFood', () => {
  test('exact match returns confidence 1.0', () => {
    const result = lookupSeedFood('Royal Canin', 'Adult Medium', 'dog');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
    expect(result!.food.kcal_per_100g).toBe(366);
  });

  test('case + punctuation tolerant', () => {
    const result = lookupSeedFood('royal canin', 'adult-medium', 'dog');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBe(1.0);
  });

  test('substring product name matches at 0.85', () => {
    const result = lookupSeedFood('Royal Canin', 'Adult Medium 15kg Bag', 'dog');
    expect(result).not.toBeNull();
    expect(result!.confidence).toBeGreaterThanOrEqual(0.7);
  });

  test('brand mismatch returns null', () => {
    const result = lookupSeedFood('Made-up Brand', 'Adult Medium', 'dog');
    expect(result).toBeNull();
  });

  test('species filter works (dog catalog excludes cat results)', () => {
    const dogResult = lookupSeedFood('Royal Canin', 'Indoor Adult', 'dog');
    expect(dogResult).toBeNull(); // Indoor Adult is a cat product
    const catResult = lookupSeedFood('Royal Canin', 'Indoor Adult', 'cat');
    expect(catResult).not.toBeNull();
  });

  test('null/empty inputs return null', () => {
    expect(lookupSeedFood(null, 'Adult Medium')).toBeNull();
    expect(lookupSeedFood('Royal Canin', null)).toBeNull();
    expect(lookupSeedFood('', '')).toBeNull();
  });
});

describe('listSeedFoods', () => {
  test('returns all foods when no species filter', () => {
    expect(listSeedFoods().length).toBeGreaterThanOrEqual(10);
  });

  test('species filter narrows results', () => {
    const dogs = listSeedFoods('dog');
    const cats = listSeedFoods('cat');
    expect(dogs.every(f => f.species === 'dog')).toBe(true);
    expect(cats.every(f => f.species === 'cat')).toBe(true);
  });
});

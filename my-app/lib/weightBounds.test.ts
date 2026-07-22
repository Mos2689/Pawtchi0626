import { getWeightBoundsKg, validateWeight } from './weightBounds';
import { getBreedWeightRange } from './breedData';

describe('getBreedWeightRange (single source of truth)', () => {
  test('Labrador → 25–36 kg (union of female low and male high)', () => {
    expect(getBreedWeightRange('dog', 'Labrador Retriever')).toEqual({ lower: 25, upper: 36 });
  });

  test('unknown breed → null (caller falls back to species defaults)', () => {
    expect(getBreedWeightRange('dog', 'Absolutely Not A Real Breed')).toBeNull();
    expect(getBreedWeightRange('dog', null)).toBeNull();
  });

  test('weightBounds soft range mirrors breedData source (no drift)', () => {
    const range = getBreedWeightRange('dog', 'Beagle')!;
    const bounds = getWeightBoundsKg('dog', 'Beagle');
    expect(bounds.soft.low).toBe(range.lower * 0.5);
    expect(bounds.soft.high).toBe(range.upper * 1.5);
  });
});

describe('getWeightBoundsKg', () => {
  test('species-level dog bounds when no breed', () => {
    const b = getWeightBoundsKg('dog', null);
    expect(b.min).toBe(0.5);
    expect(b.max).toBe(100);
  });

  test('species-level cat bounds when no breed', () => {
    const b = getWeightBoundsKg('cat', null);
    expect(b.min).toBe(0.3);
    expect(b.max).toBe(15);
  });

  test('breed-aware soft bounds for Frenchie (9–13kg breed range → soft 4.5–19.5)', () => {
    const b = getWeightBoundsKg('dog', 'French Bulldog');
    expect(b.soft.low).toBe(4.5);
    expect(b.soft.high).toBe(19.5);
    expect(b.min).toBe(0.5);
    expect(b.max).toBe(100);
  });

  test('hard bounds always clamp soft bounds', () => {
    const b = getWeightBoundsKg('cat', 'Maine Coon');
    expect(b.soft.high).toBeLessThanOrEqual(b.max);
    expect(b.soft.low).toBeGreaterThanOrEqual(b.min);
  });
});

describe('validateWeight', () => {
  test('NaN / 0 / negative → invalid', () => {
    expect(validateWeight(NaN, 'dog').status).toBe('invalid');
    expect(validateWeight(0, 'dog').status).toBe('invalid');
    expect(validateWeight(-5, 'dog').status).toBe('invalid');
  });

  test('dog at 100kg+ → invalid (above hard max)', () => {
    expect(validateWeight(150, 'dog').status).toBe('invalid');
  });

  test('dog at 0.1kg → invalid (below hard min)', () => {
    expect(validateWeight(0.1, 'dog').status).toBe('invalid');
  });

  test('cat at 30kg → invalid (above cat hard max)', () => {
    expect(validateWeight(30, 'cat').status).toBe('invalid');
  });

  test('Frenchie at 12kg → ok', () => {
    expect(validateWeight(12, 'dog', 'French Bulldog').status).toBe('ok');
  });

  test('Frenchie at 25kg → soft warning (outside breed soft range but within species)', () => {
    expect(validateWeight(25, 'dog', 'French Bulldog').status).toBe('soft');
  });

  test('Frenchie at 2kg → soft warning (below breed soft range, above hard min)', () => {
    expect(validateWeight(2, 'dog', 'French Bulldog').status).toBe('soft');
  });

  test('unknown breed dog at 30kg → ok (species defaults)', () => {
    expect(validateWeight(30, 'dog', 'Mystery Mix').status).toBe('ok');
  });
});

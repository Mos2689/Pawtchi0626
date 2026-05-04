import { calculateRER, calculateDailyKcal, deriveGoal, getMERFactor } from './healthMath';

describe('calculateRER', () => {
  test('25kg dog → ~782.6 kcal (70 * 25^0.75)', () => {
    expect(calculateRER(25)).toBeCloseTo(782.62, 1);
  });

  test('5kg cat → ~234 kcal', () => {
    expect(calculateRER(5)).toBeCloseTo(234.06, 1);
  });

  test('1kg → 70 kcal exactly (1^0.75 = 1)', () => {
    expect(calculateRER(1)).toBeCloseTo(70, 5);
  });
});

describe('calculateDailyKcal — maintenance', () => {
  test('25kg neutered dog, normal activity → 1.6 * RER ≈ 1252', () => {
    const kcal = calculateDailyKcal(25, 'dog', true, 'normal', 'maintain');
    expect(kcal).toBe(Math.round(1.6 * 782.62));
  });

  test('5kg neutered cat, normal activity → 1.2 * RER ≈ 281', () => {
    const kcal = calculateDailyKcal(5, 'cat', true, 'normal', 'maintain');
    expect(kcal).toBe(Math.round(1.2 * 234.06));
  });
});

describe('calculateDailyKcal — weight-loss bug regression', () => {
  // The bug: weight-loss MER was computed against currentWeight, inflating
  // the daily target by the pet's excess mass. The fix uses targetWeight.
  test('35kg overweight Lab, target 28kg, dog, lose → uses RER(28), not RER(35)', () => {
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose', undefined, 1.0, 28);
    const expected = Math.round(1.0 * calculateRER(28));
    expect(kcal).toBe(expected);
    expect(kcal).toBeLessThan(Math.round(1.0 * calculateRER(35)));
  });

  test('6kg overweight cat, target 4kg, lose → 0.8 * RER(4)', () => {
    const kcal = calculateDailyKcal(6, 'cat', true, 'normal', 'lose', undefined, 1.0, 4);
    const expected = Math.round(0.8 * calculateRER(4));
    expect(kcal).toBe(expected);
  });

  test('lose without targetWeightKg falls back to current-weight calc (no crash)', () => {
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose');
    expect(kcal).toBe(Math.round(1.0 * calculateRER(35)));
  });

  test('lifeStageMultiplier still applies on weight-loss path', () => {
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose', undefined, 0.9, 28);
    const expected = Math.round(1.0 * calculateRER(28) * 0.9);
    expect(kcal).toBe(expected);
  });
});

describe('getMERFactor — puppy/kitten taper', () => {
  test('3-month puppy returns 2.5 regardless of activity/neuter', () => {
    expect(getMERFactor('dog', false, 'normal', 'maintain', 3)).toBe(2.5);
  });

  test('2-month kitten returns 2.5', () => {
    expect(getMERFactor('cat', false, 'normal', 'maintain', 2)).toBe(2.5);
  });

  test('adult dog (no ageMonths) uses neutered/intact baseline', () => {
    expect(getMERFactor('dog', true, 'normal', 'maintain')).toBeCloseTo(1.6, 5);
    expect(getMERFactor('dog', false, 'normal', 'maintain')).toBeCloseTo(1.8, 5);
  });
});

describe('deriveGoal', () => {
  test('target below current by more than threshold → lose', () => {
    expect(deriveGoal(35, 28)).toBe('lose');
  });

  test('target above current by more than threshold → gain', () => {
    expect(deriveGoal(8, 12)).toBe('gain');
  });

  test('target within threshold of current → maintain', () => {
    expect(deriveGoal(10, 10.3)).toBe('maintain');
    expect(deriveGoal(10, 9.7)).toBe('maintain');
  });

  test('null/undefined target → maintain', () => {
    expect(deriveGoal(10, null)).toBe('maintain');
    expect(deriveGoal(10, undefined)).toBe('maintain');
  });
});

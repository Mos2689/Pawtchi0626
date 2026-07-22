import { validateWeeklyLossRate } from './weightLossRate';

describe('validateWeeklyLossRate', () => {
  test('dog losing 1% over 7 days → safe', () => {
    const r = validateWeeklyLossRate(29.7, 30, 7, 'dog');
    expect(r.isLoss).toBe(true);
    expect(r.pctPerWeek).toBeCloseTo(1.0, 1);
    expect(r.status).toBe('safe');
  });

  test('dog losing 2% over 7 days → fast (between 1.5 and 3.0)', () => {
    const r = validateWeeklyLossRate(29.4, 30, 7, 'dog');
    expect(r.pctPerWeek).toBeCloseTo(2.0, 1);
    expect(r.status).toBe('fast');
  });

  test('dog losing 3.5% over 7 days → dangerous', () => {
    const r = validateWeeklyLossRate(28.95, 30, 7, 'dog');
    expect(r.pctPerWeek).toBeCloseTo(3.5, 1);
    expect(r.status).toBe('dangerous');
  });

  test('cat losing 1.5% over 7 days → fast (between 1.0 and 2.0)', () => {
    const r = validateWeeklyLossRate(4.43, 4.5, 7, 'cat');
    expect(r.pctPerWeek).toBeCloseTo(1.55, 1);
    expect(r.status).toBe('fast');
  });

  test('cat losing 2.5% over 7 days → dangerous (hepatic lipidosis risk)', () => {
    const r = validateWeeklyLossRate(4.39, 4.5, 7, 'cat');
    expect(r.pctPerWeek).toBeCloseTo(2.44, 1);
    expect(r.status).toBe('dangerous');
  });

  test('extrapolates correctly when days != 7', () => {
    // 1% over 3.5 days → 2% per week
    const r = validateWeeklyLossRate(29.7, 30, 3.5, 'dog');
    expect(r.pctPerWeek).toBeCloseTo(2.0, 1);
    expect(r.status).toBe('fast');
  });

  test('weight gain → status=safe, isLoss=false', () => {
    const r = validateWeeklyLossRate(31, 30, 7, 'dog');
    expect(r.isLoss).toBe(false);
    expect(r.status).toBe('safe');
  });

  test('invalid inputs → safe default', () => {
    expect(validateWeeklyLossRate(0, 30, 7, 'dog').status).toBe('safe');
    expect(validateWeeklyLossRate(30, -1, 7, 'dog').status).toBe('safe');
    expect(validateWeeklyLossRate(30, 30, 0, 'dog').status).toBe('safe');
    expect(validateWeeklyLossRate(NaN, 30, 7, 'dog').status).toBe('safe');
  });
});

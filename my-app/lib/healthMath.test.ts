import {
  calculateRER,
  calculateDailyKcal,
  deriveGoal,
  getMERFactor,
  pregnancyMultiplier,
  shouldBlockGrowthWeightLoss,
} from './healthMath';

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

  test('6kg overweight cat, target 4kg, lose → floored at RER(4)', () => {
    // Raw 0.8×RER(4) sits below the AAHA absolute-minimum floor of RER(target).
    // The floor holds; the target lifts to RER(4).
    const kcal = calculateDailyKcal(6, 'cat', true, 'normal', 'lose', undefined, 1.0, 4);
    expect(kcal).toBe(Math.round(calculateRER(4)));
  });

  test('lose without targetWeightKg falls back to current-weight calc (no crash)', () => {
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose');
    expect(kcal).toBe(Math.round(1.0 * calculateRER(35)));
  });

  test('lifeStageMultiplier applies but is floored at RER(target) for dogs', () => {
    // With senior 0.9× stacking, raw math = 1.0 × RER(28) × 0.9 = 0.9 × RER.
    // AAHA absolute-minimum rule: never below RER(target). Floor kicks in.
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose', undefined, 0.9, 28);
    expect(kcal).toBe(Math.round(calculateRER(28)));
    expect(kcal).toBeGreaterThan(Math.round(1.0 * calculateRER(28) * 0.9));
  });

  test('geriatric thrifty Lab weight loss respects RER(target) floor', () => {
    // Stacking senior (0.80) × thrifty (0.95) would put a 35kg Lab losing to
    // 28kg at ~0.76 × RER — muscle-wasting territory. Floor prevents that.
    const kcal = calculateDailyKcal(35, 'dog', true, 'normal', 'lose', undefined, 0.80, 28, 0.95);
    expect(kcal).toBe(Math.round(calculateRER(28)));
  });
});

describe('calculateDailyKcal — pregnancy math', () => {
  test('25kg intact Lab, week 3 pregnant → within 5% of normal intact maintenance', () => {
    const kcal = calculateDailyKcal(
      25, 'dog', false, 'normal', 'maintain', undefined, 1.0, null, 1.0, null, null,
      'pregnant', 3,
    );
    const maintenance = calculateDailyKcal(25, 'dog', false, 'normal', 'maintain');
    expect(Math.abs(kcal - maintenance) / maintenance).toBeLessThan(0.05);
  });

  test('25kg intact Lab, week 8 pregnant → ~1.5-1.65× maintenance', () => {
    const kcal = calculateDailyKcal(
      25, 'dog', false, 'normal', 'maintain', undefined, 1.0, null, 1.0, null, null,
      'pregnant', 8,
    );
    const maintenance = calculateDailyKcal(25, 'dog', false, 'normal', 'maintain');
    const ratio = kcal / maintenance;
    expect(ratio).toBeGreaterThanOrEqual(1.4);
    expect(ratio).toBeLessThanOrEqual(1.75);
  });

  test('4kg intact cat, week 7 pregnant → ~1.3-1.5× maintenance', () => {
    const kcal = calculateDailyKcal(
      4, 'cat', false, 'normal', 'maintain', undefined, 1.0, null, 1.0, null, null,
      'pregnant', 7,
    );
    const maintenance = calculateDailyKcal(4, 'cat', false, 'normal', 'maintain');
    const ratio = kcal / maintenance;
    expect(ratio).toBeGreaterThanOrEqual(1.25);
    expect(ratio).toBeLessThanOrEqual(1.55);
  });

  test('null pregnancy weeks defaults to mid-gestation and beats maintenance', () => {
    const kcal = calculateDailyKcal(
      25, 'dog', false, 'normal', 'maintain', undefined, 1.0, null, 1.0, null, null,
      'pregnant', null,
    );
    const maintenance = calculateDailyKcal(25, 'dog', false, 'normal', 'maintain');
    expect(kcal).toBeGreaterThan(maintenance);
  });

  test('pregnancyMultiplier — dog late gestation ramps to 1.8', () => {
    expect(pregnancyMultiplier('dog', 3)).toBe(1.0);
    expect(pregnancyMultiplier('dog', 9)).toBeCloseTo(1.80, 2);
  });

  test('pregnancyMultiplier — cat late gestation ramps to 1.6', () => {
    expect(pregnancyMultiplier('cat', 3)).toBe(1.0);
    expect(pregnancyMultiplier('cat', 9)).toBeCloseTo(1.60, 2);
  });

  test('nursing still returns 3× RER (litter-size ramp is separate)', () => {
    const kcal = calculateDailyKcal(
      25, 'dog', false, 'normal', 'maintain', undefined, 1.0, null, 1.0, null, null,
      'nursing', null,
    );
    expect(kcal).toBe(Math.round(3.0 * calculateRER(25)));
  });
});

describe('calculateDailyKcal — growth-phase guard', () => {
  test('8-month puppy with lose goal falls through to maintenance math', () => {
    const asLose = calculateDailyKcal(6, 'dog', true, 'normal', 'lose', 8, 1.0, 5);
    const asMaintain = calculateDailyKcal(6, 'dog', true, 'normal', 'maintain', 8, 1.0, 5);
    expect(asLose).toBe(asMaintain);
  });

  test('shouldBlockGrowthWeightLoss returns true only for lose + <12 mo', () => {
    expect(shouldBlockGrowthWeightLoss(8, 'lose')).toBe(true);
    expect(shouldBlockGrowthWeightLoss(8, 'maintain')).toBe(false);
    expect(shouldBlockGrowthWeightLoss(12, 'lose')).toBe(false);
    expect(shouldBlockGrowthWeightLoss(undefined, 'lose')).toBe(false);
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

  // Directional-clamp semantics: BCS overrules SMALL slider movements (nudges)
  // but yields to larger, estimator- or owner-driven targets. Regression for
  // the recovery case: an 8 kg adult Lab scored "just right" gets a staged
  // gain target ~12% up — that plan must derive as 'gain', not 'maintain'.
  test('BCS 5 nudges within ~5% of current → maintain', () => {
    expect(deriveGoal(30, 30.4, 5)).toBe('maintain');
    expect(deriveGoal(30, 29, 5)).toBe('maintain');
    expect(deriveGoal(30, 31, 5)).toBe('maintain');
  });

  test('BCS 5 with a staged recovery target (+12%) → gain', () => {
    expect(deriveGoal(8, 9, 5)).toBe('gain');
  });

  test('BCS 5 with a deliberate larger drag follows the target', () => {
    expect(deriveGoal(30, 25, 5)).toBe('lose');
    expect(deriveGoal(45, 34, 5)).toBe('lose');
  });

  test('BCS ≥ 6 with modest upward drag → maintain (never gain inside window)', () => {
    expect(deriveGoal(30, 32, 7)).toBe('maintain');
    expect(deriveGoal(30, 35, 8)).toBe('maintain');
  });

  test('BCS ≥ 6 with lower target → lose', () => {
    expect(deriveGoal(30, 27, 7)).toBe('lose');
  });

  test('BCS ≤ 4 with modest downward drag → maintain (never lose inside window)', () => {
    expect(deriveGoal(30, 27, 3)).toBe('maintain');
    expect(deriveGoal(30, 25, 4)).toBe('maintain');
  });

  test('BCS ≤ 4 with higher target → gain', () => {
    expect(deriveGoal(30, 33, 3)).toBe('gain');
  });
});

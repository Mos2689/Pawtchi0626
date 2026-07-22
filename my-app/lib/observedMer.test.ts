import { computeObservedMer, MIN_DAYS_FOR_RECALIB, MIN_KCAL_LOGS_IN_WINDOW } from './observedMer';
import { calculateRER } from './healthMath';

function makeKcalLogs(count: number, kcalPerDay: number) {
  return Array.from({ length: count }, (_, i) => ({
    logDate: new Date(2026, 5, i + 1).toISOString(),
    caloriesConsumed: kcalPerDay,
  }));
}

function makeWeightLogs(entries: Array<[dayOffset: number, kg: number]>, baseDate = new Date(2026, 5, 1)) {
  return entries.map(([offset, kg]) => ({
    loggedAt: new Date(baseDate.getTime() + offset * 24 * 3600 * 1000).toISOString(),
    weightKg: kg,
  }));
}

describe('computeObservedMer — gating', () => {
  test('rejects until MIN_DAYS_FOR_RECALIB days elapsed', () => {
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(25, 1250),
      weightLogs: makeWeightLogs([[0, 25], [26, 25]]),
      daysSincePlanStart: MIN_DAYS_FOR_RECALIB - 1,
    });
    expect(r.status).toBe('insufficient_history');
  });

  test('rejects when kcal-log density is too sparse', () => {
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(MIN_KCAL_LOGS_IN_WINDOW - 1, 1250),
      weightLogs: makeWeightLogs([[0, 25], [28, 25]]),
      daysSincePlanStart: 28,
    });
    expect(r.status).toBe('insufficient_kcal_logs');
  });

  test('rejects when only one weight log exists', () => {
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(25, 1250),
      weightLogs: makeWeightLogs([[0, 25]]),
      daysSincePlanStart: 28,
    });
    expect(r.status).toBe('insufficient_weight_logs');
  });
});

describe('computeObservedMer — steady state', () => {
  test('flat weight + kcal ≈ predicted → stable', () => {
    const target = Math.round(calculateRER(25) * 1.6);
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(25, target),
      weightLogs: makeWeightLogs([[0, 25], [28, 25]]),
      daysSincePlanStart: 28,
    });
    expect(r.status).toBe('stable');
    expect(r.impliedMerFactor).toBeCloseTo(1.6, 1);
  });
});

describe('computeObservedMer — recalibration prompt', () => {
  test('weight rising on prescribed target ⇒ true maintenance is LOWER', () => {
    // Pet fed 1250 kcal/day but gaining 1.2 kg over 28 days → implied
    // maintenance ≈ 1250 − (1.2/28 × 7700) ≈ 920 kcal/day → factor drops well
    // below 1.6 and drift exceeds the 15% recalibration threshold.
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(28, 1250),
      weightLogs: makeWeightLogs([[0, 23.8], [28, 25.0]]),
      daysSincePlanStart: 28,
    });
    expect(r.status).toBe('recalibration_suggested');
    expect(r.impliedMerFactor).toBeLessThan(1.6);
    expect(r.suggestedDailyKcal).toBeLessThan(r.predictedDailyKcal);
  });

  test('weight losing on maintenance target ⇒ true maintenance is HIGHER', () => {
    // Same setup mirrored: 1.2 kg unintended loss over 28 days on 1250 kcal/day
    // implies real maintenance ≈ 1580 kcal, well above the predicted 1250.
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(28, 1250),
      weightLogs: makeWeightLogs([[0, 26.2], [28, 25.0]]),
      daysSincePlanStart: 28,
    });
    expect(r.status).toBe('recalibration_suggested');
    expect(r.impliedMerFactor).toBeGreaterThan(1.6);
    expect(r.suggestedDailyKcal).toBeGreaterThan(r.predictedDailyKcal);
  });
});

describe('computeObservedMer — noise rejection', () => {
  test('extreme implied factor is clamped and flagged as noise, not suggested', () => {
    // Impossible: 5000 kcal/day, 0.1 kg gain in 28 days → implied > 4× RER.
    const r = computeObservedMer({
      currentWeightKg: 25,
      predictedMerFactor: 1.6,
      kcalLogs: makeKcalLogs(28, 5000),
      weightLogs: makeWeightLogs([[0, 24.9], [28, 25.0]]),
      daysSincePlanStart: 28,
    });
    expect(r.status).toBe('noise');
    expect(r.suggestedDailyKcal).toBeUndefined();
  });
});

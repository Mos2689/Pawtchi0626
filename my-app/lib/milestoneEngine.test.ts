import {
  evaluateMilestone,
  predictBcs,
  stageToleranceKg,
  BCS_STALE_DAYS,
} from './milestoneEngine';

const lab = {
  species: 'dog' as const,
  breed: 'Labrador Retriever',
  sex: 'male' as const,
  ageMonths: 6 * 12,
};

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

describe('evaluateMilestone — weight-loss stage completion (48 kg Lab)', () => {
  const base = {
    ...lab,
    startWeightKg: 48,
    previousWeightKg: 43.0,
    currentWeightKg: 42.1,
    stageTargetKg: 42,
    bcs: 8,
    bcsUpdatedAt: daysAgo(30),
    bcsAnchorWeightKg: 48,
  };

  test('crossing the stage target fires stage_reached with a recomputed next stage', () => {
    const r = evaluateMilestone(base);
    expect(r.event).toBe('stage_reached');
    // BCS predicted to have dropped 8 → 7 after ~12.3% loss
    expect(r.predictedBcs).toBe(7);
    // Fresh estimate at 42.1 kg BCS 7: final ideal 42.1/1.2 ≈ 35, staged next step 37
    expect(r.finalIdealKg).toBe(35);
    expect(r.nextStage?.targetKg).toBe(37);
    expect(r.nextStage?.staged).toBe(true);
    expect(r.nextStage?.classification).toBe('overweight');
    // Progress toward FINAL ideal: (48 − 42.1) / (48 − 35) ≈ 45%
    expect(r.progressPct).toBe(45);
  });

  test('same weigh-in without crossing (already at target) fires nothing', () => {
    const r = evaluateMilestone({ ...base, previousWeightKg: 42.05 });
    expect(r.event).toBeNull();
  });

  test('approaching but not reaching the stage → no event (fresh BCS)', () => {
    const r = evaluateMilestone({
      ...base, previousWeightKg: 44, currentWeightKg: 43.5, bcsUpdatedAt: daysAgo(10),
    });
    expect(r.event).toBeNull();
    expect(r.progressPct).not.toBeNull();
  });
});

describe('evaluateMilestone — recovery (8 kg Lab) stage completion', () => {
  test('reaching the +12% stage advances toward the band-anchored ideal', () => {
    const r = evaluateMilestone({
      ...lab,
      startWeightKg: 8,
      previousWeightKg: 8.4,
      currentWeightKg: 9.0,
      stageTargetKg: 9,
      bcs: 5,
      bcsUpdatedAt: daysAgo(21),
      bcsAnchorWeightKg: 8,
    });
    expect(r.event).toBe('stage_reached');
    // Next stage is another +12% step (9 × 1.12 = 10.08 → 10 at 0.5-kg precision)
    expect(r.nextStage?.targetKg).toBe(10);
    expect(r.nextStage?.staged).toBe(true);
    expect(r.nextStage?.classification).toBe('underweight');
    expect(r.nextStage?.severity).toBe('severe');
  });
});

describe('evaluateMilestone — final_reached', () => {
  test('arriving at the final ideal (BCS re-scored to 5) celebrates completion', () => {
    const r = evaluateMilestone({
      ...lab,
      startWeightKg: 48,
      previousWeightKg: 34.2,
      currentWeightKg: 33,
      stageTargetKg: 33,
      bcs: 5,
      bcsUpdatedAt: daysAgo(14),
      bcsAnchorWeightKg: 33.5,
    });
    expect(r.event).toBe('final_reached');
    expect(r.progressPct).toBe(100);
  });

  test('sitting at final on subsequent weigh-ins stays quiet', () => {
    const r = evaluateMilestone({
      ...lab,
      startWeightKg: 48,
      previousWeightKg: 33.05,
      currentWeightKg: 33,
      stageTargetKg: 33,
      bcs: 5,
      bcsUpdatedAt: daysAgo(14),
      bcsAnchorWeightKg: 33,
    });
    expect(r.event).toBeNull();
  });
});

describe('evaluateMilestone — bcs_stale', () => {
  const active = {
    ...lab,
    startWeightKg: 45,
    previousWeightKg: 40.5,
    currentWeightKg: 40,
    stageTargetKg: 35,
    bcs: 8,
    bcsAnchorWeightKg: 45,
  };

  test('fires after 57 days on an active plan', () => {
    const r = evaluateMilestone({ ...active, bcsUpdatedAt: daysAgo(BCS_STALE_DAYS + 1) });
    expect(r.event).toBe('bcs_stale');
  });

  test('does not fire at 30 days', () => {
    const r = evaluateMilestone({ ...active, bcsUpdatedAt: daysAgo(30) });
    expect(r.event).toBeNull();
  });

  test('does not fire on a maintenance pet, however old the score', () => {
    const r = evaluateMilestone({
      ...lab,
      startWeightKg: 32.5,
      previousWeightKg: 32.1,
      currentWeightKg: 32,
      stageTargetKg: 32,
      bcs: 5,
      bcsUpdatedAt: daysAgo(200),
      bcsAnchorWeightKg: 32,
    });
    expect(r.event).toBeNull();
  });
});

describe('evaluateMilestone — guards', () => {
  test('growing pets never run the milestone loop', () => {
    const r = evaluateMilestone({
      ...lab,
      ageMonths: 6,
      startWeightKg: 15,
      previousWeightKg: 17,
      currentWeightKg: 18,
      stageTargetKg: 17.5,
      bcs: 5,
      bcsUpdatedAt: daysAgo(90),
      bcsAnchorWeightKg: 15,
    });
    expect(r.event).toBeNull();
    expect(r.finalIdealKg).toBeNull();
  });

  test('invalid current weight → inert result', () => {
    const r = evaluateMilestone({
      ...lab,
      startWeightKg: 40,
      currentWeightKg: 0,
      stageTargetKg: 35,
      bcs: 7,
      bcsUpdatedAt: daysAgo(10),
    });
    expect(r.event).toBeNull();
  });

  test('no stage target → stage events impossible, staleness still works', () => {
    const r = evaluateMilestone({
      ...lab,
      startWeightKg: 45,
      previousWeightKg: 41,
      currentWeightKg: 40,
      stageTargetKg: null,
      bcs: 8,
      bcsUpdatedAt: daysAgo(90),
      bcsAnchorWeightKg: 45,
    });
    expect(r.event).toBe('bcs_stale');
  });
});

describe('predictBcs', () => {
  test('12.3% dog weight loss shifts BCS down ~1 point', () => {
    expect(predictBcs('dog', 8, 48, 42.1)).toBe(7);
  });

  test('small changes round to no shift', () => {
    expect(predictBcs('dog', 7, 40, 39.2)).toBe(7); // −2%
  });

  test('cat uses 12% per point', () => {
    expect(predictBcs('cat', 9, 8, 7.0)).toBe(8); // −12.5% ≈ 1 point
  });

  test('clamped to 1–9', () => {
    expect(predictBcs('dog', 9, 30, 60)).toBe(9);
    expect(predictBcs('dog', 1, 30, 15)).toBe(1);
  });

  test('bad anchor returns the recorded score unchanged', () => {
    expect(predictBcs('dog', 6, 0, 30)).toBe(6);
  });
});

describe('stageToleranceKg', () => {
  test('floors at 0.1 kg for small pets', () => {
    expect(stageToleranceKg(4)).toBe(0.1);
  });
  test('0.5% for large pets', () => {
    expect(stageToleranceKg(48)).toBeCloseTo(0.24, 5);
  });
});

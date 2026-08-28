import {
  buildWeightPlanViewModel,
  canAssessmentSupersede,
  createWeightAssessment,
  evaluateWeightPlan,
  isAssessableWeightKg,
  type WeightPlanPet,
} from './weightPlan';

const basePet = (
  over: Partial<WeightPlanPet> = {},
): WeightPlanPet => ({
  species: 'dog',
  breed: 'Labrador Retriever',
  gender: 'male',
  ageMonths: 60,
  currentWeightKg: 25,
  targetWeightKg: 25,
  idealWeightKg: 25,
  healthyBandLowKg: 22,
  healthyBandHighKg: 35,
  weightAssessmentKg: 25,
  weightAssessmentBcs: 5,
  weightAssessedAt: '2026-07-01T08:00:00Z',
  journeyStartWeightKg: 25,
  bodyConditionScore: 5,
  bcsUpdatedAt: '2026-07-01T08:00:00Z',
  planStatus: 'maintenance',
  planRevision: 1,
  reproductiveStatus: 'neither',
  ...over,
});

describe('evaluateWeightPlan', () => {
  test('Bruno regression: a completed 25 kg plan reopens at 30 kg', () => {
    const evaluation = evaluateWeightPlan(
      basePet({ currentWeightKg: 30 }),
      [{ weightKg: 30, loggedAt: '2026-07-27T08:00:00Z' }],
      new Date('2026-07-27T09:00:00Z'),
    );
    expect(evaluation.status).toBe('needs_reassessment');
    expect(evaluation.reason).toBe('large_change');
    expect(evaluation.idealWeightKg).toBe(25);
  });

  test('a normal scale fluctuation stays in maintenance', () => {
    expect(
      evaluateWeightPlan(basePet({ currentWeightKg: 25.5 })).status,
    ).toBe('maintenance');
  });

  test('maintenance without a confirmed healthy band reopens assessment', () => {
    expect(
      evaluateWeightPlan(
        basePet({
          healthyBandLowKg: null,
          healthyBandHighKg: null,
        }),
      ),
    ).toMatchObject({
      status: 'needs_reassessment',
      reason: 'missing_assessment',
    });
  });

  test('one 3-5% movement asks for verification', () => {
    const pet = basePet({ currentWeightKg: 26 });
    expect(
      evaluateWeightPlan(pet, [
        { weightKg: 26, loggedAt: '2026-07-27T08:00:00Z' },
      ]).status,
    ).toBe('verify_change');
  });

  test('two separated 3-5% readings require reassessment', () => {
    const pet = basePet({ currentWeightKg: 26 });
    expect(
      evaluateWeightPlan(pet, [
        { weightKg: 26, loggedAt: '2026-07-27T20:00:00Z' },
        { weightKg: 26.1, loggedAt: '2026-07-27T07:00:00Z' },
      ]).status,
    ).toBe('needs_reassessment');
  });

  test('returning inside tolerance clears verification', () => {
    expect(
      evaluateWeightPlan(
        basePet({
          currentWeightKg: 25.2,
          planStatus: 'verify_change',
        }),
      ),
    ).toMatchObject({
      status: 'maintenance',
      reason: 'measurement_returned',
    });
  });

  test('an active plan never completes from scale data alone', () => {
    const pet = basePet({
      currentWeightKg: 25,
      targetWeightKg: 25,
      idealWeightKg: 25,
      planStatus: 'active',
      weightAssessedAt: '2026-07-25T08:00:00Z',
    });
    expect(evaluateWeightPlan(pet).status).toBe('active');
  });

  test('crossing a stage target requests assessment instead of advancing it', () => {
    expect(
      evaluateWeightPlan(
        basePet({
          currentWeightKg: 26.4,
          journeyStartWeightKg: 30,
          weightAssessmentKg: 30,
          targetWeightKg: 26.4,
          idealWeightKg: 24,
          planStatus: 'active',
          weightAssessedAt: '2026-07-25T08:00:00Z',
        }),
      ),
    ).toMatchObject({
      status: 'needs_reassessment',
      reason: 'stage_target_reached',
      targetWeightKg: 26.4,
      idealWeightKg: 24,
    });
  });

  test('moving away from a stage target never advances it', () => {
    expect(
      evaluateWeightPlan(
        basePet({
          currentWeightKg: 31,
          journeyStartWeightKg: 30,
          weightAssessmentKg: 30,
          targetWeightKg: 26.4,
          idealWeightKg: 24,
          planStatus: 'active',
          weightAssessedAt: '2026-07-25T08:00:00Z',
        }),
      ).status,
    ).toBe('active');
  });

  test('stale BCS on an active plan requests reassessment', () => {
    expect(
      evaluateWeightPlan(
        basePet({
          currentWeightKg: 28,
          planStatus: 'active',
          weightAssessedAt: '2026-01-01T08:00:00Z',
        }),
        [],
        new Date('2026-07-27T08:00:00Z'),
      ).reason,
    ).toBe('stale_bcs');
  });

  test('an adult transition reopens a former growth plan', () => {
    expect(
      evaluateWeightPlan(
        basePet({
          ageMonths: 30,
          idealWeightKg: null,
          planStatus: 'growth',
        }),
      ),
    ).toMatchObject({
      status: 'needs_reassessment',
      reason: 'awaiting_reassessment',
    });
  });
});

describe('assessment chronology', () => {
  test('a backdated vet assessment cannot supersede a newer accepted one', () => {
    expect(
      canAssessmentSupersede(
        '2026-07-27T08:00:00Z',
        '2026-07-20T08:00:00Z',
      ),
    ).toBe(false);
    expect(
      canAssessmentSupersede(
        '2026-07-27T08:00:00Z',
        '2026-07-28T08:00:00Z',
      ),
    ).toBe(true);
  });
});

describe('createWeightAssessment', () => {
  test('fresh BCS 5 at 30 kg may establish a new 30 kg ideal', () => {
    const assessment = createWeightAssessment({
      pet: basePet({ currentWeightKg: 30 }),
      bcs: 5,
      source: 'owner_bcs',
      assessedAt: '2026-07-27T08:00:00Z',
    });
    expect(assessment.idealWeightKg).toBe(30);
    expect(assessment.status).toBe('maintenance');
    expect(assessment.discloseIdealChange).toBe(true);
  });

  test('fresh BCS 7 at 30 kg keeps a lower ideal and active journey', () => {
    const assessment = createWeightAssessment({
      pet: basePet({ currentWeightKg: 30 }),
      bcs: 7,
      source: 'owner_bcs',
    });
    expect(assessment.idealWeightKg).toBeLessThan(30);
    expect(assessment.status).toBe('active');
    expect(
      Math.abs((assessment.targetWeightKg ?? 30) - 30) / 30,
    ).toBeLessThanOrEqual(0.12);
  });

  test('body-condition improvement can legitimately move the ideal', () => {
    const assessment = createWeightAssessment({
      pet: basePet({
        currentWeightKg: 25,
        idealWeightKg: 23,
        targetWeightKg: 23,
      }),
      bcs: 5,
      source: 'milestone',
    });
    expect(assessment.previousIdealWeightKg).toBe(23);
    expect(assessment.idealWeightKg).toBe(25);
    expect(assessment.revision).toBe(2);
  });

  test('historical BCS uses its paired weight but stages from today', () => {
    const assessment = createWeightAssessment({
      pet: basePet({
        currentWeightKg: 30,
        journeyStartWeightKg: 30,
      }),
      assessmentWeightKg: 25,
      bcs: 5,
      source: 'vet_report',
      assessedAt: '2026-06-01T08:00:00Z',
    });
    expect(assessment.assessmentWeightKg).toBe(25);
    expect(assessment.idealWeightKg).toBe(25);
    expect(assessment.targetWeightKg).toBe(26.5);
  });
});

describe('buildWeightPlanViewModel', () => {
  test('healthy and journey presentations are mutually exclusive', () => {
    const healthy = buildWeightPlanViewModel(basePet());
    const reopened = buildWeightPlanViewModel(
      basePet({ currentWeightKg: 30 }),
    );
    expect(healthy.showHealthyBanner).toBe(true);
    expect(healthy.showJourney).toBe(false);
    expect(reopened.showHealthyBanner).toBe(false);
    expect(reopened.showJourney).toBe(true);
  });

  test('a reopened journey uses its own stable progress anchor', () => {
    const reopened = buildWeightPlanViewModel(
      basePet({
        currentWeightKg: 30,
        journeyStartWeightKg: 30,
        planStatus: 'needs_reassessment',
      }),
    );
    const improving = buildWeightPlanViewModel(
      basePet({
        currentWeightKg: 28,
        journeyStartWeightKg: 30,
        planStatus: 'needs_reassessment',
      }),
    );
    const regressing = buildWeightPlanViewModel(
      basePet({
        currentWeightKg: 31,
        journeyStartWeightKg: 30,
        planStatus: 'needs_reassessment',
      }),
    );
    expect(reopened.progressPct).toBe(0);
    expect(improving.progressPct).toBe(40);
    expect(regressing.progressPct).toBe(0);
  });
});

describe('isAssessableWeightKg', () => {
  test('a measured weight can carry an assessment', () => {
    expect(isAssessableWeightKg(15.5)).toBe(true);
    expect(isAssessableWeightKg(0.4)).toBe(true);
  });

  test('the walk-first sentinel cannot', () => {
    // 0 is what walk-first onboarding leaves behind, and it is exactly the
    // value `weight_plan_assessments.assessment_weight_kg > 0` rejects. Before
    // this guard existed the 0 reached the database and came back as a
    // constraint violation for a profile state the app already handles.
    expect(isAssessableWeightKg(0)).toBe(false);
  });

  test('absent, negative and non-finite weights cannot', () => {
    expect(isAssessableWeightKg(null)).toBe(false);
    expect(isAssessableWeightKg(undefined)).toBe(false);
    expect(isAssessableWeightKg(-2)).toBe(false);
    expect(isAssessableWeightKg(NaN)).toBe(false);
    expect(isAssessableWeightKg(Infinity)).toBe(false);
  });
});

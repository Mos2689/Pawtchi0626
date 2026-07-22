import {
  aggregateWalks,
  CONFIRM_WALK_COUNT,
  deriveProvisionalWalksign,
  deriveWalksignFromWalks,
  evaluateWalksign,
} from './walksignEngine';
import type { WalksignPetFacts, WalksignWalkRow } from './types';

const adultFacts = (over: Partial<WalksignPetFacts> = {}): WalksignPetFacts => ({
  species: 'dog',
  lifeStage: 'adult',
  firstDog: false,
  ownershipMonths: 36,
  activityLevel: 'normal',
  ...over,
});

/** A walk row with sensible defaults, overridable per scenario. */
const walk = (over: Partial<WalksignWalkRow> = {}): WalksignWalkRow => ({
  startedAt: '2026-07-01T08:15:00Z',
  durationS: 1800,
  movingTimeS: 1500,
  distanceM: 2000,
  avgSpeedKmh: 4.5,
  endReason: 'manual',
  startLabel: 'Home',
  endLabel: 'Elm Street',
  farthestLabel: 'Riverside Park',
  pauseCount: 2,
  ...over,
});

// ── Provisional derivation ──────────────────────────────────────────────────

describe('deriveProvisionalWalksign', () => {
  test('cats never get a Walksign', () => {
    expect(deriveProvisionalWalksign(adultFacts({ species: 'cat' }))).toBeNull();
  });

  test('puppy and junior life stages read as Wonderbound above all else', () => {
    for (const lifeStage of ['puppy', 'junior'] as const) {
      const a = deriveProvisionalWalksign(adultFacts({ lifeStage, firstDog: true }));
      expect(a).toEqual({ sign: 'wonderbound', status: 'provisional', reason: 'life_stage_puppy' });
    }
  });

  test('senior and geriatric read as Storywalker', () => {
    for (const lifeStage of ['senior', 'geriatric'] as const) {
      expect(deriveProvisionalWalksign(adultFacts({ lifeStage }))?.sign).toBe('storywalker');
    }
  });

  test('a first dog is a Newbond', () => {
    const a = deriveProvisionalWalksign(adultFacts({ firstDog: true }));
    expect(a).toEqual({ sign: 'newbond', status: 'provisional', reason: 'first_dog' });
  });

  test('a household of walkers makes a Packheart', () => {
    expect(deriveProvisionalWalksign(adultFacts({ householdWalkers: 3 }))?.sign).toBe('packheart');
  });

  test('energy fills in the rest: sedentary → Softstep, active → Blockscout, steady → Loopkeeper', () => {
    expect(deriveProvisionalWalksign(adultFacts({ activityLevel: 'sedentary' }))?.sign).toBe('softstep');
    expect(deriveProvisionalWalksign(adultFacts({ activityLevel: 'active' }))?.sign).toBe('blockscout');
    expect(deriveProvisionalWalksign(adultFacts({ activityLevel: 'highly_active' }))?.sign).toBe('blockscout');
    expect(deriveProvisionalWalksign(adultFacts())?.sign).toBe('loopkeeper');
  });
});

// ── Aggregation ─────────────────────────────────────────────────────────────

describe('aggregateWalks', () => {
  test('empty input yields the zero fingerprint', () => {
    const agg = aggregateWalks([]);
    expect(agg.walkCount).toBe(0);
    expect(agg.sniffPerKm).toBe(0);
    expect(agg.routeRepetitionRatio).toBe(0);
  });

  test('loops, repetition, and time consistency are counted', () => {
    const rows = [
      walk({ endReason: 'auto_home' }),
      walk({ endReason: 'auto_home' }),
      walk({ endReason: 'manual', farthestLabel: 'Canal Path' }),
    ];
    const agg = aggregateWalks(rows);
    expect(agg.walkCount).toBe(3);
    expect(agg.loopRatio).toBeCloseTo(2 / 3);
    // Two of three labelled walks share the Home→Riverside Park route.
    expect(agg.routeRepetitionRatio).toBeCloseTo(2 / 3);
    // All three start in the same 3-hour bucket.
    expect(agg.timeOfDayConsistency).toBe(1);
  });

  test('sniff density and pause-time ratio come from real fields', () => {
    const agg = aggregateWalks([
      walk({ distanceM: 1000, pauseCount: 4, durationS: 1200, movingTimeS: 600 }),
    ]);
    expect(agg.sniffPerKm).toBeCloseTo(4);
    expect(agg.pauseTimeRatio).toBeCloseTo(0.5);
  });
});

// ── Behavioural classification ──────────────────────────────────────────────

describe('deriveWalksignFromWalks', () => {
  test('slow, pause-heavy, short-range walks read as Softstep', () => {
    const rows = [0, 1, 2, 3, 4, 5].map(i =>
      walk({
        startedAt: `2026-07-0${i + 1}T${String(6 + i * 2).padStart(2, '0')}:00:00Z`,
        durationS: 1800,
        movingTimeS: 600,
        distanceM: 600,
        avgSpeedKmh: 2,
        pauseCount: 1,
        farthestLabel: i % 2 === 0 ? 'Quiet Green' : 'Back Lane',
      }),
    );
    expect(deriveWalksignFromWalks(aggregateWalks(rows), adultFacts())).toBe('softstep');
  });

  test('the same labelled loop at the same hour reads as Loopkeeper', () => {
    const rows = [0, 1, 2, 3, 4, 5].map(i =>
      walk({
        startedAt: `2026-07-0${i + 1}T07:30:00Z`,
        endReason: 'auto_home',
        movingTimeS: 1700,
        pauseCount: 2,
      }),
    );
    expect(deriveWalksignFromWalks(aggregateWalks(rows), adultFacts())).toBe('loopkeeper');
  });

  test('many places and a busy nose read as Blockscout', () => {
    const places = ['Market Row', 'Old Dock', 'Hill Gate', 'Corner Yard', 'Mews Lane', 'Arch Way'];
    const rows = places.map((p, i) =>
      walk({
        startedAt: `2026-07-0${i + 1}T${String(7 + i * 3).padStart(2, '0')}:00:00Z`,
        startLabel: `${p} Start`,
        endLabel: `${p} End`,
        farthestLabel: p,
        distanceM: 1500,
        pauseCount: 8,
        movingTimeS: 1650,
      }),
    );
    expect(deriveWalksignFromWalks(aggregateWalks(rows), adultFacts())).toBe('blockscout');
  });

  test('life stage outranks behaviour: a puppy walking loops is still Wonderbound', () => {
    const rows = [0, 1, 2].map(() => walk({ endReason: 'auto_home' }));
    expect(
      deriveWalksignFromWalks(aggregateWalks(rows), adultFacts({ lifeStage: 'puppy' })),
    ).toBe('wonderbound');
    expect(
      deriveWalksignFromWalks(aggregateWalks(rows), adultFacts({ lifeStage: 'geriatric' })),
    ).toBe('storywalker');
  });

  test('a first dog in its first year reads as Newbond over mild patterns', () => {
    const rows = [0, 1, 2].map(i =>
      walk({
        startedAt: `2026-07-0${i + 1}T${String(6 + i * 5).padStart(2, '0')}:00:00Z`,
        farthestLabel: i === 0 ? 'Riverside Park' : `Spot ${i}`,
      }),
    );
    expect(
      deriveWalksignFromWalks(
        aggregateWalks(rows),
        adultFacts({ firstDog: true, ownershipMonths: 3 }),
      ),
    ).toBe('newbond');
  });
});

// ── The sticky state machine ────────────────────────────────────────────────

describe('evaluateWalksign', () => {
  const loopRows = [0, 1, 2, 3, 4].map(i =>
    walk({ startedAt: `2026-07-0${i + 1}T07:30:00Z`, endReason: 'auto_home' }),
  );

  test('no sign yet → provisional assignment event', () => {
    const result = evaluateWalksign({
      current: null,
      facts: adultFacts(),
      aggregates: null,
      validWalkCount: 0,
    });
    expect(result.change?.event).toBe('assigned');
    expect(result.change?.assignment.status).toBe('provisional');
  });

  test('cats produce no change ever', () => {
    expect(
      evaluateWalksign({
        current: null,
        facts: adultFacts({ species: 'cat' }),
        aggregates: null,
        validWalkCount: 10,
      }).change,
    ).toBeNull();
  });

  test('provisional stays put before the confirmation threshold', () => {
    const result = evaluateWalksign({
      current: { sign: 'loopkeeper', status: 'provisional' },
      facts: adultFacts(),
      aggregates: aggregateWalks(loopRows.slice(0, 3)),
      validWalkCount: CONFIRM_WALK_COUNT - 1,
    });
    expect(result.change).toBeNull();
  });

  test('the fifth valid walk confirms — with the EARNED sign, even if it differs', () => {
    const result = evaluateWalksign({
      current: { sign: 'blockscout', status: 'provisional' },
      facts: adultFacts(),
      aggregates: aggregateWalks(loopRows),
      validWalkCount: CONFIRM_WALK_COUNT,
    });
    expect(result.change?.event).toBe('confirmed');
    expect(result.change?.assignment).toEqual({
      sign: 'loopkeeper',
      status: 'confirmed',
      reason: 'confirmed_by_walks',
    });
  });

  test('a confirmed sign is sticky against contradictory walks', () => {
    const blockscoutRows = ['A', 'B', 'C', 'D', 'E', 'F'].map((p, i) =>
      walk({
        startedAt: `2026-07-0${i + 1}T${String(6 + i * 3).padStart(2, '0')}:00:00Z`,
        startLabel: `${p} Start`,
        farthestLabel: `${p} Far`,
        pauseCount: 8,
        distanceM: 1500,
      }),
    );
    const result = evaluateWalksign({
      current: { sign: 'loopkeeper', status: 'confirmed' },
      facts: adultFacts(),
      aggregates: aggregateWalks(blockscoutRows),
      validWalkCount: 20,
    });
    expect(result.change).toBeNull();
  });

  test('Wonderbound graduates exactly once when puppyhood ends', () => {
    const first = evaluateWalksign({
      current: { sign: 'wonderbound', status: 'confirmed' },
      facts: adultFacts(),
      aggregates: aggregateWalks(loopRows),
      validWalkCount: 12,
    });
    expect(first.change?.event).toBe('transition');
    expect(first.change?.transitionKind).toBe('wonderbound_graduation');
    expect(first.change?.assignment.sign).toBe('loopkeeper');

    // Re-evaluating from the post-graduation state is quiet.
    const second = evaluateWalksign({
      current: { sign: 'loopkeeper', status: 'confirmed' },
      facts: adultFacts(),
      aggregates: aggregateWalks(loopRows),
      validWalkCount: 12,
    });
    expect(second.change).toBeNull();
  });

  test('seniority brings Storywalker exactly once', () => {
    const first = evaluateWalksign({
      current: { sign: 'loopkeeper', status: 'confirmed' },
      facts: adultFacts({ lifeStage: 'senior' }),
      aggregates: aggregateWalks(loopRows),
      validWalkCount: 40,
    });
    expect(first.change?.event).toBe('transition');
    expect(first.change?.transitionKind).toBe('storywalker_arrival');
    expect(first.change?.assignment.sign).toBe('storywalker');

    const second = evaluateWalksign({
      current: { sign: 'storywalker', status: 'confirmed' },
      facts: adultFacts({ lifeStage: 'senior' }),
      aggregates: aggregateWalks(loopRows),
      validWalkCount: 40,
    });
    expect(second.change).toBeNull();
  });

  test('a provisional Wonderbound ages out quietly, without ceremony', () => {
    const result = evaluateWalksign({
      current: { sign: 'wonderbound', status: 'provisional' },
      facts: adultFacts({ activityLevel: 'sedentary' }),
      aggregates: null,
      validWalkCount: 0,
    });
    expect(result.change?.event).toBe('assigned');
    expect(result.change?.assignment).toEqual({
      sign: 'softstep',
      status: 'provisional',
      reason: 'life_stage_adult',
    });
  });
});

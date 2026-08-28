import {
  aggregateWalks,
  CONFIRM_WALK_COUNT,
  deriveProvisionalWalksign,
  deriveWalksignFromWalks,
  deriveWalksignReading,
  evaluateWalksign,
  geographicRouteRepetitionRatio,
  routeSimilarityMeters,
} from './walksignEngine';
import type { WalksignPetFacts, WalksignWalkRow } from './types';

const adultFacts = (
  over: Partial<WalksignPetFacts> = {},
): WalksignPetFacts => ({
  species: 'dog',
  lifeStage: 'adult',
  firstDog: false,
  ownershipMonths: 36,
  activityLevel: 'normal',
  ...over,
});

const routeAt = (offset: number) => [
  { lat: 12.9716 + offset, lng: 77.5946 },
  { lat: 12.972 + offset, lng: 77.595 },
  { lat: 12.9725 + offset, lng: 77.5955 },
];

const walk = (
  over: Partial<WalksignWalkRow> = {},
): WalksignWalkRow => ({
  startedAt: '2026-07-01T08:15:00Z',
  durationS: 1800,
  movingTimeS: 1500,
  distanceM: 2000,
  avgSpeedKmh: 4.5,
  endReason: 'manual',
  startLabel: 'Home',
  endLabel: 'Elm Street',
  farthestLabel: 'Riverside Park',
  sniffCount: 2,
  route: routeAt(0),
  ...over,
});

const loopRows = (count = 5) =>
  Array.from({ length: count }, (_, index) =>
    walk({
      startedAt: `2026-07-${String(index + 1).padStart(2, '0')}T07:30:00Z`,
      endReason: 'auto_home',
    }),
  );

const blockscoutRows = (count = 12) =>
  Array.from({ length: count }, (_, index) =>
    walk({
      startedAt: `2026-06-${String(index + 1).padStart(2, '0')}T${String(
        6 + (index % 6) * 3,
      ).padStart(2, '0')}:00:00Z`,
      startLabel: `Start ${index}`,
      endLabel: `End ${index}`,
      farthestLabel: `Far ${index}`,
      distanceM: 1500,
      sniffCount: 8,
      movingTimeS: 1650,
      route: routeAt(index * 0.003),
    }),
  );

describe('deriveProvisionalWalksign', () => {
  test('cats never get a Walksign', () => {
    expect(
      deriveProvisionalWalksign(adultFacts({ species: 'cat' })),
    ).toBeNull();
  });

  test('life stage takes priority', () => {
    for (const lifeStage of ['puppy', 'junior'] as const) {
      expect(
        deriveProvisionalWalksign(
          adultFacts({ lifeStage, firstDog: true }),
        )?.sign,
      ).toBe('wonderbound');
    }
    for (const lifeStage of ['senior', 'geriatric'] as const) {
      expect(
        deriveProvisionalWalksign(adultFacts({ lifeStage }))?.sign,
      ).toBe('storywalker');
    }
  });

  test('relationship facts create Newbond and Packheart readings', () => {
    expect(
      deriveProvisionalWalksign(adultFacts({ firstDog: true }))?.sign,
    ).toBe('newbond');
    expect(
      deriveProvisionalWalksign(
        adultFacts({ householdWalkers: 3 }),
      )?.sign,
    ).toBe('packheart');
  });

  test('energy provides the broad onboarding fallback', () => {
    expect(
      deriveProvisionalWalksign(
        adultFacts({ activityLevel: 'sedentary' }),
      )?.sign,
    ).toBe('softstep');
    expect(
      deriveProvisionalWalksign(
        adultFacts({ activityLevel: 'active' }),
      )?.sign,
    ).toBe('blockscout');
    expect(deriveProvisionalWalksign(adultFacts())?.sign).toBe(
      'loopkeeper',
    );
  });
});

describe('aggregateWalks', () => {
  test('empty input yields a zero fingerprint', () => {
    expect(aggregateWalks([])).toMatchObject({
      walkCount: 0,
      sniffPerKm: 0,
      routeRepetitionRatio: 0,
    });
  });

  test('real sniff count and pause ratio are aggregated independently', () => {
    const aggregate = aggregateWalks([
      walk({
        distanceM: 1000,
        sniffCount: 4,
        durationS: 1200,
        movingTimeS: 600,
      }),
    ]);
    expect(aggregate.sniffPerKm).toBeCloseTo(4);
    expect(aggregate.pauseTimeRatio).toBeCloseTo(0.5);
  });

  test('loop, geographic repetition, and time consistency are counted', () => {
    const aggregate = aggregateWalks([
      walk({ endReason: 'auto_home' }),
      walk({ endReason: 'auto_home' }),
      walk({
        endReason: 'manual',
        farthestLabel: 'Canal Path',
        route: routeAt(0.003),
      }),
    ]);
    expect(aggregate.loopRatio).toBeCloseTo(2 / 3);
    expect(aggregate.routeRepetitionRatio).toBeCloseTo(2 / 3);
    expect(aggregate.timeOfDayConsistency).toBe(1);
  });
});

describe('geographic route evidence', () => {
  test('matching is direction agnostic and tolerates a nearby trace', () => {
    const route = routeAt(0);
    expect(
      routeSimilarityMeters(route, [...route].reverse()),
    ).toBeCloseTo(0);
    expect(
      geographicRouteRepetitionRatio([
        route,
        routeAt(0.0001),
        [...route].reverse(),
      ]),
    ).toBe(1);
  });

  test('matching labels cannot merge geographically different routes', () => {
    const rows = [0, 0.003, 0.006].map((offset) =>
      walk({
        startLabel: 'Home',
        farthestLabel: 'Park',
        route: routeAt(offset),
      }),
    );
    expect(
      aggregateWalks(rows).routeRepetitionRatio,
    ).toBeCloseTo(1 / 3);
  });

  test('labels remain a fallback for legacy rows without routes', () => {
    const rows = [
      walk({ route: [] }),
      walk({ route: [] }),
      walk({ route: [], farthestLabel: 'Canal' }),
    ];
    expect(
      aggregateWalks(rows).routeRepetitionRatio,
    ).toBeCloseTo(2 / 3);
  });
});

describe('deriveWalksignFromWalks', () => {
  test('slow, pause-heavy, short-range walks read as Softstep', () => {
    const rows = Array.from({ length: 6 }, (_, index) =>
      walk({
        startedAt: `2026-07-${String(index + 1).padStart(2, '0')}T${String(
          6 + index * 2,
        ).padStart(2, '0')}:00:00Z`,
        durationS: 1800,
        movingTimeS: 600,
        distanceM: 600,
        avgSpeedKmh: 2,
        sniffCount: 1,
        route: routeAt(index * 0.003),
      }),
    );
    expect(
      deriveWalksignFromWalks(aggregateWalks(rows), adultFacts()),
    ).toBe('softstep');
  });

  test('the same loop at the same hour reads as Loopkeeper', () => {
    expect(
      deriveWalksignFromWalks(
        aggregateWalks(loopRows(6)),
        adultFacts(),
      ),
    ).toBe('loopkeeper');
  });

  test('many places and real sniff episodes read as Blockscout', () => {
    expect(
      deriveWalksignFromWalks(
        aggregateWalks(blockscoutRows(6)),
        adultFacts(),
      ),
    ).toBe('blockscout');
  });

  test('relationship and life-stage facts outrank mild behavior', () => {
    const aggregates = aggregateWalks(loopRows(5));
    expect(
      deriveWalksignFromWalks(
        aggregates,
        adultFacts({ lifeStage: 'puppy' }),
      ),
    ).toBe('wonderbound');
    expect(
      deriveWalksignFromWalks(
        aggregates,
        adultFacts({ firstDog: true, ownershipMonths: 3 }),
      ),
    ).toBe('newbond');
    expect(
      deriveWalksignFromWalks(
        aggregates,
        adultFacts({ householdWalkers: 3 }),
      ),
    ).toBe('packheart');
  });
});

describe('evaluateWalksign', () => {
  test('no sign gets a provisional assignment', () => {
    const result = evaluateWalksign({
      current: null,
      facts: adultFacts(),
      aggregates: null,
      validWalkCount: 0,
    });
    expect(result.change?.event).toBe('assigned');
    expect(result.change?.assignment.status).toBe('provisional');
  });

  test('the threshold confirms a decisive earned reading', () => {
    const result = evaluateWalksign({
      current: { sign: 'blockscout', status: 'provisional' },
      facts: adultFacts(),
      aggregates: aggregateWalks(loopRows()),
      validWalkCount: CONFIRM_WALK_COUNT,
    });
    expect(result.change?.event).toBe('confirmed');
    expect(result.change?.assignment).toEqual({
      sign: 'loopkeeper',
      status: 'confirmed',
      reason: 'confirmed_by_walks',
    });
    expect(result.change?.evidence?.walkCount).toBe(
      CONFIRM_WALK_COUNT,
    );
  });

  test('ambiguous evidence stays provisional after the threshold', () => {
    const ambiguousRows = Array.from({ length: 5 }, (_, index) =>
      walk({
        startedAt: `2026-07-${String(index + 1).padStart(2, '0')}T${String(
          6 + index * 4,
        ).padStart(2, '0')}:00:00Z`,
        durationS: 1200,
        movingTimeS: 1200,
        distanceM: 1500,
        avgSpeedKmh: 4,
        sniffCount: 0,
        startLabel: null,
        endLabel: null,
        farthestLabel: null,
        route: routeAt(index * 0.003),
      }),
    );
    const aggregates = aggregateWalks(ambiguousRows);
    expect(
      deriveWalksignReading(aggregates, adultFacts())?.confident,
    ).toBe(false);
    expect(
      evaluateWalksign({
        current: {
          sign: 'loopkeeper',
          status: 'provisional',
        },
        facts: adultFacts(),
        aggregates,
        validWalkCount: CONFIRM_WALK_COUNT,
      }).change,
    ).toBeNull();
  });

  test('the household answer makes Packheart confirmable', () => {
    const result = evaluateWalksign({
      current: { sign: 'packheart', status: 'provisional' },
      facts: adultFacts({ householdWalkers: 3 }),
      aggregates: aggregateWalks(loopRows()),
      validWalkCount: CONFIRM_WALK_COUNT,
    });
    expect(result.change?.event).toBe('confirmed');
    expect(result.change?.assignment.sign).toBe('packheart');
    expect(result.change?.evidence?.margin).toBe(1);
  });

  test('a confirmed sign stays sticky without a complete evidence window', () => {
    const aggregates = aggregateWalks(blockscoutRows());
    expect(
      evaluateWalksign({
        current: {
          sign: 'loopkeeper',
          status: 'confirmed',
        },
        facts: adultFacts(),
        aggregates,
        validWalkCount: 30,
      }).change,
    ).toBeNull();
  });

  test('a confirmed sign evolves on sustained broad and recent evidence', () => {
    const aggregates = aggregateWalks(blockscoutRows());
    const result = evaluateWalksign({
      current: { sign: 'loopkeeper', status: 'confirmed' },
      facts: adultFacts(),
      aggregates,
      recentAggregates: aggregates,
      validWalkCount: 30,
      validWalksSinceAssignment: 12,
      daysSinceAssignment: 31,
    });
    expect(result.change?.event).toBe('transition');
    expect(result.change?.transitionKind).toBe(
      'behavioral_evolution',
    );
    expect(result.change?.assignment.sign).toBe('blockscout');
  });

  test('behavioral evolution is blocked before either guardrail', () => {
    const aggregates = aggregateWalks(blockscoutRows());
    const base = {
      current: {
        sign: 'loopkeeper' as const,
        status: 'confirmed' as const,
      },
      facts: adultFacts(),
      aggregates,
      recentAggregates: aggregates,
      validWalkCount: 30,
    };
    expect(
      evaluateWalksign({
        ...base,
        validWalksSinceAssignment: 11,
        daysSinceAssignment: 31,
      }).change,
    ).toBeNull();
    expect(
      evaluateWalksign({
        ...base,
        validWalksSinceAssignment: 12,
        daysSinceAssignment: 29,
      }).change,
    ).toBeNull();
  });

  test('Wonderbound graduates and seniority brings Storywalker', () => {
    const aggregates = aggregateWalks(loopRows());
    const graduated = evaluateWalksign({
      current: { sign: 'wonderbound', status: 'confirmed' },
      facts: adultFacts(),
      aggregates,
      validWalkCount: 12,
    });
    expect(graduated.change?.transitionKind).toBe(
      'wonderbound_graduation',
    );
    expect(graduated.change?.assignment.sign).toBe('loopkeeper');

    const senior = evaluateWalksign({
      current: { sign: 'loopkeeper', status: 'confirmed' },
      facts: adultFacts({ lifeStage: 'senior' }),
      aggregates,
      validWalkCount: 40,
    });
    expect(senior.change?.transitionKind).toBe(
      'storywalker_arrival',
    );
    expect(senior.change?.assignment.sign).toBe('storywalker');
  });
});

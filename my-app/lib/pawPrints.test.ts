import {
  aggregateWalks,
  buildMonthlyRecap,
  detectCrossedMilestones,
  formatKm,
  MILESTONES,
  milestoneSquigglePath,
  milestoneSubline,
  monthKey,
  nextDistanceMilestone,
  PawPrintWalk,
  possessivePronoun,
  previousMonthKey,
  RECAP_MIN_WALKS,
} from './pawPrints';

// Same banned list momentCard.test.ts enforces (Pawtchi Copy Spec v1).
const BANNED_WORDS = [
  'immediately', 'urgent', 'ensure', 'incredible', 'amazing', 'superstar',
  'alert', "don't forget", 'ai-powered',
];

function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

let nextId = 0;
function walk(overrides: Partial<PawPrintWalk> = {}): PawPrintWalk {
  nextId += 1;
  return {
    id: `w${nextId}`,
    startedAt: '2026-07-10T08:00:00Z',
    distanceM: 1500,
    durationS: 1200,
    sniffCount: 3,
    startLabel: 'Home',
    endLabel: null,
    farthestLabel: 'Riverside Park',
    ...overrides,
  };
}

describe('aggregateWalks', () => {
  test('totals distance, count, sniffs and first month', () => {
    const t = aggregateWalks([
      walk({ startedAt: '2026-05-02T08:00:00Z', distanceM: 2000, sniffCount: 5 }),
      walk({ startedAt: '2026-07-01T08:00:00Z', distanceM: 3000, sniffCount: 0 }),
    ]);
    expect(t.totalKm).toBeCloseTo(5);
    expect(t.walkCount).toBe(2);
    expect(t.totalSniffs).toBe(5);
    expect(t.firstWalkMonth).toBe('May');
  });

  test('favourite place is the modal label, recency breaks ties', () => {
    const t = aggregateWalks([
      walk({ startedAt: '2026-07-01T08:00:00Z', startLabel: 'Elm Street', farthestLabel: null }),
      walk({ startedAt: '2026-07-02T08:00:00Z', startLabel: 'Riverside Park', farthestLabel: null }),
      walk({ startedAt: '2026-07-03T08:00:00Z', startLabel: 'Riverside Park', farthestLabel: null }),
      walk({ startedAt: '2026-07-04T08:00:00Z', startLabel: 'Elm Street', farthestLabel: null }),
    ]);
    // 2–2 tie → Elm Street seen most recently.
    expect(t.favouritePlace).toBe('Elm Street');
  });

  test('longest walk keeps its session id and best label', () => {
    const t = aggregateWalks([
      walk({ id: 'short', distanceM: 900 }),
      walk({ id: 'long', distanceM: 5100, farthestLabel: 'Riverside Park' }),
    ]);
    expect(t.longestWalk).toEqual({ sessionId: 'long', km: 5.1, label: 'Riverside Park' });
  });

  test('distinct places dedupe across label columns; blanks ignored', () => {
    const t = aggregateWalks([
      walk({ startLabel: 'Home', endLabel: 'Home', farthestLabel: '  ' }),
      walk({ startLabel: 'Home', endLabel: 'Elm Street', farthestLabel: null }),
    ]);
    expect(t.distinctPlaces).toBe(2);
  });

  test('empty archive aggregates to zeroes, not crashes', () => {
    const t = aggregateWalks([]);
    expect(t.walkCount).toBe(0);
    expect(t.favouritePlace).toBeNull();
    expect(t.longestWalk).toBeNull();
    expect(t.firstWalkMonth).toBeNull();
  });
});

describe('milestone ladder', () => {
  test('ids are unique and stable-shaped', () => {
    const ids = MILESTONES.map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of MILESTONES) expect(m.id).toBe(`${m.family}_${m.threshold}`);
  });

  test('crossing detects only un-awarded rungs at/above threshold', () => {
    const totals = aggregateWalks([walk({ distanceM: 12_000, sniffCount: 0 })]);
    const crossed = detectCrossedMilestones(totals, []);
    expect(crossed.map(m => m.id)).toContain('distance_10');
    expect(crossed.map(m => m.id)).not.toContain('distance_25');
    expect(detectCrossedMilestones(totals, ['distance_10']).map(m => m.id))
      .not.toContain('distance_10');
  });

  test('one big archive can cross several rungs at once', () => {
    const walks = Array.from({ length: 26 }, (_, i) =>
      walk({ id: `n${i}`, distanceM: 1000, sniffCount: 4, startLabel: `Place ${i}`, farthestLabel: null }),
    );
    const crossed = detectCrossedMilestones(aggregateWalks(walks), []);
    const ids = crossed.map(m => m.id);
    expect(ids).toEqual(expect.arrayContaining(['distance_10', 'distance_25', 'walks_10', 'walks_25', 'places_5', 'places_15', 'sniffs_100']));
  });

  test('nextDistanceMilestone yields the goal-gradient line', () => {
    const totals = aggregateWalks([walk({ distanceM: 38_000 })]);
    expect(nextDistanceMilestone(totals)).toEqual({ threshold: 50, remainingKm: 12 });
    const done = aggregateWalks([walk({ distanceM: 600_000 })]);
    expect(nextDistanceMilestone(done)).toBeNull();
  });
});

describe('milestone copy', () => {
  test('distance line is grounded in the first walk month', () => {
    const def = MILESTONES.find(m => m.id === 'distance_50')!;
    expect(milestoneSubline(def, 'Bruno', 'male', 'May'))
      .toBe('Bruno and his human, every step since May.');
    expect(milestoneSubline(def, 'Luna', 'female', null))
      .toBe('Luna and her human, every step together.');
  });

  test('every family line for every pronoun passes brand voice', () => {
    for (const def of MILESTONES) {
      for (const gender of ['male', 'female', null]) {
        assertBrandVoice(milestoneSubline(def, 'Bruno', gender, 'May'));
      }
    }
    expect(possessivePronoun(null)).toBe('their');
  });

  test('squiggle is deterministic per milestone id', () => {
    const a = milestoneSquigglePath('distance_50', 120, 24);
    const b = milestoneSquigglePath('distance_50', 120, 24);
    const c = milestoneSquigglePath('walks_50', 120, 24);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^M/);
  });
});

describe('monthly recap', () => {
  const july = (over: Partial<PawPrintWalk>) =>
    walk({ startedAt: '2026-07-10T08:00:00Z', ...over });

  test('thin months build nothing', () => {
    const walks = Array.from({ length: RECAP_MIN_WALKS - 1 }, (_, i) => july({ id: `t${i}` }));
    expect(buildMonthlyRecap(walks, '2026-07', 'Bruno')).toBeNull();
  });

  test('recap filters to the month, orders tiles longest-first, caps at 6', () => {
    const walks = [
      ...Array.from({ length: 8 }, (_, i) => july({ id: `j${i}`, distanceM: (i + 1) * 1000 })),
      walk({ id: 'june', startedAt: '2026-06-15T08:00:00Z', distanceM: 99_000 }),
    ];
    const recap = buildMonthlyRecap(walks, '2026-07', 'Bruno')!;
    expect(recap.monthLabel).toBe('JULY');
    expect(recap.walkCount).toBe(8);
    expect(recap.tileSessionIds).toHaveLength(6);
    expect(recap.tileSessionIds[0]).toBe('j7');
    expect(recap.tileSessionIds).not.toContain('june');
    expect(recap.title).toBe('A month of walks with Bruno');
    expect(recap.longestLine).toBe('Longest walk: 8 km, out to Riverside Park.');
    assertBrandVoice(recap.title);
    assertBrandVoice(recap.longestLine!);
  });

  test('month keys roll over years correctly', () => {
    expect(monthKey(new Date(2026, 6, 22))).toBe('2026-07');
    expect(previousMonthKey(new Date(2026, 0, 5))).toBe('2025-12');
  });
});

describe('formatKm', () => {
  test('editorial rounding', () => {
    expect(formatKm(2.44)).toBe('2.4');
    expect(formatKm(12.4)).toBe('12');
    expect(formatKm(5)).toBe('5');
  });
});

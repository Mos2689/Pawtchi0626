import {
  buildSniffPins,
  buildWalkPins,
  sniffsForWalk,
  buildSniffItems,
  buildTodayTotals,
  buildWalkItems,
  buildWalkTitle,
  formatDuration,
  formatDwell,
  walkFeedLoadingCopy,
  type RailWalkSource,
} from './homeRail';

const NOW = new Date(2026, 6, 26, 18, 0, 0);
const todayAt = (h: number) => new Date(2026, 6, 26, h, 0, 0).toISOString();
const yesterdayAt = (h: number) => new Date(2026, 6, 25, h, 0, 0).toISOString();

function walk(over: Partial<RailWalkSource> = {}): RailWalkSource {
  return {
    id: 'w1',
    started_at: todayAt(9),
    duration_s: 2280,
    distance_m: 2400,
    route: [
      { lat: 15.55, lng: 73.76 },
      { lat: 15.56, lng: 73.77 },
    ],
    pause_points: [],
    sniff_points: null,
    start_label: null,
    end_label: null,
    farthest_label: null,
    ...over,
  };
}

describe('buildWalkTitle', () => {
  test('names a walk by where it went', () => {
    expect(
      buildWalkTitle(walk({ start_label: 'Elm Row', end_label: 'Fairhaven Green' })),
    ).toBe('Elm Row → Fairhaven Green');
  });

  test('a loop is named once, not "X → X"', () => {
    expect(buildWalkTitle(walk({ start_label: 'Arpora', end_label: 'Arpora' }))).toBe('Arpora');
  });

  test('falls back to the farthest point when there is no distinct end', () => {
    expect(
      buildWalkTitle(walk({ start_label: 'Arpora', end_label: 'Arpora', farthest_label: 'Baga' })),
    ).toBe('Arpora → Baga');
  });

  test('never invents a name when geocoding gave us nothing', () => {
    expect(buildWalkTitle(walk(), 'Bruno')).toBe("Bruno's walk");
    expect(buildWalkTitle(walk())).toBe('A walk');
  });

  test('blank labels count as absent, not as a name', () => {
    expect(buildWalkTitle(walk({ start_label: '   ', end_label: '' }), 'Bruno')).toBe(
      "Bruno's walk",
    );
  });
});

describe('buildWalkItems', () => {
  test('carries distance, duration and sniff count through', () => {
    const [item] = buildWalkItems(
      [
        walk({
          distance_m: 2400,
          duration_s: 2280,
          sniff_points: [
            { lat: 15.55, lng: 73.76, dwellS: 60 },
            { lat: 15.56, lng: 73.77, dwellS: 90 },
          ],
        }),
      ],
      'Bruno',
    );
    expect(item.km).toBeCloseTo(2.4);
    expect(item.minutes).toBe(38);
    expect(item.sniffCount).toBe(2);
  });

  test('survives a walk with no distance or route', () => {
    const [item] = buildWalkItems([walk({ distance_m: 0, duration_s: 0, route: null })], 'Bruno');
    expect(item.km).toBe(0);
    expect(item.minutes).toBe(0);
    expect(item.route).toBeNull();
  });
});

describe('buildSniffItems', () => {
  test('keeps the notable dwells and drops the incidental ones', () => {
    const items = buildSniffItems([
      walk({
        start_label: 'Elm Row',
        sniff_points: [
          { lat: 1, lng: 1, dwellS: 12 },
          { lat: 2, lng: 2, dwellS: 50 },
          { lat: 3, lng: 3, dwellS: 120 },
        ],
      }),
    ]);
    expect(items).toHaveLength(2);
    expect(items.map(i => i.dwellS)).toEqual([120, 50]);
    expect(items[0].title).toBe('Elm Row');
  });

  test('longest dwell leads, across walks', () => {
    const items = buildSniffItems([
      walk({ id: 'a', sniff_points: [{ lat: 1, lng: 1, dwellS: 60 }] }),
      walk({ id: 'b', sniff_points: [{ lat: 2, lng: 2, dwellS: 200 }] }),
    ]);
    expect(items[0].dwellS).toBe(200);
    expect(items[0].id).toBe('b:0');
  });

  test('a walk with no stops contributes nothing', () => {
    expect(buildSniffItems([walk({ sniff_points: [], pause_points: [] })])).toEqual([]);
  });
});

describe('buildWalkPins', () => {
  const walks = buildWalkItems([
    walk({ id: 'a', route: [{ lat: 1, lng: 1 }] }),
    walk({ id: 'b', route: [{ lat: 2, lng: 2 }] }),
    walk({ id: 'c', route: null }),
  ]);

  test('pins each walk start and skips routeless walks', () => {
    expect(buildWalkPins(walks, null).map(p => p.id)).toEqual(['a', 'b']);
  });

  test('the selected pin turns to ink, the others stay pastel', () => {
    const pins = buildWalkPins(walks, 'b');
    expect(pins.find(p => p.id === 'b')?.tone).toBe('ink');
    expect(pins.find(p => p.id === 'a')?.tone).not.toBe('ink');
  });
});

describe('sniffsForWalk / buildSniffPins', () => {
  const sniffs = buildSniffItems([
    walk({
      id: 'a',
      sniff_points: [
        { lat: 5, lng: 5, dwellS: 90 },
        { lat: 6, lng: 6, dwellS: 60 },
      ],
    }),
    walk({ id: 'b', sniff_points: [{ lat: 9, lng: 9, dwellS: 120 }] }),
  ]);

  test('scopes stops to one walk', () => {
    // Pins from a walk whose route is not drawn would scatter across empty map.
    const mine = sniffsForWalk(sniffs, 'a');
    expect(mine).toHaveLength(2);
    expect(mine.every(s => s.id.startsWith('a:'))).toBe(true);
  });

  test('a walk id that is a prefix of another does not steal its stops', () => {
    // Guards the `${walkId}:` delimiter — without the colon, 'a' would match
    // a walk called 'ab'.
    const others = buildSniffItems([
      walk({ id: 'ab', sniff_points: [{ lat: 1, lng: 1, dwellS: 90 }] }),
    ]);
    expect(sniffsForWalk(others, 'a')).toHaveLength(0);
  });

  test('returns nothing when no walk is selected', () => {
    expect(sniffsForWalk(sniffs, null)).toEqual([]);
  });

  test('pins every stop in the sniff tone', () => {
    const pins = buildSniffPins(sniffsForWalk(sniffs, 'a'), null);
    expect(pins).toHaveLength(2);
    expect(pins.every(p => p.tone === 'sniff')).toBe(true);
    expect(pins[0].lat).toBe(5);
  });

  test('the opened stop turns to ink, matching how a chosen walk reads', () => {
    const mine = sniffsForWalk(sniffs, 'a');
    const pins = buildSniffPins(mine, mine[0].id);
    expect(pins[0].tone).toBe('ink');
    expect(pins[1].tone).toBe('sniff');
  });
});

describe('buildTodayTotals', () => {
  test('counts only today, ignoring the rest of the window', () => {
    const totals = buildTodayTotals(
      [
        walk({ id: 'a', started_at: todayAt(9), distance_m: 2400, duration_s: 2280 }),
        walk({ id: 'b', started_at: todayAt(17), distance_m: 700, duration_s: 600 }),
        walk({ id: 'c', started_at: yesterdayAt(9), distance_m: 9000, duration_s: 9000 }),
      ],
      NOW,
    );
    expect(totals.walks).toBe(2);
    expect(totals.km).toBeCloseTo(3.1);
    expect(totals.minutes).toBe(48);
  });

  test('a day with no walks reads as zeros, not as empty', () => {
    expect(buildTodayTotals([walk({ started_at: yesterdayAt(9) })], NOW)).toEqual({
      walks: 0,
      km: 0,
      minutes: 0,
    });
  });
});

describe('duration formatting', () => {
  test('minutes below an hour, then hours', () => {
    expect(formatDuration(2280)).toBe('38 min');
    expect(formatDuration(3600)).toBe('1h');
    expect(formatDuration(4320)).toBe('1h 12m');
  });

  test('dwell stays in seconds while that is the honest unit', () => {
    expect(formatDwell(40)).toBe('40s');
    expect(formatDwell(89)).toBe('89s');
    expect(formatDwell(180)).toBe('3 min');
  });

  test('never emits a negative', () => {
    expect(formatDuration(-10)).toBe('0 min');
    expect(formatDwell(-10)).toBe('0s');
  });
});

describe('walkFeedLoadingCopy', () => {
  // Same locked brand voice every other user-facing string is held to.
  const BANNED_WORDS = [
    'immediately',
    'urgent',
    'ensure',
    'incredible',
    'amazing',
    'superstar',
    'alert',
    "don't forget",
    'ai-powered',
  ];

  const strings = [
    walkFeedLoadingCopy.title,
    walkFeedLoadingCopy.slowLine,
    ...walkFeedLoadingCopy.lines,
  ];

  test('every line is brand-voiced', () => {
    for (const s of strings) {
      expect(s).not.toContain('!');
      expect(s.toLowerCase()).not.toContain('your pet');
      for (const word of BANNED_WORDS) {
        expect(s.toLowerCase()).not.toContain(word);
      }
    }
  });

  test('has something to cycle through', () => {
    // LoadingCard rotates these on a timer; a single line reads as frozen.
    expect(walkFeedLoadingCopy.lines.length).toBeGreaterThan(1);
  });
});

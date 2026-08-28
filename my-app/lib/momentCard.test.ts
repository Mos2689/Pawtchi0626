import {
  buildCompanionPath,
  buildMomentHeadline,
  buildMomentJourneyLine,
  buildMomentShareBody,
  buildMomentShareMessage,
  buildMomentStats,
  buildOwnerPath,
  LEGACY_PAUSE_DWELL_S,
  MAX_CARD_LOOPS,
  momentDateLine,
  QUICK_WALK_MAX_S,
  resolveSniffStops,
  routeEndpoints,
  routeScaleBar,
  routeToSvgPath,
  subjectPronoun,
} from './momentCard';
import { PAWTCHI_INVITE_URL } from './referral';

// Words banned by the Pawtchi Copy Spec v1 (brand book § 6.04) — same list
// referral.test.ts enforces.
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

function sentenceCount(text: string): number {
  const withoutUrl = text.replace(PAWTCHI_INVITE_URL, '').trim();
  const matches = withoutUrl.match(/[.?]+/g);
  return matches ? matches.length : 0;
}

/** Every user-facing string must satisfy the locked brand voice. */
function assertBrandVoice(text: string) {
  expect(text).not.toContain('!');
  expect(text.toLowerCase()).not.toContain('your pet');
  for (const word of BANNED_WORDS) {
    expect(text.toLowerCase()).not.toContain(word);
  }
}

describe('momentDateLine', () => {
  test('reads as weekday day month', () => {
    // 2026-07-09 is a Thursday.
    const line = momentDateLine(new Date(2026, 6, 9, 7, 42));
    expect(line).toBe('Thursday 9 July');
    assertBrandVoice(line);
  });
});

describe('buildMomentJourneyLine', () => {
  test('A→B walk joins the two labels', () => {
    const line = buildMomentJourneyLine({
      startLabel: 'Riverside Park',
      endLabel: 'Elm Street',
      farthestLabel: null,
      isLoop: false,
    });
    expect(line).toBe('Riverside Park to Elm Street');
    assertBrandVoice(line!);
  });

  test('loop walk reads out-and-back with the farthest label', () => {
    const line = buildMomentJourneyLine({
      startLabel: 'Home',
      endLabel: 'Home',
      farthestLabel: 'Riverside Park',
      isLoop: true,
    });
    expect(line).toBe('Home out to Riverside Park, and back');
    assertBrandVoice(line!);
  });

  test('loop with only a start label still reads', () => {
    const line = buildMomentJourneyLine({
      startLabel: 'Elm Street',
      endLabel: null,
      farthestLabel: null,
      isLoop: true,
    });
    expect(line).toBe('From Elm Street, and back');
  });

  test('no labels → null, never a template leak', () => {
    const line = buildMomentJourneyLine({
      startLabel: null,
      endLabel: '  ',
      farthestLabel: null,
      isLoop: false,
    });
    expect(line).toBeNull();
  });
});

describe('buildMomentStats', () => {
  test('always shows distance and time, editorially formatted', () => {
    const stats = buildMomentStats({ durationS: 2040, movingTimeS: 2040, distanceM: 2400 });
    expect(stats).toEqual([
      { label: 'Distance', value: '2.4 km' },
      { label: 'Time', value: '34 min' },
    ]);
  });

  test('distance drops trailing noise: 3.00 → 3, 12.3 → 12', () => {
    expect(buildMomentStats({ durationS: 60, movingTimeS: 60, distanceM: 3000 })[0].value).toBe('3 km');
    expect(buildMomentStats({ durationS: 60, movingTimeS: 60, distanceM: 12300 })[0].value).toBe('12 km');
    expect(buildMomentStats({ durationS: 60, movingTimeS: 60, distanceM: 840 })[0].value).toBe('0.8 km');
  });

  test('prefers the real pause count when provided', () => {
    const stats = buildMomentStats({ durationS: 2040, movingTimeS: 1440, distanceM: 2400 }, 14);
    expect(stats[2]).toEqual({ label: 'Sniffs', value: '14' });

    const zero = buildMomentStats({ durationS: 2040, movingTimeS: 1440, distanceM: 2400 }, 0);
    expect(zero).toHaveLength(2);
  });

  test('falls back to stopped minutes when pause count is unknown', () => {
    const stats = buildMomentStats({ durationS: 2040, movingTimeS: 1440, distanceM: 2400 });
    expect(stats[2]).toEqual({ label: 'Sniffs', value: '10 min' });

    const noSniff = buildMomentStats({ durationS: 2040, movingTimeS: 2020, distanceM: 2400 });
    expect(noSniff).toHaveLength(2);
  });

  test('a sub-minute walk never shows zero minutes', () => {
    const stats = buildMomentStats({ durationS: 20, movingTimeS: 20, distanceM: 30 });
    expect(stats[1].value).toBe('1 min');
  });
});

describe('buildMomentShareMessage', () => {
  test('named pet, brand-voice compliant, carries the link', () => {
    const msg = buildMomentShareMessage('Bruno');
    expect(msg).toContain('Bruno');
    expect(msg).toContain(PAWTCHI_INVITE_URL);
    assertBrandVoice(msg);
    expect(sentenceCount(msg)).toBeLessThanOrEqual(3);
  });

  test('missing name reads cleanly and never leaks a token', () => {
    const msg = buildMomentShareMessage(null);
    expect(msg).not.toContain('undefined');
    expect(msg).not.toContain('null');
    expect(msg).toContain(PAWTCHI_INVITE_URL);
    assertBrandVoice(msg);
  });

  test('body variant never contains the URL (iOS passes it separately)', () => {
    const body = buildMomentShareBody('Luna');
    expect(body).not.toContain('http');
    assertBrandVoice(body);
  });
});

describe('routeToSvgPath', () => {
  const route = [
    { lat: 51.5000, lng: -0.1200 },
    { lat: 51.5020, lng: -0.1180 },
    { lat: 51.5040, lng: -0.1150 },
  ];

  test('fits every point inside the padded box', () => {
    const path = routeToSvgPath(route, 200, 100, 10)!;
    expect(path.startsWith('M')).toBe(true);
    const coords = path.split(' ').map(seg => seg.slice(1).split(',').map(Number));
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(190);
      expect(y).toBeGreaterThanOrEqual(10);
      expect(y).toBeLessThanOrEqual(90);
    }
  });

  test('north is up: the northernmost point gets the smallest y', () => {
    const path = routeToSvgPath(route, 200, 200, 0)!;
    const coords = path.split(' ').map(seg => seg.slice(1).split(',').map(Number));
    const yValues = coords.map(([, y]) => y);
    // Route runs south→north, so y must be strictly decreasing.
    expect(yValues[0]).toBeGreaterThan(yValues[2]);
  });

  test('degenerate traces return null', () => {
    expect(routeToSvgPath([], 100, 100, 8)).toBeNull();
    expect(routeToSvgPath([route[0]], 100, 100, 8)).toBeNull();
    expect(
      routeToSvgPath([route[0], { ...route[0] }], 100, 100, 8),
    ).toBeNull();
  });

  test('a straight east-west line still draws (zero lat span)', () => {
    const flat = [
      { lat: 51.5, lng: -0.12 },
      { lat: 51.5, lng: -0.10 },
    ];
    const path = routeToSvgPath(flat, 200, 100, 10);
    expect(path).not.toBeNull();
    const coords = path!.split(' ').map(seg => seg.slice(1).split(',').map(Number));
    // Centered vertically in the box.
    expect(coords[0][1]).toBeCloseTo(50, 0);
  });
});

describe('resolveSniffStops', () => {
  const pauses = [{ lat: 51.5, lng: -0.12 }];

  test('prefers sniff_points and passes dwell through', () => {
    const stops = resolveSniffStops([{ lat: 51.5, lng: -0.12, dwellS: 45 }], pauses);
    expect(stops).toEqual([{ lat: 51.5, lng: -0.12, dwellS: 45 }]);
  });

  test('empty sniff_points is a real "no sniffs" — never falls back', () => {
    expect(resolveSniffStops([], pauses)).toEqual([]);
  });

  test('null (pre-detector row) falls back to pauses at the legacy dwell', () => {
    expect(resolveSniffStops(null, pauses)).toEqual([
      { lat: 51.5, lng: -0.12, dwellS: LEGACY_PAUSE_DWELL_S },
    ]);
    expect(resolveSniffStops(undefined, null)).toEqual([]);
  });

  test('malformed entries are dropped, missing dwell gets the legacy weight', () => {
    const stops = resolveSniffStops(
      [{ lat: 'x', lng: -0.12 }, { lat: 51.5, lng: -0.12 }],
      pauses,
    );
    expect(stops).toEqual([{ lat: 51.5, lng: -0.12, dwellS: LEGACY_PAUSE_DWELL_S }]);
  });
});

describe('buildMomentHeadline', () => {
  // A comfortably long walk — clears the quick-walk threshold everywhere.
  const LONG = 30 * 60;

  test('a sniffy walk earns the signature line, with the right pronoun', () => {
    // Episode-rate thresholds: 12+ is the genuinely sniffy walk.
    expect(buildMomentHeadline('Bruno', 'male', 14, LONG)).toBe("You walked straight. He didn't.");
    expect(buildMomentHeadline('Luna', 'female', 12, LONG)).toBe("You walked straight. She didn't.");
    expect(buildMomentHeadline('Pip', null, 20, LONG)).toBe("You walked straight. They didn't.");
  });

  test('the modal walk (5–11 episodes) gets the characterful middle band', () => {
    expect(buildMomentHeadline('Bruno', 'male', 5, LONG)).toBe('Bruno caught up on the news');
    expect(buildMomentHeadline('Bruno', 'male', 8, LONG)).toBe('Bruno caught up on the news');
    expect(buildMomentHeadline('Bruno', 'male', 11, LONG)).toBe('Bruno caught up on the news');
    expect(buildMomentHeadline('Bruno', 'male', 1, LONG)).toBe('Bruno stopped for the good ones');
    expect(buildMomentHeadline('Bruno', 'male', 4, LONG)).toBe('Bruno stopped for the good ones');
  });

  test('zero stops: credit on a real walk, honesty on a short loop', () => {
    expect(buildMomentHeadline('Bruno', 'male', 0, LONG)).toBe("Bruno didn't stop once");
    expect(buildMomentHeadline('Bruno', 'male', 0, QUICK_WALK_MAX_S)).toBe("Bruno didn't stop once");
    expect(buildMomentHeadline('Bruno', 'male', 0, 4 * 60)).toBe('A quick one with Bruno');
  });

  test('missing name falls back cleanly and every variant is brand-voiced', () => {
    expect(buildMomentHeadline(null, null, 5, LONG)).toBe('A good walk');
    for (const h of [
      buildMomentHeadline('Bruno', 'male', 14, LONG),
      buildMomentHeadline('Bruno', 'male', 5, LONG),
      buildMomentHeadline('Bruno', 'male', 3, LONG),
      buildMomentHeadline('Bruno', 'male', 0, LONG),
      buildMomentHeadline('Bruno', 'male', 0, 3 * 60),
      buildMomentHeadline('', null, 3, LONG),
    ]) {
      assertBrandVoice(h);
    }
  });

  test('subjectPronoun mirrors possessive rules', () => {
    expect(subjectPronoun('male')).toBe('he');
    expect(subjectPronoun('female')).toBe('she');
    expect(subjectPronoun(null)).toBe('they');
  });
});

describe('buildOwnerPath / buildCompanionPath', () => {
  const route = [
    { lat: 51.5000, lng: -0.1200 },
    { lat: 51.5008, lng: -0.1192 },
    { lat: 51.5016, lng: -0.1181 },
    { lat: 51.5026, lng: -0.1174 },
    { lat: 51.5036, lng: -0.1162 },
  ];
  const pauses = [
    { lat: 51.5008, lng: -0.1192 },
    { lat: 51.5026, lng: -0.1174 },
  ];

  test('owner path is a smoothed cubic through the route', () => {
    const d = buildOwnerPath(route, 280, 380, 20)!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('C');
  });

  test('companion line is deterministic: same seed, same card, forever', () => {
    const a = buildCompanionPath(route, pauses, 280, 380, 20, 'session-abc');
    const b = buildCompanionPath(route, pauses, 280, 380, 20, 'session-abc');
    expect(a).toEqual(b);
  });

  test('a different walk id draws a different weave', () => {
    const a = buildCompanionPath(route, pauses, 280, 380, 20, 'session-abc')!;
    const b = buildCompanionPath(route, pauses, 280, 380, 20, 'session-xyz')!;
    expect(a.path).not.toBe(b.path);
  });

  test('one loop per real stop, at a point near the route', () => {
    const line = buildCompanionPath(route, pauses, 280, 380, 20, 'session-abc')!;
    expect(line.loops).toHaveLength(2);
    for (const loop of line.loops) {
      // No dwell on the stop → legacy 4-minute weight → near-max radius.
      expect(loop.r).toBeGreaterThanOrEqual(8);
      expect(loop.r).toBeLessThanOrEqual(10);
      expect(loop.x).toBeGreaterThan(0);
      expect(loop.x).toBeLessThan(280);
      expect(loop.y).toBeGreaterThan(0);
      expect(loop.y).toBeLessThan(380);
    }
  });

  test('a longer dwell draws a bigger ring than a short one', () => {
    const stops = [
      { ...pauses[0], dwellS: 30 },
      { ...pauses[1], dwellS: 240 },
    ];
    const line = buildCompanionPath(route, stops, 280, 380, 20, 'session-abc')!;
    expect(line.loops[1].r).toBeGreaterThan(line.loops[0].r);
    expect(line.loops[0].r).toBeGreaterThanOrEqual(4);
    expect(line.loops[0].r).toBeLessThanOrEqual(5);
  });

  test('caps the drawing at MAX_CARD_LOOPS, keeping the longest dwells', () => {
    // 14 stops along the route; dwells rise with index, so the shortest
    // four must be the ones dropped.
    const many = Array.from({ length: 14 }, (_, i) => ({
      lat: route[i % route.length].lat,
      lng: route[i % route.length].lng,
      dwellS: 30 + i * 10,
    }));
    const line = buildCompanionPath(route, many, 280, 380, 20, 'session-abc')!;
    expect(line.loops).toHaveLength(MAX_CARD_LOOPS);
    // The count is never capped — only the drawing is.
    expect(many).toHaveLength(14);
  });

  test('no pauses means no loops — the playfulness is never invented', () => {
    const line = buildCompanionPath(route, [], 280, 380, 20, 'session-abc')!;
    expect(line.loops).toHaveLength(0);
  });

  test('the paw sits just past the companion end; degenerate routes bail', () => {
    const line = buildCompanionPath(route, [], 280, 380, 20, 's')!;
    expect(Number.isFinite(line.paw.x)).toBe(true);
    expect(buildCompanionPath([], [], 280, 380, 20, 's')).toBeNull();
    expect(buildOwnerPath([route[0]], 280, 380, 20)).toBeNull();
  });
});

describe('routeScaleBar', () => {
  // ~0.9 km east-west at the equator (0.008° of longitude ≈ 890 m).
  const kmRoute = [
    { lat: 0, lng: 0 },
    { lat: 0.001, lng: 0.004 },
    { lat: 0, lng: 0.008 },
  ];

  test('picks a round distance that fits and stays legible', () => {
    const bar = routeScaleBar(kmRoute, 280, 200, 12)!;
    expect(bar).not.toBeNull();
    expect(['25 m', '50 m', '100 m', '250 m']).toContain(bar.label);
    expect(bar.px).toBeGreaterThanOrEqual(24);
    expect(bar.px).toBeLessThanOrEqual(280 * 0.35);
  });

  test('bar length is map-true: 100 m measures 100 m at the drawn scale', () => {
    const bar = routeScaleBar(kmRoute, 280, 200, 12)!;
    const meters = Number(bar.label.replace(' m', ''));
    // The route spans ~890 m over (280 - 24) drawn px → px/m ratio must match.
    const spanM = 0.008 * 111_320;
    const pxPerM = (280 - 24) / spanM;
    expect(bar.px).toBeCloseTo(meters * pxPerM, 0);
  });

  test('degenerate routes and unreadable scales return null', () => {
    expect(routeScaleBar([], 280, 200, 12)).toBeNull();
    // A 30 m stroll blown up to card size: even 25 m would overflow maxPx.
    const tiny = [
      { lat: 0, lng: 0 },
      { lat: 0.0002, lng: 0.0002 },
    ];
    const bar = routeScaleBar(tiny, 280, 200, 12);
    if (bar) {
      expect(bar.px).toBeGreaterThanOrEqual(24);
      expect(bar.px).toBeLessThanOrEqual(98);
    }
  });
});

describe('routeEndpoints', () => {
  test('returns the first and last projected points', () => {
    const route = [
      { lat: 51.5000, lng: -0.1200 },
      { lat: 51.5020, lng: -0.1180 },
    ];
    const ends = routeEndpoints(route, 200, 100, 10)!;
    const path = routeToSvgPath(route, 200, 100, 10)!;
    const coords = path.split(' ').map(seg => seg.slice(1).split(',').map(Number));
    expect(ends.start).toEqual({ x: coords[0][0], y: coords[0][1] });
    expect(ends.end).toEqual({ x: coords[1][0], y: coords[1][1] });
  });
});

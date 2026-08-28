/**
 * Keepsake geometry, time windows and row normalization.
 *
 * The refusal cases carry the weight here: snapping a photo to a route it was
 * never on, or trusting a malformed row, both produce a confidently wrong map —
 * which costs more trust than showing nothing would.
 */

import {
  IMPORT_GRACE_MS,
  ROUTE_SNAP_MAX_M,
  buildKeepsakeInsert,
  cumulativeDistances,
  elapsedSecondsInto,
  estimateRouteIndexByTime,
  isWithinWalkWindow,
  normalizeKeepsake,
  projectToRoute,
  snapToRoute,
  sortKeepsakes,
  type Keepsake,
} from './keepsake';

/** A short straight route heading north from Hyde Park, ~11 m per step. */
const ROUTE = [
  { lat: 51.5070, lng: -0.1657 },
  { lat: 51.5071, lng: -0.1657 },
  { lat: 51.5072, lng: -0.1657 },
  { lat: 51.5073, lng: -0.1657 },
  { lat: 51.5074, lng: -0.1657 },
];

describe('projectToRoute', () => {
  it('finds the nearest vertex', () => {
    const p = projectToRoute(ROUTE, { lat: 51.50721, lng: -0.1657 });
    expect(p?.index).toBe(2);
    expect(p?.distanceM).toBeLessThan(5);
  });

  it('returns null for an empty route rather than a bogus index 0', () => {
    expect(projectToRoute([], { lat: 51.5, lng: -0.16 })).toBeNull();
  });

  it('still resolves an endpoint when the point is past the end', () => {
    const p = projectToRoute(ROUTE, { lat: 51.5080, lng: -0.1657 });
    expect(p?.index).toBe(4);
  });
});

describe('snapToRoute', () => {
  it('pins a photo taken on the route', () => {
    expect(snapToRoute(ROUTE, { lat: 51.50715, lng: -0.1657 })).not.toBeNull();
  });

  it('refuses a photo that was plainly somewhere else', () => {
    // ~1.5 km east — an import that overlapped the walk window but was not on it.
    expect(snapToRoute(ROUTE, { lat: 51.5071, lng: -0.1440 })).toBeNull();
  });

  it('honours the boundary it advertises', () => {
    // 0.001° ≈ 111 m north of the last vertex: inside the 150 m default,
    // outside a 50 m one.
    const point = { lat: 51.5084, lng: -0.1657 };
    expect(snapToRoute(ROUTE, point, ROUTE_SNAP_MAX_M)).toBe(4);
    expect(snapToRoute(ROUTE, point, 50)).toBeNull();
  });
});

describe('cumulativeDistances', () => {
  it('starts at zero and increases monotonically', () => {
    const cumulative = cumulativeDistances(ROUTE);
    expect(cumulative[0]).toBe(0);
    for (let i = 1; i < cumulative.length; i++) {
      expect(cumulative[i]).toBeGreaterThan(cumulative[i - 1]);
    }
  });

  it('handles a single-point route', () => {
    expect(cumulativeDistances([ROUTE[0]])).toEqual([0]);
  });
});

describe('estimateRouteIndexByTime', () => {
  const start = 1_000_000;
  const end = start + 600_000; // ten minutes

  it('places the start at the beginning and the end at the end', () => {
    expect(estimateRouteIndexByTime(ROUTE, start, end, start)).toBe(0);
    expect(estimateRouteIndexByTime(ROUTE, start, end, end)).toBe(ROUTE.length - 1);
  });

  it('places a midpoint capture in the middle of the route', () => {
    const index = estimateRouteIndexByTime(ROUTE, start, end, start + 300_000);
    expect(index).toBe(2);
  });

  it('clamps a capture outside the window rather than running off the route', () => {
    expect(estimateRouteIndexByTime(ROUTE, start, end, start - 999_999)).toBe(0);
    expect(estimateRouteIndexByTime(ROUTE, start, end, end + 999_999)).toBe(ROUTE.length - 1);
  });

  it('returns null when there is no route or no usable window', () => {
    expect(estimateRouteIndexByTime([], start, end, start)).toBeNull();
    expect(estimateRouteIndexByTime(ROUTE, end, start, start)).toBeNull();
    expect(estimateRouteIndexByTime(ROUTE, NaN, end, start)).toBeNull();
  });

  it('falls back to the fraction when the trace never moved', () => {
    const stationary = [ROUTE[0], ROUTE[0], ROUTE[0]];
    expect(estimateRouteIndexByTime(stationary, start, end, start + 300_000)).toBe(1);
  });
});

describe('elapsedSecondsInto', () => {
  it('rounds to whole seconds', () => {
    expect(elapsedSecondsInto(1_000_000, 1_090_400)).toBe(90);
  });

  it('never goes negative for a grace-window capture', () => {
    expect(elapsedSecondsInto(1_000_000, 999_000)).toBe(0);
  });

  it('returns null for junk', () => {
    expect(elapsedSecondsInto(NaN, 1_000_000)).toBeNull();
  });
});

describe('isWithinWalkWindow', () => {
  const start = 1_000_000;
  const end = start + 600_000;

  it('accepts a capture during the walk', () => {
    expect(isWithinWalkWindow(start, end, start + 60_000)).toBe(true);
  });

  it('accepts the lead-clipping photo just before the tap on Start', () => {
    expect(isWithinWalkWindow(start, end, start - 30_000)).toBe(true);
  });

  it('rejects a photo well outside the window', () => {
    expect(isWithinWalkWindow(start, end, start - IMPORT_GRACE_MS - 1)).toBe(false);
    expect(isWithinWalkWindow(start, end, end + IMPORT_GRACE_MS + 1)).toBe(false);
  });

  it('rejects junk rather than importing the whole camera roll', () => {
    expect(isWithinWalkWindow(NaN, end, start)).toBe(false);
    expect(isWithinWalkWindow(start, end, NaN)).toBe(false);
  });
});

describe('normalizeKeepsake', () => {
  const row = {
    id: 'k1',
    walk_session_id: 'w1',
    pet_id: 'p1',
    captured_at: '2026-08-20T07:15:00.000Z',
    lat: 51.5071,
    lng: -0.1657,
    route_index: 2,
    elapsed_s: 90,
    media_type: 'photo',
    source: 'camera',
    local_asset_id: 'ph://ABC',
    width: 4032,
    height: 3024,
    thumb_path: 'thumbs/k1.jpg',
    thumb_blurhash: 'LKO2',
    place_key: '103014_-332',
    caption: null,
  };

  it('parses a well-formed row', () => {
    const k = normalizeKeepsake(row);
    expect(k?.id).toBe('k1');
    expect(k?.capturedAt).toBe(Date.parse('2026-08-20T07:15:00.000Z'));
    expect(k?.mediaType).toBe('photo');
    expect(k?.thumbPath).toBe('thumbs/k1.jpg');
  });

  it('accepts camelCase as well as the DB snake_case', () => {
    const k = normalizeKeepsake({
      id: 'k2',
      walkSessionId: 'w1',
      petId: 'p1',
      capturedAt: 1_700_000_000_000,
    });
    expect(k?.walkSessionId).toBe('w1');
    expect(k?.capturedAt).toBe(1_700_000_000_000);
  });

  it('drops rows missing an identity instead of rendering a ghost', () => {
    expect(normalizeKeepsake({ ...row, id: null })).toBeNull();
    expect(normalizeKeepsake({ ...row, walk_session_id: undefined })).toBeNull();
    expect(normalizeKeepsake({ ...row, pet_id: '' })).toBeNull();
  });

  it('drops rows with an unusable capture time — it is half the durable locator', () => {
    expect(normalizeKeepsake({ ...row, captured_at: 'not-a-date' })).toBeNull();
  });

  it('survives a null coordinate — a timestamp-only import is legitimate', () => {
    const k = normalizeKeepsake({ ...row, lat: null, lng: null, place_key: null });
    expect(k).not.toBeNull();
    expect(k?.lat).toBeNull();
    expect(k?.placeKey).toBeNull();
  });

  it('falls back to safe enum values rather than propagating garbage', () => {
    const k = normalizeKeepsake({ ...row, media_type: 'hologram', source: 'telepathy' });
    expect(k?.mediaType).toBe('photo');
    expect(k?.source).toBe('camera');
  });

  it('rejects non-objects', () => {
    expect(normalizeKeepsake(null)).toBeNull();
    expect(normalizeKeepsake('nope')).toBeNull();
  });
});

describe('buildKeepsakeInsert', () => {
  const base = {
    ownerId: 'o1',
    petId: 'p1',
    walkSessionId: 'w1',
    capturedAt: Date.parse('2026-08-20T07:15:00.000Z'),
    source: 'camera' as const,
  };

  it('writes the capture time as an ISO string', () => {
    expect(buildKeepsakeInsert(base).captured_at).toBe('2026-08-20T07:15:00.000Z');
  });

  it('keeps a real coordinate and its place key', () => {
    const row = buildKeepsakeInsert({
      ...base,
      lat: 51.5071,
      lng: -0.1657,
      placeKey: '103014_-332',
    });
    expect(row.lat).toBe(51.5071);
    expect(row.place_key).toBe('103014_-332');
  });

  it('refuses a place key when there is no coordinate to justify it', () => {
    // The rule that protects place memory: an estimated position places a pin
    // but must never enter the index as somewhere the dog stood.
    const row = buildKeepsakeInsert({
      ...base,
      lat: null,
      lng: null,
      routeIndex: 4,
      placeKey: '103014_-332',
    });
    expect(row.lat).toBeNull();
    expect(row.place_key).toBeNull();
    expect(row.route_index).toBe(4);
  });

  it('drops a half-coordinate rather than storing a meaningless point', () => {
    const row = buildKeepsakeInsert({ ...base, lat: 51.5071, lng: null, placeKey: 'x' });
    expect(row.lat).toBeNull();
    expect(row.place_key).toBeNull();
  });

  it('defaults media type to photo and preserves the source', () => {
    expect(buildKeepsakeInsert(base).media_type).toBe('photo');
    expect(buildKeepsakeInsert({ ...base, source: 'import' }).source).toBe('import');
  });

  it('nulls every optional field rather than sending undefined', () => {
    const row = buildKeepsakeInsert(base);
    for (const value of Object.values(row)) {
      expect(value).not.toBeUndefined();
    }
  });
});

describe('sortKeepsakes', () => {
  it('orders oldest first and does not mutate the input', () => {
    const input = [
      { capturedAt: 300 } as Keepsake,
      { capturedAt: 100 } as Keepsake,
      { capturedAt: 200 } as Keepsake,
    ];
    expect(sortKeepsakes(input).map((k) => k.capturedAt)).toEqual([100, 200, 300]);
    expect(input[0].capturedAt).toBe(300);
  });
});

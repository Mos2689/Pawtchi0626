import {
  TRAIL_MAX_POINTS,
  TRAIL_MAX_WALKS,
  buildMemoryMap,
  memoryMapHeadline,
  photoPinsForWalk,
  type MemoryMapWalk,
} from './memoryMap';
import type { Keepsake } from './walk/keepsake';
import type { GeoPoint } from './walk/geo';

/** A short but genuinely traceable route around Arpora. */
function route(from = 15.6, offset = 0): GeoPoint[] {
  return [
    { lat: from, lng: 73.75 + offset },
    { lat: from + 0.002, lng: 73.752 + offset },
    { lat: from + 0.003, lng: 73.749 + offset },
  ];
}

function walk(over: Partial<MemoryMapWalk> = {}): MemoryMapWalk {
  return {
    id: 'w1',
    started_at: '2026-08-10T09:00:00.000Z',
    route: route(),
    ...over,
  };
}

function keepsake(over: Partial<Keepsake> = {}): Keepsake {
  return {
    id: 'k1',
    walkSessionId: 'w1',
    petId: 'p1',
    capturedAt: Date.parse('2026-08-10T09:12:00.000Z'),
    lat: 15.601,
    lng: 73.751,
    routeIndex: 1,
    elapsedS: 720,
    mediaType: 'photo',
    source: 'camera',
    localPath: 'a.jpg',
    localAssetId: null,
    width: 1200,
    height: 1600,
    thumbPath: 'owner/k1.jpg',
    thumbBlurhash: null,
    placeKey: '31202_147502',
    caption: null,
    ...over,
  };
}

describe('buildMemoryMap — photo pins', () => {
  it('pins a moment that knows where it happened', () => {
    const map = buildMemoryMap({ walks: [walk()], keepsakes: [keepsake()] });
    expect(map.photoPins).toHaveLength(1);
    expect(map.photoPins[0]).toMatchObject({ id: 'k1', walkSessionId: 'w1' });
  });

  it('drops a moment with no coordinate', () => {
    // Its route position is estimated from elapsed time, which is honest on a
    // bare route drawing and a lie on a map with streets underneath.
    const map = buildMemoryMap({
      walks: [walk()],
      keepsakes: [keepsake({ lat: null, lng: null })],
    });
    expect(map.photoPins).toEqual([]);
  });

  it('drops a moment with only half a coordinate', () => {
    const map = buildMemoryMap({
      walks: [walk()],
      keepsakes: [keepsake({ lat: 15.6, lng: null })],
    });
    expect(map.photoPins).toEqual([]);
  });
});

describe('buildMemoryMap — tile pins', () => {
  it('gives a photo-less walk exactly one pin, at where it set off', () => {
    const map = buildMemoryMap({ walks: [walk()], keepsakes: [] });
    expect(map.tilePins).toHaveLength(1);
    expect(map.tilePins[0]).toMatchObject({ id: 'w1', lat: 15.6, lng: 73.75 });
  });

  it('gives a photographed walk no tile pin', () => {
    // Two pins for one walk would read as two walks.
    const map = buildMemoryMap({ walks: [walk()], keepsakes: [keepsake()] });
    expect(map.tilePins).toEqual([]);
    expect(map.photoPins).toHaveLength(1);
  });

  it('still pins a walk whose only moment was unplaced', () => {
    // The moment cannot be drawn, so the walk has to speak for itself — this is
    // the case that would otherwise vanish from the map entirely.
    const map = buildMemoryMap({
      walks: [walk()],
      keepsakes: [keepsake({ lat: null, lng: null })],
    });
    expect(map.photoPins).toEqual([]);
    expect(map.tilePins).toHaveLength(1);
  });

  it('pins each photo-less walk once, whatever the archive size', () => {
    const walks = Array.from({ length: 5 }, (_, i) =>
      walk({ id: `w${i}`, route: route(15.6 + i * 0.01) }),
    );
    const map = buildMemoryMap({ walks, keepsakes: [] });
    expect(map.tilePins.map((p) => p.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'w4']);
  });
});

describe('buildMemoryMap — routeless walks', () => {
  it('contributes nothing at all', () => {
    const map = buildMemoryMap({ walks: [walk({ route: null })], keepsakes: [] });
    expect(map.trails).toEqual([]);
    expect(map.tilePins).toEqual([]);
    expect(map.framing).toEqual([]);
  });

  it('contributes nothing when every point is malformed', () => {
    const map = buildMemoryMap({
      walks: [walk({ route: [{ lat: NaN, lng: 73.7 }] as GeoPoint[] })],
      keepsakes: [],
    });
    expect(map.trails).toEqual([]);
    expect(map.tilePins).toEqual([]);
  });

  it('still pins a photo taken on a walk whose route was lost', () => {
    // The photograph carries its own coordinate; it does not need the route.
    const map = buildMemoryMap({
      walks: [walk({ route: null })],
      keepsakes: [keepsake()],
    });
    expect(map.photoPins).toHaveLength(1);
    expect(map.framing).toEqual([{ lat: 15.601, lng: 73.751 }]);
  });
});

describe('buildMemoryMap — trails', () => {
  it('draws newest first', () => {
    const map = buildMemoryMap({
      walks: [
        walk({ id: 'old', started_at: '2026-01-01T09:00:00.000Z', route: route(15.1) }),
        walk({ id: 'new', started_at: '2026-09-01T09:00:00.000Z', route: route(15.9) }),
      ],
      keepsakes: [],
    });
    expect(map.trails[0][0].lat).toBeCloseTo(15.9);
    expect(map.tilePins.map((p) => p.id)).toEqual(['new', 'old']);
  });

  it('caps how many walks are drawn', () => {
    const walks = Array.from({ length: TRAIL_MAX_WALKS + 20 }, (_, i) =>
      walk({ id: `w${i}`, route: route(15.6 + i * 0.001) }),
    );
    const map = buildMemoryMap({ walks, keepsakes: [] });
    expect(map.trails).toHaveLength(TRAIL_MAX_WALKS);
    // The cap is on the DRAWING, not on the archive: every walk still gets a
    // pin, so nothing becomes unreachable because it fell off the trail budget.
    expect(map.tilePins).toHaveLength(TRAIL_MAX_WALKS + 20);
  });

  it('simplifies a long route down to the drawing budget', () => {
    const long: GeoPoint[] = Array.from({ length: 200 }, (_, i) => ({
      lat: 15.6 + i * 0.0002,
      lng: 73.75 + Math.sin(i / 6) * 0.002,
    }));
    const map = buildMemoryMap({ walks: [walk({ route: long })], keepsakes: [] });
    expect(map.trails[0].length).toBeLessThanOrEqual(TRAIL_MAX_POINTS);
    // The ends are the walk; simplification may only thin the middle.
    expect(map.trails[0][0]).toEqual(long[0]);
    expect(map.trails[0][map.trails[0].length - 1]).toEqual(long[long.length - 1]);
  });
});

describe('buildMemoryMap — framing', () => {
  it('covers every point the map will draw', () => {
    const map = buildMemoryMap({
      walks: [
        walk({ id: 'w1', route: route(15.6) }),
        walk({ id: 'w2', started_at: '2026-08-01T09:00:00.000Z', route: route(15.8, 0.05) }),
      ],
      keepsakes: [keepsake({ walkSessionId: 'w1', lat: 15.4, lng: 73.6 })],
    });

    const lats = map.framing.map((p) => p.lat);
    const lngs = map.framing.map((p) => p.lng);
    // The photo sits south-west of every route, so a frame that missed it would
    // open with the pin off-screen.
    expect(Math.min(...lats)).toBeCloseTo(15.4);
    expect(Math.max(...lats)).toBeCloseTo(15.803);
    expect(Math.min(...lngs)).toBeCloseTo(73.6);
    expect(Math.max(...lngs)).toBeCloseTo(73.802);
  });

  it('is empty when there is nothing to draw', () => {
    expect(buildMemoryMap({ walks: [], keepsakes: [] }).framing).toEqual([]);
  });
});

describe('photoPinsForWalk', () => {
  it('returns one walk’s moments, oldest first', () => {
    const map = buildMemoryMap({
      walks: [walk({ id: 'w1' }), walk({ id: 'w2', route: route(15.7) })],
      keepsakes: [
        keepsake({ id: 'late', walkSessionId: 'w1', capturedAt: 3000 }),
        keepsake({ id: 'other', walkSessionId: 'w2', capturedAt: 1000 }),
        keepsake({ id: 'early', walkSessionId: 'w1', capturedAt: 2000 }),
      ],
    });
    expect(photoPinsForWalk(map.photoPins, 'w1').map((p) => p.id)).toEqual(['early', 'late']);
  });

  it('is empty for a walk with no moments', () => {
    const map = buildMemoryMap({ walks: [walk()], keepsakes: [] });
    expect(photoPinsForWalk(map.photoPins, 'w1')).toEqual([]);
  });
});

describe('memoryMapHeadline', () => {
  it('states the ground covered and where', () => {
    expect(memoryMapHeadline(128.4, 14)).toBe('128 km across 14 places');
  });

  it('keeps one decimal below a hundred kilometres', () => {
    expect(memoryMapHeadline(8.25, 3)).toBe('8.3 km across 3 places');
  });

  it('says place, singular, for one', () => {
    expect(memoryMapHeadline(2, 1)).toBe('2 km across 1 place');
  });

  it('says nothing rather than nothing-shaped', () => {
    expect(memoryMapHeadline(0, 4)).toBeNull();
    expect(memoryMapHeadline(12, 0)).toBeNull();
  });
});

import {
  MAX_ROUTE_FETCHES_PER_WALK,
  REROUTE_DRIFT_M,
  REROUTE_MIN_INTERVAL_MS,
  RouteFetchState,
  shouldFetchRoute,
} from './routePolicy';
import { fetchWalkingRoute, parseOsrmWalkingRoute, prefetchWalkingRoute } from './routeClient';
import { distanceToPathM } from './geo';

const NOW = 1_700_000_000_000;

function state(overrides: Partial<RouteFetchState> = {}): RouteFetchState {
  return {
    hasRoute: true,
    fetchCount: 1,
    lastFetchAt: NOW - REROUTE_MIN_INTERVAL_MS,
    driftM: 0,
    inFlight: false,
    wanted: true,
    ...overrides,
  };
}

describe('shouldFetchRoute', () => {
  it('makes the first request for a walk with a destination', () => {
    expect(
      shouldFetchRoute(state({ hasRoute: false, fetchCount: 0, lastFetchAt: null }), NOW),
    ).toBe('fetch');
  });

  it('does not gate the first request on drift or interval', () => {
    // There is no line yet, so there is nothing to be off.
    const first = state({ hasRoute: false, fetchCount: 0, lastFetchAt: null, driftM: null });
    expect(shouldFetchRoute(first, NOW)).toBe('fetch');
  });

  it('never fetches without a destination', () => {
    expect(shouldFetchRoute(state({ wanted: false, hasRoute: false }), NOW)).toBe('skip');
  });

  it('never starts a second request while one is in flight', () => {
    expect(shouldFetchRoute(state({ inFlight: true, hasRoute: false }), NOW)).toBe('skip');
  });

  it('does not hammer the server every evaluator tick after a failed first request', () => {
    const failedRecently = state({
      hasRoute: false,
      fetchCount: 1,
      lastFetchAt: NOW - 10_000,
      driftM: null,
    });
    expect(shouldFetchRoute(failedRecently, NOW)).toBe('skip');
    expect(
      shouldFetchRoute(failedRecently, NOW + REROUTE_MIN_INTERVAL_MS),
    ).toBe('fetch');
  });

  describe('re-routing', () => {
    it('ignores a wander that stays near the line', () => {
      expect(shouldFetchRoute(state({ driftM: REROUTE_DRIFT_M - 1 }), NOW)).toBe('skip');
    });

    it('re-routes once genuinely off the line', () => {
      expect(shouldFetchRoute(state({ driftM: REROUTE_DRIFT_M }), NOW)).toBe('fetch');
    });

    it('holds off until the interval has passed, however far off', () => {
      const justFetched = state({ driftM: 5000, lastFetchAt: NOW - 1000 });
      expect(shouldFetchRoute(justFetched, NOW)).toBe('skip');
    });

    it('skips when there is no fix to measure drift from', () => {
      expect(shouldFetchRoute(state({ driftM: null }), NOW)).toBe('skip');
    });
  });

  describe('the cap, which protects someone else’s server', () => {
    it('stops at the ceiling even for a walk far off the line', () => {
      const maxed = state({ fetchCount: MAX_ROUTE_FETCHES_PER_WALK, driftM: 10_000 });
      expect(shouldFetchRoute(maxed, NOW)).toBe('skip');
    });

    it('cannot be exceeded by any sequence of drifts', () => {
      // Simulate a walk that is always far off and always past the interval —
      // the worst case for the endpoint. It must still stop at the cap.
      let fetchCount = 0;
      let lastFetchAt: number | null = null;
      let now = NOW;

      for (let tick = 0; tick < 200; tick++) {
        const decision = shouldFetchRoute(
          { hasRoute: fetchCount > 0, fetchCount, lastFetchAt, driftM: 9999, inFlight: false, wanted: true },
          now,
        );
        if (decision === 'fetch') {
          fetchCount++;
          lastFetchAt = now;
        }
        now += REROUTE_MIN_INTERVAL_MS;
      }

      expect(fetchCount).toBe(MAX_ROUTE_FETCHES_PER_WALK);
    });
  });
});

describe('parseOsrmWalkingRoute', () => {
  const valid = {
    code: 'Ok',
    routes: [{
      distance: 1379.1,
      duration: 1103.4,
      geometry: {
        type: 'LineString',
        // OSRM GeoJSON is [longitude, latitude], not the app's {lat, lng}.
        coordinates: [[151.2093, -33.8688], [151.214, -33.8587]],
      },
    }],
  };

  it('converts GeoJSON coordinate order and rounds provider metrics', () => {
    expect(parseOsrmWalkingRoute(valid)).toEqual({
      path: [
        { lat: -33.8688, lng: 151.2093 },
        { lat: -33.8587, lng: 151.214 },
      ],
      distanceM: 1379,
      durationS: 1103,
    });
  });

  it.each([
    null,
    {},
    { code: 'NoRoute', routes: [] },
    { code: 'Ok', routes: [{ geometry: { type: 'Point', coordinates: [] } }] },
    { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[0, 0]] } }] },
    { code: 'Ok', routes: [{ geometry: { type: 'LineString', coordinates: [[200, 0], [0, 0]] } }] },
  ])('rejects malformed or unusable provider data', body => {
    expect(parseOsrmWalkingRoute(body)).toBeNull();
  });
});

describe('route prefetch', () => {
  it('lets the walk screen join the request Home already started', async () => {
    const originalFetch = global.fetch;
    const responseBody = {
      code: 'Ok',
      routes: [{
        distance: 1200,
        duration: 900,
        geometry: {
          type: 'LineString',
          coordinates: [[73.75, 15.54], [73.76, 15.55]],
        },
      }],
    };
    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => responseBody,
    });
    global.fetch = mockFetch as typeof fetch;

    try {
      const from = { lat: 15.54, lng: 73.75 };
      const to = { lat: 15.55, lng: 73.76 };
      prefetchWalkingRoute(from, to);
      const result = await fetchWalkingRoute(from, to);

      expect(result?.path).toHaveLength(2);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe('distanceToPathM', () => {
  const path = [
    { lat: 15.5439, lng: 73.7553 },
    { lat: 15.5449, lng: 73.7553 },
  ];

  it('is near zero on the line', () => {
    expect(distanceToPathM({ lat: 15.5444, lng: 73.7553 }, path)).toBeLessThan(1);
  });

  it('measures perpendicular to the segment, not to the nearest vertex', () => {
    // Beside the middle of the segment: vertex distance would be much larger.
    const beside = { lat: 15.5444, lng: 73.7563 };
    const perpendicular = distanceToPathM(beside, path);
    const toNearestVertex = Math.min(
      distanceToPathM(beside, [path[0]]),
      distanceToPathM(beside, [path[1]]),
    );
    expect(perpendicular).toBeLessThan(toNearestVertex);
  });

  it('reports Infinity when there is no path to be off', () => {
    expect(distanceToPathM({ lat: 15.5444, lng: 73.7553 }, [])).toBe(Infinity);
  });
});

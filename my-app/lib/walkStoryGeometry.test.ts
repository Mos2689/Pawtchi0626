import {
  MAX_STORY_ROUTE_POINTS,
  buildCadencePath,
  buildScentContours,
  contourRingCount,
  formatStoryCoordinate,
  projectStoryRoute,
  resampleStoryRoute,
  selectStoryStops,
} from './walkStoryGeometry';

const ROUTE = Array.from({ length: 800 }, (_, index) => ({
  lat: 15.56 + index * 0.000001,
  lng: 73.75 + Math.sin(index / 40) * 0.002,
}));

describe('walkStoryGeometry', () => {
  test('resamples long routes while preserving both ends', () => {
    const sampled = resampleStoryRoute(ROUTE);
    expect(sampled).toHaveLength(MAX_STORY_ROUTE_POINTS);
    expect(sampled[0]).toEqual(ROUTE[0]);
    expect(sampled[sampled.length - 1]).toEqual(ROUTE[ROUTE.length - 1]);
  });

  test('projects route and stops inside the requested viewport', () => {
    const geometry = projectStoryRoute(
      ROUTE,
      [{ ...ROUTE[350], dwellS: 180 }],
      320,
      500,
      24,
    );
    expect(geometry).not.toBeNull();
    for (const point of [...geometry!.points, ...geometry!.stops]) {
      expect(point.x).toBeGreaterThanOrEqual(24);
      expect(point.x).toBeLessThanOrEqual(296);
      expect(point.y).toBeGreaterThanOrEqual(24);
      expect(point.y).toBeLessThanOrEqual(476);
    }
  });

  test('rejects malformed and degenerate routes', () => {
    expect(projectStoryRoute([], [], 320, 500, 24)).toBeNull();
    expect(
      projectStoryRoute(
        [
          { lat: 1, lng: 1 },
          { lat: 1, lng: 1 },
        ],
        [],
        320,
        500,
        24,
      ),
    ).toBeNull();
  });

  test('keeps the longest stops and restores recorded order', () => {
    const selected = selectStoryStops(
      [
        { lat: 1, lng: 1, dwellS: 20 },
        { lat: 2, lng: 2, dwellS: 200 },
        { lat: 3, lng: 3, dwellS: 100 },
      ],
      2,
    );
    expect(selected.map((item) => item.sourceIndex)).toEqual([1, 2]);
  });

  test('scent contours are stable and dwell-bounded', () => {
    const first = buildScentContours({ x: 100, y: 100 }, 70, 180, 'walk-42');
    const second = buildScentContours({ x: 100, y: 100 }, 70, 180, 'walk-42');
    expect(first).toEqual(second);
    expect(first).toHaveLength(contourRingCount(180));
    expect(contourRingCount(0)).toBe(5);
    expect(contourRingCount(10_000)).toBe(12);
  });

  test('utility paths and coordinate labels remain finite', () => {
    expect(buildCadencePath(300, 50, 20, 4)).not.toContain('NaN');
    expect(formatStoryCoordinate(15.567, 'lat')).toBe('15.5670° N');
    expect(formatStoryCoordinate(-73.75, 'lng')).toBe('73.7500° W');
  });
});

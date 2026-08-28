/**
 * Route projection, and the shared-transform guarantee.
 *
 * The load-bearing test is `projectOntoRoute` agreeing with `projectRouteToSvg`
 * for a point that IS on the route. If those two ever drift, photos float
 * beside the line instead of sitting on it — and the error is small enough to
 * ship unnoticed and obvious enough to ruin the artifact once someone looks at
 * their own walk.
 */

import { projectOntoRoute, projectRouteToSvg, routeTransform } from './routeSvg';

const ROUTE = [
  { lat: 15.5445, lng: 73.7625 },
  { lat: 15.5447, lng: 73.7627 },
  { lat: 15.5449, lng: 73.7626 },
  { lat: 15.5451, lng: 73.7629 },
];

const W = 300;
const H = 200;

describe('projectRouteToSvg', () => {
  it('draws every vertex', () => {
    const { points } = projectRouteToSvg(ROUTE, W, H);
    expect(points.split(' ')).toHaveLength(ROUTE.length);
  });

  it('returns endpoints for the start and finish dots', () => {
    const { start, end } = projectRouteToSvg(ROUTE, W, H);
    expect(start).not.toBeNull();
    expect(end).not.toBeNull();
    expect(start).not.toEqual(end);
  });

  it('keeps the whole trace inside the box', () => {
    const { points } = projectRouteToSvg(ROUTE, W, H);
    for (const pair of points.split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(W);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(H);
    }
  });

  it('degrades to an empty drawing rather than throwing', () => {
    expect(projectRouteToSvg([], W, H)).toEqual({ points: '', start: null, end: null });
    expect(projectRouteToSvg([ROUTE[0]], W, H).points).toBe('');
  });
});

describe('routeTransform', () => {
  it('is null for a route too short to fit', () => {
    expect(routeTransform([], W, H)).toBeNull();
    expect(routeTransform([ROUTE[0]], W, H)).toBeNull();
  });

  it('is deterministic', () => {
    const a = routeTransform(ROUTE, W, H)!;
    const b = routeTransform(ROUTE, W, H)!;
    expect(a(ROUTE[2])).toEqual(b(ROUTE[2]));
  });
});

describe('projectOntoRoute', () => {
  it('puts a point that is ON the route exactly on the drawn line', () => {
    // The guarantee the story slide depends on.
    const drawn = projectRouteToSvg(ROUTE, W, H)
      .points.split(' ')
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number);
        return { x, y };
      });
    const pins = projectOntoRoute(ROUTE, ROUTE, W, H);
    expect(pins).toEqual(drawn);
  });

  it('places a midpoint between its neighbours', () => {
    const mid = { lat: 15.5446, lng: 73.7626 };
    const [a, m, b] = projectOntoRoute(ROUTE, [ROUTE[0], mid, ROUTE[1]], W, H);
    const between = (v: number, p: number, q: number) =>
      v >= Math.min(p, q) - 0.5 && v <= Math.max(p, q) + 0.5;
    expect(between(m.x, a.x, b.x)).toBe(true);
    expect(between(m.y, a.y, b.y)).toBe(true);
  });

  it('honours the same padding as the route', () => {
    const tight = projectOntoRoute(ROUTE, [ROUTE[0]], W, H, 0);
    const padded = projectOntoRoute(ROUTE, [ROUTE[0]], W, H, 40);
    expect(tight[0]).not.toEqual(padded[0]);
  });

  it('returns nothing when there is no route to project against', () => {
    expect(projectOntoRoute([], [ROUTE[0]], W, H)).toEqual([]);
  });

  it('returns one entry per target, in order', () => {
    const pins = projectOntoRoute(ROUTE, [ROUTE[3], ROUTE[0]], W, H);
    expect(pins).toHaveLength(2);
    expect(pins[0]).not.toEqual(pins[1]);
  });
});

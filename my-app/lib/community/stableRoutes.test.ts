import { reuseRoutes, sameRoute } from './stableRoutes';

const route = (id: string, pts: [number, number][], color = '#F4F600', dashed = false) => ({
  id,
  color,
  dashed,
  path: pts.map(([lat, lng]) => ({ lat, lng })),
});

describe('reuseRoutes', () => {
  it('returns a copy on the first build', () => {
    const next = [route('a#0', [[1, 1], [2, 2]])];
    const out = reuseRoutes(next, null);
    expect(out).toEqual(next);
  });

  it('hands back the previous ARRAY when a reload changed nothing', () => {
    const previous = [route('a#0', [[1, 1], [2, 2]]), route('b#0', [[3, 3]], '#144EFF')];
    const reloaded = [route('a#0', [[1, 1], [2, 2]]), route('b#0', [[3, 3]], '#144EFF')];
    expect(reuseRoutes(reloaded, previous)).toBe(previous);
  });

  it('reuses unchanged routes and takes the changed one', () => {
    const previous = [route('a#0', [[1, 1]]), route('b#0', [[3, 3]])];
    const reloaded = [route('a#0', [[1, 1]]), route('b#0', [[3, 3], [4, 4]])];
    const out = reuseRoutes(reloaded, previous);
    expect(out).not.toBe(previous);
    expect(out[0]).toBe(previous[0]);
    expect(out[1]).toBe(reloaded[1]);
  });

  it('notices a single moved point', () => {
    const previous = [route('a#0', [[1, 1], [2, 2]])];
    const reloaded = [route('a#0', [[1, 1], [2, 2.000001]])];
    expect(reuseRoutes(reloaded, previous)[0]).toBe(reloaded[0]);
  });

  it('notices a colour change', () => {
    const previous = [route('a#0', [[1, 1]], '#F4F600')];
    const reloaded = [route('a#0', [[1, 1]], '#144EFF')];
    expect(reuseRoutes(reloaded, previous)[0]).toBe(reloaded[0]);
  });

  it('is a new array when a route was added, keeping the old objects', () => {
    const previous = [route('a#0', [[1, 1]])];
    const reloaded = [route('a#0', [[1, 1]]), route('b#0', [[2, 2]])];
    const out = reuseRoutes(reloaded, previous);
    expect(out).not.toBe(previous);
    expect(out[0]).toBe(previous[0]);
    expect(out).toHaveLength(2);
  });

  it('is a new array when the order changed', () => {
    const a = route('a#0', [[1, 1]]);
    const b = route('b#0', [[2, 2]]);
    const out = reuseRoutes([b, a], [a, b]);
    expect(out).not.toBe(undefined);
    expect(out.map(r => r.id)).toEqual(['b#0', 'a#0']);
  });
});

describe('sameRoute', () => {
  it('compares id, colour, dash and every point', () => {
    expect(sameRoute(route('a', [[1, 1]]), route('a', [[1, 1]]))).toBe(true);
    expect(sameRoute(route('a', [[1, 1]]), route('b', [[1, 1]]))).toBe(false);
    expect(sameRoute(route('a', [[1, 1]], '#000', false), route('a', [[1, 1]], '#000', true))).toBe(false);
  });
});

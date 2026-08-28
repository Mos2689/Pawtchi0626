import { firstRoutePoint, parseRoutePoints } from './routeJson';

describe('parseRoutePoints', () => {
  test('reads the tuple shape the original tracker wrote', () => {
    expect(parseRoutePoints([[15.5, 73.7], [15.6, 73.8]])).toEqual([
      { lat: 15.5, lng: 73.7 },
      { lat: 15.6, lng: 73.8 },
    ]);
  });

  test('reads the object shape everything since has written', () => {
    expect(parseRoutePoints([{ lat: 15.5, lng: 73.7 }])).toEqual([{ lat: 15.5, lng: 73.7 }]);
  });

  // Both shapes are genuinely in the table, and a row can only be one of them,
  // but a reader that assumed either would silently return nothing for half the
  // history.
  test('a mixed array is read rather than rejected', () => {
    expect(parseRoutePoints([[15.5, 73.7], { lat: 15.6, lng: 73.8 }])).toHaveLength(2);
  });

  test('one corrupt fix costs that fix, not the walk', () => {
    const points = parseRoutePoints([
      [15.5, 73.7],
      [null, 73.8],
      { lat: 'x', lng: 73.9 },
      { lat: 15.7, lng: 73.95 },
    ]);
    expect(points).toEqual([
      { lat: 15.5, lng: 73.7 },
      { lat: 15.7, lng: 73.95 },
    ]);
  });

  test('anything that is not an array is an empty route, never a throw', () => {
    expect(parseRoutePoints(null)).toEqual([]);
    expect(parseRoutePoints(undefined)).toEqual([]);
    expect(parseRoutePoints('[]')).toEqual([]);
    expect(parseRoutePoints({ lat: 1, lng: 2 })).toEqual([]);
    expect(parseRoutePoints([])).toEqual([]);
  });
});

describe('firstRoutePoint', () => {
  test('returns the first usable point in either shape', () => {
    expect(firstRoutePoint([[15.5, 73.7]])).toEqual({ lat: 15.5, lng: 73.7 });
    expect(firstRoutePoint([{ lat: 15.5, lng: 73.7 }])).toEqual({ lat: 15.5, lng: 73.7 });
  });

  test('skips leading rubbish rather than giving up on the route', () => {
    expect(firstRoutePoint([[NaN, NaN], [15.5, 73.7]])).toEqual({ lat: 15.5, lng: 73.7 });
  });

  test('no usable point returns null', () => {
    expect(firstRoutePoint([])).toBeNull();
    expect(firstRoutePoint(null)).toBeNull();
    expect(firstRoutePoint([[NaN, 1]])).toBeNull();
  });
});

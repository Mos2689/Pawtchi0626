import {
  clearActiveRouteSession,
  ensureActiveRouteSession,
  readActiveRouteSession,
  recordActiveRoute,
  recordActiveRouteRequest,
} from './activeRouteSession';

const ROUTE = [{ lat: 15.54, lng: 73.75 }, { lat: 15.55, lng: 73.76 }];

afterEach(() => clearActiveRouteSession());

describe('active OSM route presentation session', () => {
  it('restores geometry and request policy for the same walk and destination', () => {
    ensureActiveRouteSession('walk-a', 'park');
    recordActiveRouteRequest('walk-a', 'park', 1234);
    recordActiveRoute('walk-a', 'park', ROUTE);

    expect(readActiveRouteSession('walk-a', 'park')).toEqual({
      walkId: 'walk-a',
      destinationKey: 'park',
      route: ROUTE,
      fetchCount: 1,
      lastFetchAt: 1234,
    });
  });

  it('never restores a route into another walk or destination', () => {
    recordActiveRoute('walk-a', 'park', ROUTE);
    expect(readActiveRouteSession('walk-b', 'park')).toBeNull();
    expect(readActiveRouteSession('walk-a', 'beach')).toBeNull();
  });

  it('does not reset the request count when the screen remounts', () => {
    recordActiveRouteRequest('walk-a', 'park', 1000);
    const reopened = ensureActiveRouteSession('walk-a', 'park');
    expect(reopened.fetchCount).toBe(1);
    expect(reopened.lastFetchAt).toBe(1000);
  });

  it('lets only the matching walk clear the active route', () => {
    recordActiveRoute('walk-a', 'park', ROUTE);
    clearActiveRouteSession('walk-b');
    expect(readActiveRouteSession('walk-a', 'park')?.route).toEqual(ROUTE);
    clearActiveRouteSession('walk-a');
    expect(readActiveRouteSession('walk-a', 'park')).toBeNull();
  });
});

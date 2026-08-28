import { VISIT_RADIUS_M, buildVisitIndex, routePassesNear } from './visited';
import type { PawtchiSpot, SpotCategory } from './types';
import type { GeoPoint } from '../walk/geo';

const HERE = { lat: 15.5449, lng: 73.7553 };

/** A point `metres` due north. Latitude degrees are ~111.32 km everywhere. */
function north(from: GeoPoint, metres: number): GeoPoint {
  return { lat: from.lat + metres / 111_320, lng: from.lng };
}

function spot(over: Partial<PawtchiSpot> & { id: string }): PawtchiSpot {
  return {
    provider: 'osm',
    providerPlaceId: 'node/1',
    category: 'dog_friendly_park',
    name: 'Park',
    latitude: HERE.lat,
    longitude: HERE.lng,
    dogAccess: 'unknown',
    accessDescription: null,
    address: null,
    openingHours: null,
    website: null,
    phone: null,
    surface: null,
    fenced: null,
    lit: null,
    dogWaterConfirmed: false,
    emergencyCareConfirmed: false,
    ...over,
  } as PawtchiSpot;
}

describe('routePassesNear', () => {
  test('a route that comes inside the radius counts', () => {
    expect(routePassesNear([north(HERE, 500), north(HERE, 40)], HERE, 60)).toBe(true);
  });

  test('a route that stays outside it does not', () => {
    expect(routePassesNear([north(HERE, 500), north(HERE, 90)], HERE, 60)).toBe(false);
  });

  test('an empty route visits nothing', () => {
    expect(routePassesNear([], HERE, 1000)).toBe(false);
  });

  // The box prefilter must never reject a pair the real distance would accept.
  test('the cheap prefilter agrees with the expensive check at the boundary', () => {
    for (const metres of [10, 55, 59, 61, 100, 149, 151]) {
      const point = north(HERE, metres);
      expect(routePassesNear([point], HERE, 60)).toBe(metres <= 60);
    }
  });

  test('a corrupt fix is skipped rather than counted or thrown on', () => {
    const route = [{ lat: NaN, lng: NaN }, north(HERE, 10)] as GeoPoint[];
    expect(routePassesNear(route, HERE, 60)).toBe(true);
    expect(routePassesNear([{ lat: NaN, lng: NaN }] as GeoPoint[], HERE, 60)).toBe(false);
  });
});

describe('buildVisitIndex', () => {
  test('one walk through a place is one visit, however dense the trace', () => {
    // A lap of the park: twenty points, all well inside the radius. Counting
    // points rather than walks would report twenty visits from one afternoon.
    const lap = Array.from({ length: 20 }, (_, i) => north(HERE, i * 5));
    const index = buildVisitIndex([spot({ id: 'a' })], [lap]);
    expect(index.a).toBe(1);
  });

  test('separate walks accumulate', () => {
    const pass = [north(HERE, 20)];
    const index = buildVisitIndex([spot({ id: 'a' })], [pass, pass, pass]);
    expect(index.a).toBe(3);
  });

  test('a place never visited is absent, not zero', () => {
    const index = buildVisitIndex([spot({ id: 'a' })], [[north(HERE, 5000)]]);
    expect(index.a).toBeUndefined();
    expect(Object.keys(index)).toHaveLength(0);
  });

  // The rule that stops "you've been to the vet" appearing because the dog
  // trotted down the road outside it.
  test('a point place is judged tightly and an area place generously', () => {
    const passedAt = [north(HERE, 100)];
    const vet = spot({ id: 'vet', category: 'veterinary' });
    const park = spot({ id: 'park', category: 'dog_friendly_park' });

    const index = buildVisitIndex([vet, park], [passedAt]);
    expect(index.vet).toBeUndefined();
    expect(index.park).toBe(1);
  });

  test('every category has a radius, so none falls back silently', () => {
    const categories: SpotCategory[] = [
      'off_leash_park',
      'dog_friendly_park',
      'dog_friendly_beach',
      'walking_trail',
      'veterinary',
      'pet_store',
      'drinking_water',
    ];
    for (const category of categories) {
      expect(VISIT_RADIUS_M[category]).toBeGreaterThan(0);
    }
  });

  test('an area radius is never tighter than a point radius', () => {
    expect(VISIT_RADIUS_M.dog_friendly_park).toBeGreaterThan(VISIT_RADIUS_M.veterinary);
    expect(VISIT_RADIUS_M.dog_friendly_beach).toBeGreaterThan(VISIT_RADIUS_M.pet_store);
  });

  test('nothing to compare produces an empty index rather than throwing', () => {
    expect(buildVisitIndex([], [[HERE]])).toEqual({});
    expect(buildVisitIndex([spot({ id: 'a' })], [])).toEqual({});
    expect(buildVisitIndex([spot({ id: 'a' })], [[]])).toEqual({});
  });

  test('a spot with a broken coordinate is skipped, not counted', () => {
    const broken = spot({ id: 'broken', latitude: NaN });
    expect(buildVisitIndex([broken], [[HERE]])).toEqual({});
  });
});

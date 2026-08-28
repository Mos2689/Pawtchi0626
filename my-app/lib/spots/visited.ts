/**
 * visited — which of these places the dog has actually been to.
 *
 * The one thing Pawtchi can say about a park that no map app can: *you were
 * here, on four walks*. Every field on a spot until now came from a stranger's
 * OSM edit; this one comes from the dog's own GPS traces, and it is the reason
 * a directory of public places belongs inside this app rather than beside it.
 *
 * ── What "here" means, and why it is not one number ──
 * OSM gives a way or relation a single representative coordinate — for a park
 * that is its centroid, which can sit a hundred metres from any path through
 * it. A vet is a building at a street address and its coordinate is the door.
 * Judging both with the same radius means either missing every park walk or
 * claiming a visit to every shop on a road the dog trotted past. So the radius
 * is per category: generous for places that are areas, tight for places that
 * are points.
 *
 * ── Counted per WALK, never per point ──
 * A route is a dense trace, so a lap of a park is dozens of points inside the
 * radius. Counting those would produce "you've been here 47 times" after one
 * afternoon. One walk that came close is one visit, full stop.
 *
 * Pure, so the thresholds and the counting rule are testable without a
 * database — and so the claim can be argued with in review rather than
 * discovered on someone's screen.
 */

import { haversineMeters, type GeoPoint } from '../walk/geo';
import type { PawtchiSpot, SpotCategory } from './types';

/**
 * How close a walk has to pass before it counts, in metres, per category.
 *
 * Areas get the loose radius because their coordinate is a centroid, not an
 * entrance. Points get the tight one because "walked past the pet shop" is not
 * "went to the pet shop", and a claim we cannot stand behind is worse than no
 * claim at all.
 */
export const VISIT_RADIUS_M: Record<SpotCategory, number> = {
  off_leash_park: 150,
  dog_friendly_park: 150,
  dog_friendly_beach: 200,
  walking_trail: 120,
  veterinary: 60,
  pet_store: 60,
  drinking_water: 40,
};

/** Spot id → how many separate walks came close enough. */
export type VisitIndex = Record<string, number>;

/**
 * Cheap rejection before the expensive one.
 *
 * A degree of latitude is ~111 km everywhere, and a degree of longitude never
 * more than that, so a plain degree box that is generous in both axes can throw
 * out the overwhelming majority of point/spot pairs without a single
 * trigonometric call. Longitude is deliberately NOT scaled by cos(lat): the
 * box only has to be a superset, and dividing by a cosine that approaches zero
 * near the poles is how that kind of optimisation turns into a bug.
 */
function withinBox(a: GeoPoint, b: GeoPoint, metres: number): boolean {
  const deg = metres / 111_320;
  return Math.abs(a.lat - b.lat) <= deg && Math.abs(a.lng - b.lng) <= deg;
}

/** True when any point on the route came within `radius` of the place. */
export function routePassesNear(
  route: readonly GeoPoint[],
  place: GeoPoint,
  radius: number,
): boolean {
  for (const point of route) {
    if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng)) continue;
    if (!withinBox(point, place, radius)) continue;
    if (haversineMeters(point, place) <= radius) return true;
  }
  return false;
}

/**
 * How many of these walks visited each spot.
 *
 * Spots with no visits are left OUT of the index rather than recorded as zero:
 * the callers all ask "has this been visited", and an object of mostly zeroes
 * invites `index[id] > 0` checks that quietly read `undefined > 0` as false
 * anyway. Absent means never, and there is only one way to spell it.
 */
export function buildVisitIndex(
  spots: readonly PawtchiSpot[],
  routes: readonly (readonly GeoPoint[])[],
): VisitIndex {
  const index: VisitIndex = {};
  if (spots.length === 0 || routes.length === 0) return index;

  for (const spot of spots) {
    if (!Number.isFinite(spot.latitude) || !Number.isFinite(spot.longitude)) continue;
    const place = { lat: spot.latitude, lng: spot.longitude };
    const radius = VISIT_RADIUS_M[spot.category] ?? 100;

    let visits = 0;
    for (const route of routes) {
      if (route.length === 0) continue;
      if (routePassesNear(route, place, radius)) visits += 1;
    }
    if (visits > 0) index[spot.id] = visits;
  }

  return index;
}

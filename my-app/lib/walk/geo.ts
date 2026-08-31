/**
 * geo — pure geometry helpers for tracked walks.
 *
 * Distances use the haversine formula (meters). Route simplification is
 * Douglas–Peucker with an epsilon search so any trace fits the walk_sessions
 * `route` budget (≤200 points) — the raw GPS trace never leaves the device.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6371008.8;

export function haversineMeters(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Perpendicular distance (meters) from `p` to the segment a→b, using a local
 * equirectangular projection — plenty accurate at walk scale.
 */
export function perpendicularDistanceM(p: GeoPoint, a: GeoPoint, b: GeoPoint): number {
  const cosLat = Math.cos((a.lat * Math.PI) / 180);
  const toXY = (g: GeoPoint) => ({
    x: g.lng * cosLat * 111320,
    y: g.lat * 110540,
  });
  const P = toXY(p);
  const A = toXY(a);
  const B = toXY(b);
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(P.x - A.x, P.y - A.y);
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(P.x - (A.x + t * dx), P.y - (A.y + t * dy));
}

/**
 * How far a point is from the nearest part of a path, in meters.
 *
 * The measure of "have I wandered off the suggested route" — perpendicular to
 * the nearest segment, not to the nearest vertex, so a long straight stretch
 * between two far-apart points does not read as a drift. Returns Infinity for a
 * path too short to be a line, which callers treat as "no route to be off".
 */
export function distanceToPathM(point: GeoPoint, path: readonly GeoPoint[]): number {
  if (path.length === 0) return Infinity;
  if (path.length === 1) return haversineMeters(point, path[0]);

  let nearest = Infinity;
  for (let i = 1; i < path.length; i++) {
    const d = perpendicularDistanceM(point, path[i - 1], path[i]);
    if (d < nearest) nearest = d;
  }
  return nearest;
}

/** Classic recursive Douglas–Peucker with a meter epsilon. */
function douglasPeucker(points: GeoPoint[], epsilonM: number): GeoPoint[] {
  if (points.length <= 2) return points.slice();

  let maxDist = 0;
  let index = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistanceM(points[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }

  if (maxDist <= epsilonM) return [first, last];
  const left = douglasPeucker(points.slice(0, index + 1), epsilonM);
  const right = douglasPeucker(points.slice(index), epsilonM);
  return left.slice(0, -1).concat(right);
}

/**
 * Simplify a route to at most `maxPoints` points. Starts gentle (2m) and
 * doubles epsilon until the trace fits — endpoints always preserved.
 */
export function simplifyRoute(points: GeoPoint[], maxPoints = 200): GeoPoint[] {
  if (points.length <= maxPoints) return points.slice();
  let epsilon = 2;
  let simplified = douglasPeucker(points, epsilon);
  while (simplified.length > maxPoints && epsilon < 10000) {
    epsilon *= 2;
    simplified = douglasPeucker(points, epsilon);
  }
  // Pathological traces (dense zigzag) may still exceed the budget after the
  // epsilon ceiling — decimate uniformly as the last resort.
  if (simplified.length > maxPoints) {
    const step = Math.ceil(simplified.length / maxPoints);
    const decimated = simplified.filter((_, i) => i % step === 0);
    if (decimated[decimated.length - 1] !== simplified[simplified.length - 1]) {
      decimated.push(simplified[simplified.length - 1]);
    }
    return decimated;
  }
  return simplified;
}

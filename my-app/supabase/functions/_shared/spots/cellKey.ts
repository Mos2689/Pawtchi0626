/**
 * Geographic cells — the cache key, and a privacy property.
 *
 * Overpass is never asked where the user is. It is asked about a grid cell,
 * and the user's real coordinate never leaves the device. That single decision
 * buys two things at once:
 *
 *   1. **Sharing.** Everyone in a neighbourhood resolves to the same cell, so a
 *      whole postcode costs one upstream request per TTL instead of one per
 *      person per session. Public Overpass is volunteer infrastructure; this is
 *      the difference between polite use and abuse.
 *   2. **Privacy.** The server stores a cell id and public OSM extracts. There
 *      is no row anywhere that says where a person was.
 *
 * The trade is that a cell must be queried with a radius large enough to cover
 * the user wherever they stand inside it — hence `queryRadiusFor` below.
 */

/**
 * Cell size in degrees. 0.02° of latitude is ~2.22 km everywhere; longitude
 * narrows toward the poles, which only makes cells smaller and the coverage
 * radius more generous, so the guarantee holds.
 *
 * Chosen as the largest cell that still keeps the coverage radius modest. Twice
 * this would halve the request count but push every query to ~8 km, which is
 * where Overpass responses start getting slow and large.
 */
export const CELL_SIZE_DEG = 0.02;

/**
 * Extra radius so a query centred on the cell centre reaches any point a user
 * could stand on inside that cell, plus their own search radius.
 *
 * The cell's half-diagonal is `sqrt(2)/2 * 2.22 km ≈ 1.57 km`. Rounded up to
 * 1800 m for margin — the cost of over-covering is a slightly bigger response;
 * the cost of under-covering is a user near a cell edge silently missing the
 * park across the road.
 */
export const CELL_COVER_M = 1800;

/** Radii the UI may ask for. Anything else is snapped to one of these. */
export const RADIUS_BUCKETS = [3000, 5000] as const;
export type RadiusBucket = (typeof RADIUS_BUCKETS)[number];

export const DEFAULT_RADIUS_M: RadiusBucket = 3000;
export const MAX_RADIUS_M: RadiusBucket = 5000;

export interface Cell {
  latIndex: number;
  lngIndex: number;
}

/**
 * `floor`, not `round`. Floor partitions the plane into disjoint cells with no
 * overlap and no gap; rounding would put the boundaries in a different place
 * for latitude and longitude and make the coverage guarantee harder to reason
 * about for no benefit.
 */
export function cellOf(lat: number, lng: number): Cell {
  return {
    latIndex: Math.floor(lat / CELL_SIZE_DEG),
    lngIndex: Math.floor(lng / CELL_SIZE_DEG),
  };
}

/** Stable string form. Goes in both cache keys; never shown to anyone. */
export function cellKey(lat: number, lng: number): string {
  const { latIndex, lngIndex } = cellOf(lat, lng);
  return `${latIndex}_${lngIndex}`;
}

/** The point actually sent upstream — the cell's centre, not the user. */
export function cellCentre(lat: number, lng: number): { lat: number; lng: number } {
  const { latIndex, lngIndex } = cellOf(lat, lng);
  return {
    lat: (latIndex + 0.5) * CELL_SIZE_DEG,
    lng: (lngIndex + 0.5) * CELL_SIZE_DEG,
  };
}

/** Snap an arbitrary radius to a bucket, so cache keys stay few and shared. */
export function radiusBucketFor(meters: number): RadiusBucket {
  if (!Number.isFinite(meters) || meters <= DEFAULT_RADIUS_M) return DEFAULT_RADIUS_M;
  return MAX_RADIUS_M;
}

/** What to actually ask Overpass for, given what the user asked for. */
export function queryRadiusFor(requestedMeters: number): number {
  return radiusBucketFor(requestedMeters) + CELL_COVER_M;
}

/**
 * The cache key, identical on device and server.
 *
 * `version` is a parameter rather than an import so tests can prove that
 * bumping it changes the key — the mechanism the whole invalidation story
 * rests on.
 */
export function spotCacheKey(
  cell: string,
  radiusBucket: number,
  version: number,
): string {
  return `spots:v${version}:${cell}:${radiusBucket}`;
}

/** Whether a fetch timestamp is still inside its TTL. */
export function isFresh(fetchedAt: string, ttlMs: number, now: number = Date.now()): boolean {
  const t = Date.parse(fetchedAt);
  if (!Number.isFinite(t)) return false;
  // A timestamp from the future means a clock skew somewhere; treat it as fresh
  // rather than instantly stale, which would hammer the endpoint.
  return now - t < ttlMs;
}

/**
 * routeJson — read a `walk_sessions.route` column back into points.
 *
 * The column is JSONB and has carried two shapes over the app's life:
 * `[[lat, lng], …]` from the original tracker and `[{ lat, lng }, …]` from
 * everything since. Both are still in the table and both are valid, so every
 * reader has to handle both — which is exactly why this lives in one place
 * instead of being re-implemented per hook, where the two versions inevitably
 * drift on what they do with a null or a half-written row.
 *
 * Defensive by default: anything unrecognisable becomes null or is dropped,
 * because a malformed row from an interrupted sync must never be able to crash
 * a screen that is only drawing a backdrop.
 */

import type { GeoPoint } from './geo';

/** One point from either shape, or null if it is not a usable coordinate. */
function toPoint(raw: unknown): GeoPoint | null {
  if (Array.isArray(raw)) {
    const [lat, lng] = raw as [number, number];
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (raw && typeof raw === 'object' && 'lat' in (raw as object)) {
    const p = raw as GeoPoint;
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
  }
  return null;
}

/**
 * Every usable point in a route column.
 *
 * Bad points are skipped rather than failing the whole route: a single corrupt
 * fix in the middle of a real walk should cost that fix, not the walk.
 */
export function parseRoutePoints(raw: unknown): GeoPoint[] {
  if (!Array.isArray(raw)) return [];
  const out: GeoPoint[] = [];
  for (const entry of raw) {
    const point = toPoint(entry);
    if (point) out.push(point);
  }
  return out;
}

/** The first usable point, for callers that only need somewhere to point a camera. */
export function firstRoutePoint(raw: unknown): GeoPoint | null {
  if (!Array.isArray(raw)) return null;
  for (const entry of raw) {
    const point = toPoint(entry);
    if (point) return point;
  }
  return null;
}

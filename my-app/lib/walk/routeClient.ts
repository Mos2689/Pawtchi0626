/**
 * routeClient — fetch one suggested pedestrian route from FOSSGIS.
 *
 * This is presentation only. A failure cannot affect walk tracking, the
 * destination pin, compass, or dog-paced ETA.
 *
 * FOSSGIS operates the public pedestrian OSRM endpoint below for the
 * OpenStreetMap community. It has no SLA, so routePolicy.ts limits requests and
 * this client never retries by itself. GeoJSON avoids encoded-polyline
 * precision ambiguity and is validated before reaching either native map.
 */

import { GeoPoint } from './geo';

const OSRM_FOOT_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving';
const TIMEOUT_MS = 10_000;
const COORD_PRECISION = 5;
const PREFETCH_TTL_MS = 30_000;

type CachedRoute = {
  promise: Promise<WalkingRoute | null>;
  expiresAt: number;
};

const routeCache = new Map<string, CachedRoute>();

function rounded(value: number): string {
  return value.toFixed(COORD_PRECISION);
}

export interface WalkingRoute {
  path: GeoPoint[];
  distanceM: number;
  durationS: number;
}

interface OsrmRoute {
  distance?: number;
  duration?: number;
  geometry?: { type?: string; coordinates?: unknown };
}

/** Pure response parser, exported so malformed provider data is unit-tested. */
export function parseOsrmWalkingRoute(body: unknown): WalkingRoute | null {
  if (!body || typeof body !== 'object') return null;
  const candidate = body as { code?: string; routes?: OsrmRoute[] };
  if (candidate.code !== 'Ok') return null;

  const route = candidate.routes?.[0];
  const coordinates = route?.geometry?.coordinates;
  if (route?.geometry?.type !== 'LineString' || !Array.isArray(coordinates)) return null;

  const path: GeoPoint[] = [];
  for (const coordinate of coordinates) {
    if (!Array.isArray(coordinate) || coordinate.length < 2) return null;
    const lng = coordinate[0];
    const lat = coordinate[1];
    if (
      typeof lat !== 'number' || typeof lng !== 'number' ||
      !Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180
    ) return null;
    path.push({ lat, lng });
  }

  if (path.length < 2) return null;
  return {
    path,
    distanceM: Math.round(route?.distance ?? 0),
    durationS: Math.round(route?.duration ?? 0),
  };
}

async function requestWalkingRoute(
  from: GeoPoint,
  to: GeoPoint,
  signal?: AbortSignal,
): Promise<WalkingRoute | null> {
  const coordinates = `${rounded(from.lng)},${rounded(from.lat)};${rounded(to.lng)},${rounded(to.lat)}`;
  const url = `${OSRM_FOOT_URL}/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
  const onAbort = () => timeout.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const response = await fetch(url, {
      signal: timeout.signal,
      headers: { Accept: 'application/json', 'X-Client-Id': 'pawtchi.com' },
    });
    if (!response.ok) return null;
    return parseOsrmWalkingRoute(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function routeKey(from: GeoPoint, to: GeoPoint): string {
  return `${rounded(from.lat)},${rounded(from.lng)}>${rounded(to.lat)},${rounded(to.lng)}`;
}

/**
 * Fetch with a very short in-memory cache. `Walk here` calls this before
 * navigation; the walk screen then joins the same promise instead of starting
 * a duplicate request. Successful results survive only long enough to bridge
 * the screen transition—the live re-route policy still owns everything after.
 */
export function fetchWalkingRoute(
  from: GeoPoint,
  to: GeoPoint,
  signal?: AbortSignal,
): Promise<WalkingRoute | null> {
  const key = routeKey(from, to);
  const cached = routeCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = requestWalkingRoute(from, to, signal).then(result => {
    if (!result) routeCache.delete(key);
    return result;
  });
  routeCache.set(key, { promise, expiresAt: Date.now() + PREFETCH_TTL_MS });
  return promise;
}

/** Start the route while Home is still navigating to the walk screen. */
export function prefetchWalkingRoute(from: GeoPoint, to: GeoPoint): void {
  void fetchWalkingRoute(from, to);
}

/**
 * geoLabels — reverse-geocode a walk's start / end / farthest points into
 * short place labels, and decide whether a walk was a loop.
 *
 * Reverse-geocoding uses expo-location's on-device API — no API key, no
 * network dependency (Apple/Android query their own tile/geocoding services
 * with the OS location permission we already hold). Calls are best-effort:
 * a null return just means the pill is omitted, not that the walk fails.
 */

import * as Location from 'expo-location';
import { DEFAULT_SESSION_CONFIG } from './walkSession';
import type { EndReason } from './walkSession';
import type { GeoPoint } from './geo';
import { haversineMeters } from './geo';

/** Cap the label at something a route pill can hold without wrapping. */
const MAX_LABEL_LEN = 24;

/** Pick the most specific-yet-readable field expo-location returns. Prefer a
 *  named POI/street; fall back to district → subregion → city → country. */
function pickBestField(a: Location.LocationGeocodedAddress): string | null {
  const candidates: (string | null | undefined)[] = [
    a.name,
    a.street,
    a.district,
    a.subregion,
    a.city,
    a.region,
    a.country,
  ];
  for (const c of candidates) {
    if (!c) continue;
    const trimmed = c.trim();
    if (trimmed.length === 0) continue;
    // Skip plus-codes and pure-numeric "names" — those aren't place labels.
    if (/^[0-9+\-\s]+$/.test(trimmed)) continue;
    return trimmed.length > MAX_LABEL_LEN
      ? trimmed.slice(0, MAX_LABEL_LEN - 1) + '…'
      : trimmed;
  }
  return null;
}

/**
 * Reverse-geocode a coordinate into a short human-readable label. Returns
 * null if the OS can't resolve it (offline, unavailable, permission denied).
 */
export async function reverseGeocodeLabel(point: GeoPoint | null): Promise<string | null> {
  if (!point) return null;
  try {
    const results = await Location.reverseGeocodeAsync({
      latitude: point.lat,
      longitude: point.lng,
    });
    if (!results || results.length === 0) return null;
    return pickBestField(results[0]);
  } catch {
    return null;
  }
}

/**
 * True when the walk was a loop back to where it began — either the
 * finalizer already labelled it `auto_home`, OR the end is within the home
 * geofence radius after having pushed at least minExcursionM away.
 */
export function isLoopWalk(args: {
  endReason: EndReason;
  startPoint: GeoPoint | null;
  endPoint: GeoPoint | null;
  maxExcursionM: number;
  homeRadiusM?: number;
  minExcursionM?: number;
}): boolean {
  if (args.endReason === 'auto_home') return true;
  if (!args.startPoint || !args.endPoint) return false;
  const homeRadius = args.homeRadiusM ?? DEFAULT_SESSION_CONFIG.homeRadiusM;
  const minExcursion = args.minExcursionM ?? DEFAULT_SESSION_CONFIG.minExcursionM;
  if (args.maxExcursionM < minExcursion) return false;
  return haversineMeters(args.startPoint, args.endPoint) <= homeRadius;
}

export interface WalkLabels {
  startLabel: string | null;
  endLabel: string | null;
  farthestLabel: string | null;
  isLoop: boolean;
}

/**
 * Fetch all three labels for a finished walk in parallel. For loops we skip
 * the end label (start and end are the same place); for straight walks we
 * skip the farthest label (it's the end).
 */
export async function collectWalkLabels(args: {
  startPoint: GeoPoint | null;
  endPoint: GeoPoint | null;
  farthestPoint: GeoPoint | null;
  endReason: EndReason;
  maxExcursionM: number;
}): Promise<WalkLabels> {
  const loop = isLoopWalk({
    endReason: args.endReason,
    startPoint: args.startPoint,
    endPoint: args.endPoint,
    maxExcursionM: args.maxExcursionM,
  });

  const [startLabel, endLabel, farthestLabel] = await Promise.all([
    reverseGeocodeLabel(args.startPoint),
    loop ? Promise.resolve(null) : reverseGeocodeLabel(args.endPoint),
    loop ? reverseGeocodeLabel(args.farthestPoint) : Promise.resolve(null),
  ]);

  return { startLabel, endLabel, farthestLabel, isLoop: loop };
}

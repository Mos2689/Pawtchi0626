/**
 * In-memory lifetime for the blue OSM suggestion across screen remounts.
 *
 * Keyed by the active walk id and destination coordinate. Keeping the request
 * counters here is as important as keeping the geometry: repeatedly opening
 * the Walk screen must not reset the per-walk fair-use ceiling and accidentally
 * hammer the donated routing server.
 */

import type { GeoPoint } from './geo';

export type ActiveRouteSession = {
  walkId: string;
  destinationKey: string;
  route: GeoPoint[] | null;
  fetchCount: number;
  lastFetchAt: number | null;
};

let active: ActiveRouteSession | null = null;

export function readActiveRouteSession(
  walkId: string | null | undefined,
  destinationKey: string | null | undefined,
): ActiveRouteSession | null {
  return walkId && destinationKey &&
    active?.walkId === walkId && active.destinationKey === destinationKey
    ? active
    : null;
}

export function ensureActiveRouteSession(
  walkId: string,
  destinationKey: string,
): ActiveRouteSession {
  const existing = readActiveRouteSession(walkId, destinationKey);
  if (existing) return existing;
  active = { walkId, destinationKey, route: null, fetchCount: 0, lastFetchAt: null };
  return active;
}

export function recordActiveRouteRequest(
  walkId: string,
  destinationKey: string,
  requestedAt: number,
): ActiveRouteSession {
  const session = ensureActiveRouteSession(walkId, destinationKey);
  session.fetchCount += 1;
  session.lastFetchAt = requestedAt;
  return session;
}

export function recordActiveRoute(
  walkId: string,
  destinationKey: string,
  route: GeoPoint[],
): void {
  const session = ensureActiveRouteSession(walkId, destinationKey);
  session.route = route;
}

export function clearActiveRouteSession(walkId?: string | null): void {
  if (!walkId || active?.walkId === walkId) active = null;
}

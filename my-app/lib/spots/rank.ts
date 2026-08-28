/**
 * rank — distance, then confidence.
 *
 * Pure distance ordering would be wrong here, and the reason is the untagged-
 * park decision: we deliberately include parks with no `dog=*` tag, which in
 * most cities is the majority of them. Sorted by distance alone, a confirmed
 * off-leash park 900 m away would sit below four unverified patches of grass,
 * and the one result we can actually vouch for would be the one nobody sees.
 *
 * So: confirmed dog access first, unknown after, distance within each band.
 * The bands are coarse on purpose — a confirmed park 4 km away should not
 * outrank an unknown one across the street, so distance still dominates once
 * the gap is large.
 */

import { haversineMeters } from '../walk/geo';
import type { GeoPoint } from '../walk/geo';
import type { PawtchiSpot } from './types';

/**
 * How much closer an unknown-access place must be to outrank a confirmed one.
 *
 * Read it as: "a confirmed spot is worth walking an extra 400 m for." Small
 * enough that geography still wins across a neighbourhood, large enough that
 * the verified result leads its immediate area.
 */
export const CONFIRMED_ACCESS_BONUS_M = 400;

/** Attach true distances, measured from the user's real position. */
export function withDistances(
  spots: readonly PawtchiSpot[],
  from: GeoPoint,
): PawtchiSpot[] {
  return spots.map(spot => ({
    ...spot,
    distanceMeters: Math.round(
      haversineMeters(from, { lat: spot.latitude, lng: spot.longitude }),
    ),
  }));
}

/** Drop anything beyond what the user asked for — the cell query over-fetches. */
export function withinRadius(
  spots: readonly PawtchiSpot[],
  radiusMeters: number,
): PawtchiSpot[] {
  return spots.filter(s => (s.distanceMeters ?? Infinity) <= radiusMeters);
}

function effectiveDistance(spot: PawtchiSpot): number {
  const d = spot.distanceMeters ?? Infinity;
  return spot.dogAccess === 'unknown' ? d + CONFIRMED_ACCESS_BONUS_M : d;
}

/**
 * Sort for display. Ties break on id so the order is total and stable —
 * without that, two equidistant spots could swap places between renders.
 */
export function rankSpots(spots: readonly PawtchiSpot[]): PawtchiSpot[] {
  return [...spots].sort((a, b) => {
    const delta = effectiveDistance(a) - effectiveDistance(b);
    if (delta !== 0) return delta;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

/**
 * The whole read-side pipeline: measure from here, drop the over-fetch, order.
 *
 * One function because the three steps are never useful apart — every caller
 * that has a position wants all three, in this order.
 */
export function prepareForDisplay(
  spots: readonly PawtchiSpot[],
  from: GeoPoint,
  radiusMeters: number,
): PawtchiSpot[] {
  return rankSpots(withinRadius(withDistances(spots, from), radiusMeters));
}

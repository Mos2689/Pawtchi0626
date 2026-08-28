/**
 * areaSearch — when moving the map is worth a new question.
 *
 * Home's map used to be fixed, so "where are we asking about" and "where is the
 * owner standing" were the same place and Refresh was the only control that
 * made sense. Now the map pans, and those two came apart: you can be looking at
 * a park two suburbs away while every result on screen was measured from your
 * own street.
 *
 * The offer has to be earned, though. A button that appears on the slightest
 * nudge is noise, and every tap on it is an Overpass request against volunteer
 * infrastructure (see lib/spots/fetchPolicy.ts on why that budget is real). So
 * the rule is proportional: results fetched for a 3 km radius still genuinely
 * describe somewhere a few hundred metres away, and only stop describing it
 * once the view has moved a meaningful fraction of that radius.
 *
 * Pure, and separate from the hook, for the same reason every other Spots rule
 * is: a threshold buried in a component is a threshold nobody can test.
 */

import { haversineMeters } from '../walk/geo';
import type { GeoPoint } from '../walk/geo';

/**
 * Never offer below this, however small the radius gets.
 *
 * Roughly a long block. Under it the owner has nudged the map rather than gone
 * looking somewhere, and the results they already have still cover the view.
 */
export const MIN_AREA_SEARCH_SHIFT_M = 600;

/**
 * How much of the search radius the view must move before the results stop
 * being about what is on screen.
 *
 * A third is the point at which a meaningful part of the visible map lies
 * outside what was actually queried — the honest trigger, rather than a round
 * number chosen for feeling about right.
 */
export const AREA_SEARCH_SHIFT_FRACTION = 0.35;

export interface AreaSearchInput {
  /** Where the map is pointing now. Null before it has ever reported. */
  viewCenter: GeoPoint | null;
  /** The coordinate the spots on screen were fetched for. */
  searchedCenter: GeoPoint | null;
  /** The radius those results were fetched at, in metres. */
  radiusMeters: number;
}

/** The distance the view has to travel before a new search is worth offering. */
export function areaSearchThreshold(radiusMeters: number): number {
  return Math.max(MIN_AREA_SEARCH_SHIFT_M, radiusMeters * AREA_SEARCH_SHIFT_FRACTION);
}

/**
 * Whether to show "Search this area".
 *
 * Answers false whenever it cannot answer truthfully — no view camera yet, no
 * searched centre, a nonsense radius. An offer made on missing information is
 * worse than no offer: it spends an upstream request to tell the owner the same
 * thing they were already looking at.
 */
export function shouldOfferAreaSearch(input: AreaSearchInput): boolean {
  const { viewCenter, searchedCenter, radiusMeters } = input;
  if (!viewCenter || !searchedCenter) return false;
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) return false;

  const moved = haversineMeters(searchedCenter, viewCenter);
  if (!Number.isFinite(moved)) return false;

  return moved > areaSearchThreshold(radiusMeters);
}

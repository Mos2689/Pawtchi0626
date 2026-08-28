/**
 * filters — chip → categories, applied to data we already have.
 *
 * Filtering NEVER triggers a fetch. That is the rule the whole chip row is
 * built around: one query returns every category for the area, and the chips
 * are a view over it. Re-querying per chip would multiply upstream load by six
 * for no new information, and would make the chips feel slow in exactly the
 * moment they should feel instant.
 *
 * The chips are also not one-per-category. Six categories is more taxonomy than
 * anyone wants to tap through, so parks and beaches share a chip — an owner
 * looking for green space does not distinguish them — while off-leash keeps its
 * own, because that IS the distinction dog owners care about most.
 */

import type { PawtchiSpot, SpotCategory } from './types';

export type SpotFilter = 'all' | 'off_leash' | 'parks' | 'vets' | 'stores' | 'water';

/** Display order. `all` leads because it is the default. */
export const ALL_FILTERS: SpotFilter[] = [
  'all',
  'off_leash',
  'parks',
  'vets',
  'stores',
  'water',
];

/**
 * Which categories each chip admits.
 *
 * `parks` includes `off_leash_park` deliberately: an off-leash park IS a park,
 * and someone filtering for green space would be confused to see the nearest
 * one vanish. The `off_leash` chip is the narrowing filter, not `parks`.
 */
const FILTER_CATEGORIES: Record<Exclude<SpotFilter, 'all'>, SpotCategory[]> = {
  off_leash: ['off_leash_park'],
  parks: [
    'off_leash_park',
    'dog_friendly_park',
    'dog_friendly_beach',
    'walking_trail',
  ],
  vets: ['veterinary'],
  stores: ['pet_store'],
  water: ['drinking_water'],
};

export function categoriesFor(filter: SpotFilter): SpotCategory[] | null {
  return filter === 'all' ? null : FILTER_CATEGORIES[filter];
}

export function applyFilter(
  spots: readonly PawtchiSpot[],
  filter: SpotFilter,
): PawtchiSpot[] {
  const categories = categoriesFor(filter);
  if (!categories) return [...spots];
  const allowed = new Set(categories);
  return spots.filter(s => allowed.has(s.category));
}

/**
 * Which chips have anything behind them in this result set.
 *
 * The chip row stays a fixed shape either way — a control that changes width
 * as data loads is more disorienting than one with a dimmed option — but a chip
 * that would lead to an empty list should read as unavailable before it is
 * tapped, not after.
 */
export function availableFilters(spots: readonly PawtchiSpot[]): Set<SpotFilter> {
  const present = new Set<SpotCategory>(spots.map(s => s.category));
  const out = new Set<SpotFilter>(['all']);
  for (const filter of ALL_FILTERS) {
    if (filter === 'all') continue;
    const categories = FILTER_CATEGORIES[filter];
    if (categories.some(c => present.has(c))) out.add(filter);
  }
  return out;
}

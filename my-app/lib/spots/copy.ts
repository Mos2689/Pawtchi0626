/**
 * Every user-facing Spots string, in one file.
 *
 * Here because the wording IS the feature's integrity. The data is uneven and
 * crowd-sourced, so the difference between a useful product and a liability is
 * entirely in how carefully these sentences hedge. Scattering them through JSX
 * is how "Dog access not confirmed" quietly becomes "Dog friendly" during a
 * later layout tweak.
 *
 * Voice follows the Pawtchi brand copy spec: plain, lower-case sentence style,
 * no exclamation marks, never chirpy about something we are unsure of.
 */

import type { DogAccessStatus, SpotCategory } from './types';

/** Singular labels, used as the name of an unnamed place. */
export const CATEGORY_LABEL: Record<SpotCategory, string> = {
  off_leash_park: 'Off-leash dog park',
  dog_friendly_park: 'Park',
  dog_friendly_beach: 'Beach',
  walking_trail: 'Walking trail',
  veterinary: 'Veterinary clinic',
  pet_store: 'Pet store',
  drinking_water: 'Drinking water',
};

/** Short form for a chip or a card's second line. */
export const CATEGORY_SHORT: Record<SpotCategory, string> = {
  off_leash_park: 'Off-leash',
  dog_friendly_park: 'Park',
  dog_friendly_beach: 'Beach',
  walking_trail: 'Trail',
  veterinary: 'Vet',
  pet_store: 'Pet store',
  drinking_water: 'Water',
};

/**
 * The dog-access badge.
 *
 * `unknown` is the one that matters. It says what we do not know, in the
 * owner's terms, and it never implies a yes. "Dog access not confirmed" was
 * chosen over "Unknown" because the latter reads as a data glitch rather than
 * as a fact about the place.
 */
export const DOG_ACCESS_LABEL: Record<DogAccessStatus, string> = {
  off_leash: 'Off-leash area',
  on_leash: 'Dogs allowed on leash',
  dog_friendly: 'Dogs allowed',
  prohibited: 'No dogs',
  unknown: 'Dog access not confirmed',
};

export const copy = {
  segmentLabel: 'Spots',

  /** Filter chips. `all` leads because it is the default state. */
  filters: {
    all: 'All',
    off_leash: 'Off-leash',
    parks: 'Parks & beaches',
    vets: 'Vets',
    stores: 'Pet stores',
    water: 'Water',
  },

  loading: 'Finding spots nearby',

  /**
   * Cycled under the title while the query runs.
   *
   * Deliberately NOT a fake sequence of steps. One Overpass request covers
   * every category at once, so "now checking vets…" would be describing work
   * that is not happening in that order. These describe the situation instead,
   * which is true at any moment of the wait.
   *
   * They exist because the wait is genuinely variable — a warm cell answers in
   * under two seconds, a cold one can take ten — and a card that never changes
   * reads as frozen long before it has actually failed.
   */
  loadingLines: [
    'Reading the map around you',
    'Parks, vets, water and more',
    'Working out what is dog-friendly',
  ],

  /**
   * Shown once the wait passes the point where people start assuming breakage.
   * Names the real reason rather than apologising vaguely — the slow part is a
   * volunteer-run service, and saying so is both true and reassuring.
   */
  loadingSlow: 'OpenStreetMap is taking a moment',

  empty: {
    title: 'No dog-friendly spots are mapped nearby yet',
    // Deliberately about the MAP, not about the world. There may well be a
    // dog park two streets away that nobody has added to OpenStreetMap.
    body: 'Try searching a wider area.',
    action: 'Search wider',
  },

  error: {
    title: 'Could not load spots',
    body: 'Something went wrong finding places nearby.',
    action: 'Try again',
  },

  offline: {
    title: 'Showing saved spots',
    body: 'These are from your last search.',
  },

  locationNeeded: {
    title: 'Spots needs your location',
    // Says exactly what it is for, and does NOT ask for background location —
    // Spots only ever reads a position that already exists.
    body: 'To find places near you, Pawtchi needs to know roughly where you are.',
    action: 'Allow location',
  },

  actions: {
    /**
     * The one action on a place, and the whole reason Spots is inside a walking
     * app rather than beside one.
     *
     * "Walk here", not "Navigate" or "Directions": it starts a tracked walk
     * with this place marked on the map, and it never claims to know the way.
     * The verb is the product.
     */
    walkHere: 'Walk here',
    refresh: 'Refresh',
    searchWider: 'Search wider',
    /**
     * Shown once the map has been moved somewhere we have not asked about.
     *
     * "this area" rather than "here": the results will be about the piece of map
     * on screen, not about where the owner is standing, and those stopped being
     * the same thing the moment the map became pannable.
     */
    searchArea: 'Search this area',
  },

  details: {
    hoursUnavailable: 'Opening hours unavailable',
    /**
     * The one line on this sheet that comes from the dog rather than from a
     * stranger's map edit.
     *
     * "Walked here" is the strongest claim the data supports and no stronger:
     * the trace says the dog was at this place, not that anyone went inside,
     * which is why a vet needs a much tighter radius than a park to earn it
     * (lib/spots/visited.ts). Phrased around the walk, not the visit, for
     * exactly that reason.
     *
     * Counted in walks rather than in days so it stays true for someone who
     * does two laps of the same park on a Sunday.
     */
    visitedOnce: "You've walked here before",
    visitedTimes: (walks: number) => `You've walked here on ${walks} walks`,
    fenced: 'Fenced',
    notFenced: 'Not fenced',
    lit: 'Lit at night',
    notLit: 'No lighting',
    /**
     * The disclaimer, shown on every details sheet without exception.
     *
     * Not a legal fig leaf — a genuine statement about the data. OSM edits can
     * be years old and our own cache adds up to three days on top, so a vet
     * that closed last month can absolutely still be here.
     */
    accuracyNote: 'Information may have changed — check local signage.',
    source: 'Data from OpenStreetMap contributors',
  },

  /** Only shown when a fountain is explicitly confirmed dog-usable. */
  dogWaterBadge: 'Dog bowl',
  /** Only shown on an explicit emergency=yes. Never inferred. */
  emergencyVetBadge: 'Emergency care',
} as const;

/**
 * Whether the dog-access badge means anything for this kind of place.
 *
 * It does not for vets, pet shops or water points. A live probe of central
 * London returned 46 drinking fountains, every one of them captioned "Dog
 * access not confirmed" — which is technically true and completely useless: a
 * public tap has no dog policy to confirm. Repeating a hedge 46 times is how
 * you teach someone to stop reading it, which is exactly when it would have
 * mattered on the park below.
 *
 * For a water point the useful signal is `dogWaterConfirmed`, which is badged
 * separately. For vets and shops the answer is obvious from the category.
 */
export function showsDogAccess(category: SpotCategory): boolean {
  return (
    category === 'off_leash_park' ||
    category === 'dog_friendly_park' ||
    category === 'dog_friendly_beach' ||
    category === 'walking_trail'
  );
}

/**
 * What to call a place.
 *
 * An unnamed place gets its category, never its OSM id. This is the whole
 * reason `PawtchiSpot.name` is nullable: a fallback computed here can be
 * changed and translated, whereas a fallback baked into the stored name would
 * be frozen into every cache row.
 */
export function displayName(
  name: string | null | undefined,
  category: SpotCategory,
): string {
  const trimmed = (name ?? '').trim();
  return trimmed.length > 0 ? trimmed : CATEGORY_LABEL[category];
}

/** "120 m" · "1.4 km" — one distance format everywhere in the feature. */
export function formatDistance(meters: number | null | undefined): string | null {
  if (meters == null || !Number.isFinite(meters) || meters < 0) return null;
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

/**
 * Coarse distance band for analytics.
 *
 * Buckets rather than the real number because a precise distance plus a
 * timestamp is a location fix. The product questions ("do people tap spots
 * that are far away?") are all answerable at this resolution.
 */
export function distanceBucket(meters: number | null | undefined): string {
  if (meters == null || !Number.isFinite(meters)) return 'unknown';
  if (meters < 500) return '0-500m';
  if (meters < 1000) return '500m-1km';
  if (meters < 2000) return '1-2km';
  if (meters < 5000) return '2-5km';
  return '5km+';
}

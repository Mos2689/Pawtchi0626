/**
 * The Spots domain model — provider-neutral by construction.
 *
 * Nothing in here mentions OpenStreetMap. That is the entire point: OSM is the
 * only source today, but a `PawtchiSpot` is what the UI renders, what the cache
 * stores, and what the endpoint returns, so adding Google Places or a
 * Pawtchi-community source later is a new normalizer rather than a rewrite of
 * every screen that shows a place.
 *
 * The honesty rules live in the types, not just in the copy:
 *
 *   • `name` is `string | null`. A place with no name in the source has no
 *     name here either — the UI substitutes a category label. We never fill
 *     this with an OSM id, which is what makes "Node 4821993" impossible.
 *   • `dogAccess` has an explicit `unknown` member and it is the DEFAULT.
 *     Most parks on earth carry no dog tag at all, so a model without
 *     `unknown` would force every one of them into a claim the data does not
 *     support.
 *   • Every optional detail is `T | null`, never `undefined`-by-omission. A
 *     details sheet has to be able to tell "we know there are no opening hours"
 *     from "we never asked", and only an explicit null does that.
 */

export type SpotProvider = 'osm' | 'google' | 'pawtchi';

export type SpotCategory =
  | 'off_leash_park'
  | 'dog_friendly_park'
  | 'dog_friendly_beach'
  | 'walking_trail'
  | 'veterinary'
  | 'pet_store'
  | 'drinking_water';

/** Every category, in the order a list should present them. */
export const ALL_SPOT_CATEGORIES: SpotCategory[] = [
  'off_leash_park',
  'dog_friendly_park',
  'dog_friendly_beach',
  'walking_trail',
  'veterinary',
  'pet_store',
  'drinking_water',
];

/**
 * What we can say about bringing a dog here.
 *
 * `unknown` is not a failure state — it is the most common honest answer, and
 * it must never be rendered as though it were a yes. `prohibited` places are
 * filtered out before they reach a list; the member exists so the classifier
 * can name what it dropped and so a future "why is this missing?" surface has
 * something to read.
 */
export type DogAccessStatus =
  | 'off_leash'
  | 'on_leash'
  | 'dog_friendly'
  | 'prohibited'
  | 'unknown';

export interface PawtchiSpot {
  /** `{provider}:{providerPlaceId}` — stable across refetches, unique per source. */
  id: string;
  provider: SpotProvider;
  /** The source's own identifier, e.g. `node/1234`. Never shown to a person. */
  providerPlaceId: string;
  category: SpotCategory;
  /** Null when the source has no name. The UI substitutes a category label. */
  name: string | null;
  latitude: number;
  longitude: number;
  /** Filled in client-side from the viewer's own position; absent server-side. */
  distanceMeters?: number;
  dogAccess: DogAccessStatus;
  /** The source's own wording, when it gave one worth passing through. */
  accessDescription: string | null;
  address: string | null;
  openingHours: string | null;
  website: string | null;
  phone: string | null;
  surface: string | null;
  fenced: boolean | null;
  lit: boolean | null;
  /**
   * Confirmed extras, resolved at normalization time rather than carried as raw
   * tags.
   *
   * Both are `false` unless the source said so explicitly — they are the two
   * claims on this model that could actually harm someone if guessed. A human
   * drinking fountain is not reachable by a dog, and sending an owner to a
   * "24h emergency vet" that is neither is how a sick animal waits at a locked
   * door. Neither is ever inferred; see classify.ts.
   *
   * Booleans rather than a `rawTags` bag because the UI must not be able to
   * re-derive its own answer from provider data — that is exactly how a
   * cautious rule gets quietly relaxed in a later layout tweak.
   */
  dogWaterConfirmed: boolean;
  emergencyCareConfirmed: boolean;
  /** When the SOURCE last changed, not when we fetched it. */
  sourceUpdatedAt: string | null;
  /** ISO timestamp of our fetch — what the TTL and the staleness note read. */
  fetchedAt: string;
}

/** Where a result came from. Drives the `cache_status` analytics property. */
export type SpotCacheStatus =
  | 'local_hit'
  | 'server_hit'
  | 'stale_hit'
  | 'upstream_fetch';

/** The endpoint's response shape, and what the local cache stores. */
export interface NearbySpotsResult {
  spots: PawtchiSpot[];
  cacheStatus: SpotCacheStatus;
  /** Echoed back so the client can tell which radius produced this set. */
  radiusMeters: number;
  /** ISO. Drives "showing saved results" copy when the data is old. */
  fetchedAt: string;
}

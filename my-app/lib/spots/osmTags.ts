/**
 * The OSM tag table — the single place any category↔tag rule may live.
 *
 * Both halves of the system read this file: `overpassQuery.ts` builds the
 * upstream query from it, and `classify.ts` reads the same constants to decide
 * what came back. Splitting those two would let the query and the classifier
 * drift, which fails silently — you fetch a category and then throw it away.
 *
 * ── On bumping SPOT_QUERY_VERSION ──
 * The version is embedded in every cache key, device and server. Changing any
 * rule below without bumping it means users keep seeing results produced by the
 * OLD rules for up to 72 hours, with no way to tell. Bump it in the same commit
 * as the rule change, every time.
 */

import type { SpotCategory } from './types';

/**
 * Invalidates every cache layer at once. Bump on ANY change to the rules in
 * this file or to the shape of `PawtchiSpot`.
 *
 * v1 — initial release.
 * v2 — per-category element caps, and tidal foreshore excluded. A live probe
 *      found the single global cap let dense drinking-water coverage starve out
 *      every other category, and that the Thames foreshore was being offered as
 *      twelve "beaches" in central London. Both change what comes back, so v1
 *      rows must not be reused.
 */
export const SPOT_QUERY_VERSION = 2;

/**
 * Walking trails are built, tested and NOT queried.
 *
 * Telling a recreational trail from the pavement outside a house using
 * `highway=path|footway` is genuinely hard: the tags are identical and the
 * difference lives in context OSM does not reliably encode. Querying them
 * returns thousands of way fragments per cell — mostly pavement — which would
 * both bury the real results and blow the response budget.
 *
 * The classifier handles the category correctly, so turning this on is a
 * one-line change plus a version bump once we have a heuristic worth shipping.
 */
export const SPOT_TRAILS_ENABLED = false;

// ── Access gates ───────────────────────────────────────────────────────────

/** `dog=*` values that mean a dog is welcome, and how welcome. */
export const DOG_OFF_LEASH_VALUES = ['unleashed'] as const;
export const DOG_DESIGNATED_VALUES = ['designated'] as const;
export const DOG_ON_LEASH_VALUES = ['leashed', 'on_leash'] as const;
export const DOG_ALLOWED_VALUES = ['yes'] as const;

/** `dog=*` values that mean no. A dog-prohibited place is never surfaced. */
export const DOG_PROHIBITED_VALUES = ['no'] as const;

/**
 * `access=*` values that put a place out of reach of a member of the public.
 *
 * `customers` is deliberately NOT here. A pet store's car park tagged
 * `access=customers` is exactly where a dog owner is entitled to be — treating
 * it as private would hide the shops we most want to show.
 */
export const BLOCKED_ACCESS_VALUES = ['no', 'private', 'permit'] as const;

/** Lifecycle keys/values that mean the place is not there any more. */
export const LIFECYCLE_KEYS = ['disused', 'abandoned', 'demolished', 'razed'] as const;

// ── Category rules ─────────────────────────────────────────────────────────

/**
 * One Overpass filter clause. `k`/`v` map to `["k"="v"]`; omitting `v` matches
 * the key's mere presence. `regex` emits `["k"~"v"]`.
 */
export interface TagClause {
  k: string;
  v?: string;
  regex?: boolean;
}

export interface CategoryRule {
  category: SpotCategory;
  /**
   * Per-category element cap.
   *
   * These exist because a SINGLE global cap does not work. A live probe of
   * central London returned exactly the global limit, of which 46 were drinking
   * fountains — and because the cap applies to the whole union, that density
   * starved out every off-leash park and pet shop in the area. The response
   * looked healthy and the results were wrong.
   *
   * Overpass allows several `out` statements, each emitting the current set, so
   * each category gets its own budget and no category can crowd out another.
   *
   * Sized by value, not by how common the thing is: off-leash parks are what
   * this feature is for, and nobody has ever needed the 40th nearest tap.
   */
  limit: number;
  /**
   * Which Overpass element types to ask for. Vets and shops are overwhelmingly
   * nodes but are sometimes mapped as building outlines, so most categories
   * need ways too. Relations only where multipolygons are genuinely common —
   * asking for them everywhere triples the response for almost no extra places.
   */
  elements: ('node' | 'way' | 'relation')[];
  /** Each entry is one OR'd query line; the clauses within it are AND'd. */
  selectors: TagClause[][];
}

/**
 * Ordered by specificity, and `classify.ts` takes the FIRST match.
 *
 * That ordering is load-bearing: a fenced off-leash enclosure inside a public
 * park carries both `leisure=dog_park` and (on the parent way) `leisure=park`.
 * Off-leash is the more useful and more specific answer, so it must win.
 */
export const CATEGORY_RULES: CategoryRule[] = [
  {
    category: 'off_leash_park',
    limit: 25,
    elements: ['node', 'way'],
    selectors: [
      [{ k: 'leisure', v: 'dog_park' }],
      [{ k: 'dog', v: 'unleashed' }],
    ],
  },
  {
    category: 'veterinary',
    limit: 20,
    elements: ['node', 'way'],
    selectors: [[{ k: 'amenity', v: 'veterinary' }]],
  },
  {
    category: 'pet_store',
    limit: 20,
    elements: ['node', 'way'],
    selectors: [
      [{ k: 'shop', v: 'pet' }],
      // Grooming and pet supply are mapped inconsistently; `pet_grooming` is
      // the only sibling common enough to be worth the extra clause.
      [{ k: 'shop', v: 'pet_grooming' }],
    ],
  },
  {
    category: 'drinking_water',
    limit: 15,
    elements: ['node'],
    selectors: [
      [{ k: 'amenity', v: 'drinking_water' }],
      [{ k: 'amenity', v: 'water_point' }],
    ],
  },
  {
    category: 'dog_friendly_beach',
    limit: 15,
    elements: ['node', 'way', 'relation'],
    selectors: [[{ k: 'natural', v: 'beach' }]],
  },
  {
    category: 'dog_friendly_park',
    limit: 30,
    elements: ['node', 'way', 'relation'],
    selectors: [
      [{ k: 'leisure', v: 'park' }],
      [{ k: 'leisure', v: 'garden' }],
      [{ k: 'leisure', v: 'common' }],
      [{ k: 'leisure', v: 'nature_reserve' }],
    ],
  },
  {
    category: 'walking_trail',
    limit: 20,
    elements: ['way', 'relation'],
    selectors: [
      [{ k: 'route', v: 'hiking' }],
      [{ k: 'route', v: 'walking' }],
    ],
  },
];

/** Categories actually sent upstream — trails drop out until they earn a place. */
export function queryableCategories(): SpotCategory[] {
  return CATEGORY_RULES.map(r => r.category).filter(
    c => c !== 'walking_trail' || SPOT_TRAILS_ENABLED,
  );
}

/**
 * Tags worth carrying into a details sheet.
 *
 * An allowlist rather than "keep everything": an OSM element can carry a
 * hundred keys, and storing them all would bloat every cache row with data no
 * screen will ever read. If a sheet needs a new field, add the key here.
 */
export const DETAIL_TAG_KEYS = [
  'name',
  'dog',
  'access',
  'opening_hours',
  'website',
  'contact:website',
  'phone',
  'contact:phone',
  'surface',
  'barrier',
  'fence_type',
  'lit',
  'emergency',
  'drinking_water',
  'bowl',
  'description',
  'addr:housenumber',
  'addr:street',
  'addr:city',
  'addr:postcode',
] as const;

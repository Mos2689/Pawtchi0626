/**
 * classify — the honesty layer.
 *
 * Every claim Pawtchi makes about a place is decided here, and the rule is the
 * same throughout: **say only what the data says.** OSM is crowd-mapped and
 * wildly uneven, so the failure mode to design against is not "we missed a
 * park", it is "we told someone their dog could run free somewhere it can't".
 *
 * Three functions, in the order the pipeline calls them:
 *
 *   isExcluded  → should this place never be shown at all?
 *   categoryOf  → what kind of place is it?
 *   dogAccessOf → what, if anything, can we say about bringing a dog?
 */

import {
  BLOCKED_ACCESS_VALUES,
  CATEGORY_RULES,
  DOG_ALLOWED_VALUES,
  DOG_DESIGNATED_VALUES,
  DOG_OFF_LEASH_VALUES,
  DOG_ON_LEASH_VALUES,
  DOG_PROHIBITED_VALUES,
  LIFECYCLE_KEYS,
} from './osmTags.ts';
import type { DogAccessStatus, SpotCategory } from './types.ts';

export type OsmTags = Record<string, string>;

function has(values: readonly string[], v: string | undefined): boolean {
  return v !== undefined && values.includes(v);
}

/**
 * Places that must never appear in a normal result list.
 *
 * Note what is NOT here: a park with no dog tag. That is `unknown`, not
 * excluded — see `dogAccessOf`. Exclusion is reserved for places that are
 * either gone, off-limits to the public, or explicitly dog-free.
 */
export function isExcluded(tags: OsmTags): boolean {
  // Explicitly no dogs. The one unambiguous signal in the whole schema.
  if (has(DOG_PROHIBITED_VALUES, tags.dog)) return true;

  /**
   * Tidal "beaches" — the intertidal zone, not a beach you can walk on.
   *
   * Found by a live probe of central London, which returned twelve of them,
   * one 480 m from Leicester Square. Every single one was the Thames
   * foreshore: `natural=beach, surface=sand, tidal=yes`, unnamed, so they all
   * rendered as a card simply saying "Beach".
   *
   * This is the most dangerous thing this feature could have shipped. The
   * foreshore is submerged for half of every day and has currents the PLA
   * publishes warnings about — and we would have offered it to someone looking
   * for somewhere to take a dog. A dry beach is mapped as the dry part; the
   * tidal polygon is the water's edge and is never the thing we mean.
   */
  if (tags.natural === 'beach' && tags.tidal === 'yes') return true;

  // Not open to a member of the public.
  if (has(BLOCKED_ACCESS_VALUES, tags.access)) return true;
  // `foot=no` on a park or beach means you cannot walk in, dog or not.
  if (tags.foot === 'no') return true;

  // Gone. Two encodings: a `disused=yes` flag, or the lifecycle PREFIX form
  // (`disused:amenity=veterinary`) which is the one that actually catches
  // closed vets — the flag form is comparatively rare.
  for (const key of LIFECYCLE_KEYS) {
    if (tags[key] === 'yes') return true;
    const prefix = `${key}:`;
    for (const k of Object.keys(tags)) {
      if (k.startsWith(prefix)) return true;
    }
  }

  return false;
}

/**
 * First match wins, and `CATEGORY_RULES` is ordered by specificity — so a
 * fenced dog run inside a public park classifies as off-leash rather than as a
 * generic park. See the ordering note in osmTags.ts.
 *
 * Returns null for anything the rules do not recognise, which the normalizer
 * drops. Overpass occasionally returns elements that matched a sibling query
 * clause but carry none of our tags.
 */
export function categoryOf(tags: OsmTags): SpotCategory | null {
  for (const rule of CATEGORY_RULES) {
    for (const clauses of rule.selectors) {
      const matched = clauses.every(c =>
        c.v === undefined ? tags[c.k] !== undefined : tags[c.k] === c.v,
      );
      if (matched) return rule.category;
    }
  }
  return null;
}

/**
 * What we can say about bringing a dog.
 *
 * The `unknown` default is the most important line in this file. Roughly the
 * majority of parks and beaches worldwide carry no `dog=*` tag at all, and the
 * tempting shortcut — "it's a park, parks allow dogs" — is exactly the claim
 * that gets someone fined, or worse, lets a dog off the lead somewhere with
 * livestock. An unknown is honest and the UI is built to render it plainly.
 *
 * `leisure=dog_park` is the sole exception where we infer rather than read: a
 * dog park with no dog tag is off-leash by definition of what it is.
 */
export function dogAccessOf(tags: OsmTags, category: SpotCategory): DogAccessStatus {
  const dog = tags.dog;

  if (has(DOG_PROHIBITED_VALUES, dog)) return 'prohibited';
  if (has(DOG_OFF_LEASH_VALUES, dog)) return 'off_leash';
  if (has(DOG_ON_LEASH_VALUES, dog)) return 'on_leash';

  // `designated` means "this place is FOR dogs". In a dog park that reads as
  // off-leash; anywhere else it only tells us dogs are catered for, not that
  // they may be loose — so it lands on the weaker `dog_friendly`.
  if (has(DOG_DESIGNATED_VALUES, dog)) {
    return category === 'off_leash_park' ? 'off_leash' : 'dog_friendly';
  }

  if (has(DOG_ALLOWED_VALUES, dog)) return 'dog_friendly';

  // The one inference we allow, and only because the category IS the claim.
  if (category === 'off_leash_park') return 'off_leash';

  // Vets and pet shops obviously take dogs; saying so adds nothing and would
  // put a redundant badge on every one of them.
  if (category === 'veterinary' || category === 'pet_store') return 'dog_friendly';

  return 'unknown';
}

/**
 * Whether a drinking-water point is confirmed usable by a dog.
 *
 * Kept separate from `dogAccessOf` because the question is different: nobody
 * bans a dog from a public fountain, but very few of them are reachable by one.
 * A human fountain on a post is not a dog bowl, so the label stays "Drinking
 * water" unless the mapper said otherwise.
 */
export function isDogWater(tags: OsmTags): boolean {
  if (tags.bowl === 'yes' || tags.dog_bowl === 'yes') return true;
  return has([...DOG_ALLOWED_VALUES, ...DOG_DESIGNATED_VALUES], tags.dog);
}

/**
 * Whether a vet is confirmed to offer emergency care.
 *
 * Only an explicit `emergency=yes` counts. Getting this wrong sends someone to
 * a locked door at 2am with a sick animal, so there is no inference here at
 * all — not from opening hours, not from the name.
 */
export function isEmergencyVet(tags: OsmTags): boolean {
  return tags.emergency === 'yes';
}

/**
 * Whether the place is enclosed. `true`/`false`/`null` are three distinct
 * answers and the sheet renders only the first two — "we don't know if it's
 * fenced" is not worth a row.
 */
export function fencedOf(tags: OsmTags): boolean | null {
  if (tags.barrier === 'fence' || tags.fence_type !== undefined) return true;
  if (tags.barrier === 'no') return false;
  return null;
}

export function litOf(tags: OsmTags): boolean | null {
  if (tags.lit === 'yes') return true;
  if (tags.lit === 'no') return false;
  return null;
}

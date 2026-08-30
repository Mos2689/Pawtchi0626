/**
 * What a place is FOR, and therefore what its button should do.
 *
 * ── The distinction ──
 * A park is somewhere you take the dog. A vet is somewhere you have to get to.
 * Those are different errands and they deserve different buttons, which is the
 * whole of this module:
 *
 *   'walk' — Pawtchi draws the way there and offers to start a tracked walk.
 *            The dog is the point of the journey.
 *   'maps'  — hand off to Apple or Google Maps. The destination is the point of
 *            the journey, and pretending otherwise would make Pawtchi a worse
 *            version of an app already on the phone.
 *
 * ── Why this is a hard split and not a preference ──
 * Two reasons, and the second is the one that will outlive the first.
 *
 * A route preview costs a request to FOSSGIS's donated pedestrian OSRM instance
 * (see routePolicy.ts). Previewing every card an owner scrolls past would spend
 * someone else's infrastructure on places nobody intends to walk to. Restricting
 * previews to the places people actually walk to bounds that spend semantically
 * rather than by an arbitrary counter — a limit that stays correct as the
 * feature grows, where a number would have needed re-tuning.
 *
 * And it keeps the product honest. Pawtchi does not do turn-by-turn, has no
 * traffic, and cannot tell you the vet closes in ten minutes. For a genuine
 * errand the right answer is the app that can, and offering a worse one because
 * it keeps the user in-app is the kind of decision that costs trust exactly once.
 *
 * ── On drinking water ──
 * The ambiguous one: not a commercial premises, but not really a destination
 * either — a fountain is something you pass on a walk rather than plan one
 * around. It sits in 'walk' so the rule stays statable as "commercial premises
 * hand off, everything outdoors stays here", and because "start walking to
 * water" is a sensible thing to want on a hot afternoon. Moving it is a
 * one-line change to the array below.
 */

import type { SpotCategory } from './types';

export type SpotAction = 'walk' | 'maps';

/**
 * The categories Pawtchi will draw a route to and offer to start a walk to.
 *
 * Deliberately a list of what IS included rather than what is excluded: a new
 * category added to types.ts defaults to 'maps', which is the safe direction to
 * fail. A place we forgot to classify sends the owner to a map that works,
 * rather than silently spending a routing request on it.
 */
export const WALK_TO_CATEGORIES: readonly SpotCategory[] = [
  'off_leash_park',
  'dog_friendly_park',
  'dog_friendly_beach',
  'walking_trail',
  'drinking_water',
];

export function spotAction(category: SpotCategory): SpotAction {
  return WALK_TO_CATEGORIES.includes(category) ? 'walk' : 'maps';
}

/** Sugar for the common read, so call sites don't compare strings. */
export function isWalkToSpot(category: SpotCategory): boolean {
  return spotAction(category) === 'walk';
}

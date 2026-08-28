/**
 * Retired: the species picker (Aug 2026).
 *
 * Pawtchi is a walk-first, dog-only product, so onboarding no longer asks
 * whether the pet is a dog or a cat — it opens directly on identity, and the
 * draft defaults to `dog` (see store/usePetStore.ts).
 *
 * ── Why this file still exists rather than being deleted ──
 * Two live things still point at this path and cannot be retrospectively
 * changed:
 *
 *   1. `onboarding_incomplete` push notifications already delivered to
 *      devices. Their route was resolved when they were sent.
 *   2. Any build in the wild that has not taken this update yet.
 *
 * Deleting the route would turn those taps into an unmatched-route screen. A
 * redirect turns them into exactly what they were meant to be: an owner
 * arriving at onboarding.
 *
 * `replace`, not `push`, so this never lands in the history stack and the back
 * chevron on identity has nothing to return to.
 *
 * ── What was NOT removed ──
 * Only the picker UI. Every other piece of cat support is untouched: the
 * `species` column and its CHECK constraint, `Species` in the store,
 * `hydrateFromPet` resolving a stored cat, and every `species === 'cat'` branch
 * in health, meals and the tabs. Existing cat profiles keep working exactly as
 * they did — they simply cannot be CREATED from onboarding any more.
 */

import { Redirect } from 'expo-router';

export default function SpeciesScreen() {
  return <Redirect href="/onboarding/identity" />;
}

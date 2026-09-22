/**
 * Which of a walk's photos may appear on the pack's shared map, and where.
 *
 * Two rules, and both of them are about not showing somebody something that
 * isn't true:
 *
 *   Shared only. A photo taken while the camera said "Personal" is a private
 *   keepsake. Putting it on a map the whole pack is looking at would publish
 *   it in the only sense that matters to the person who took it, without ever
 *   uploading it — and the consent was read at shutter time precisely so that
 *   nothing downstream has to re-decide it.
 *
 *   Located only. A capture whose fix had not landed yet has no coordinate.
 *   There is no honest place to put it, and "roughly where the walker was"
 *   is a guess drawn as a fact. It is counted but not pinned: it happened,
 *   we just cannot say where.
 */

import type { LiveCapture } from '../walk/recorderHandle';

export interface MomentPin {
  id: string;
  lat: number;
  lng: number;
  uri: string;
}

/** Everything shared AND located, in capture order. */
export function momentPinsFrom(captures: readonly LiveCapture[]): MomentPin[] {
  const pins: MomentPin[] = [];
  for (const capture of captures) {
    if (!capture.shared) continue;
    if (capture.lat == null || capture.lng == null) continue;
    if (!Number.isFinite(capture.lat) || !Number.isFinite(capture.lng)) continue;
    pins.push({ id: String(capture.id), lat: capture.lat, lng: capture.lng, uri: capture.uri });
  }
  return pins;
}

/**
 * What the sheet's MOMENTS stat says.
 *
 * Published rows plus this phone's shared-but-not-yet-uploaded ones. Counts a
 * located photo and an unlocated one alike — the count is about how many
 * moments this walk has, which does not depend on whether the GPS had settled.
 *
 * During a walk `published` is nearly always zero, because
 * `community_shared_media` is written when the walk ends. That was the whole
 * bug: the counter queried a table that is empty by construction until after
 * the thing it is counting is over.
 */
export function liveMomentCount(published: number, captures: readonly LiveCapture[]): number {
  const mine = captures.filter(capture => capture.shared).length;
  return Math.max(0, published) + mine;
}

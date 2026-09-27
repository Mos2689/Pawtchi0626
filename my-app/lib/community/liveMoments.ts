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

/** One photo somebody else on this walk has already shared. */
export interface PublishedMoment {
  id: string;
  lat: number | null;
  lng: number | null;
  /** A signed URL, or null while one is still being minted. */
  uri: string | null;
}

/**
 * Everyone else's photos, pinned.
 *
 * Kept apart from `momentPinsFrom` above because the two have genuinely
 * different rules: a local draft is a file on this phone and always has an
 * image, while somebody else's is a row that may be ahead of its signed URL.
 * A pin with no picture is still worth placing — it says a moment happened
 * there — so the uri is allowed to be null and the map draws the marker
 * without a thumbnail.
 */
export function publishedPinsFrom(moments: readonly PublishedMoment[]): MomentPin[] {
  const pins: MomentPin[] = [];
  for (const moment of moments) {
    if (moment.lat == null || moment.lng == null) continue;
    if (!Number.isFinite(moment.lat) || !Number.isFinite(moment.lng)) continue;
    pins.push({ id: moment.id, lat: moment.lat, lng: moment.lng, uri: moment.uri ?? '' });
  }
  return pins;
}

/**
 * What the sheet's MOMENTS stat says.
 *
 * ── `others` really must be OTHERS ─────────────────────────────────────────
 *
 * This used to take every published row, which was safe only because the table
 * was empty until the walk ended — a photo now reaches the pack the moment the
 * shutter fires, so this phone's own photos are in that table *while* its own
 * drafts are still in `captures`. Adding both would count each of them twice,
 * and the number would climb as the uploads landed.
 *
 * So the caller filters its own contributions out, and this adds the two
 * halves: what other people have shared, and what this phone has taken.
 *
 * Counts a located photo and an unlocated one alike — the count is about how
 * many moments this walk has, which does not depend on whether the GPS had
 * settled.
 */
export function liveMomentCount(others: number, captures: readonly LiveCapture[]): number {
  const mine = captures.filter(capture => capture.shared).length;
  return Math.max(0, others) + mine;
}

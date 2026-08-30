/**
 * Place memory — the reason this feature exists.
 *
 * A dog owner walks the same loop most days, so a record derived only from GPS
 * produces a near-identical artifact every time. Place memory inverts that:
 * walking the same corner over and over is exactly what makes "here is that
 * tree in March, and here it is now" possible. Repetition stops being the thing
 * that flattens the product and becomes the thing that gives it depth.
 *
 * This module decides ONE thing: standing here, right now, is there a past
 * moment worth offering to pair with? Pure — the caller supplies the candidate
 * keepsakes (fetched with neighbourPlaceKeys from placeKey.ts) and the prompt
 * history; nothing here reads a database or a clock it was not given.
 *
 * ── Why the gates are conservative ──
 * The failure mode of this feature is nagging. A user on a daily loop passes
 * dozens of remembered places, and a product that says "remember this?" at
 * every lamppost teaches people to ignore it inside a week. Every constant
 * below exists to make the offer rare enough to still feel like a gift, which
 * is also what the PRD's §5.7 constraint demands: variability comes from the
 * world, not from us finding more excuses to interrupt.
 */

import { haversineMeters, type GeoPoint } from './geo';
import { PLACE_MATCH_RADIUS_M } from './placeKey';
import { type Keepsake } from './keepsake';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How old an anchor must be before a then/now is worth offering.
 *
 * Three weeks is the floor where change is actually visible — a puppy has
 * grown, the light has moved, the tree has turned. Below that the pair reads as
 * two photos of the same afternoon, which is a chore rather than a gift.
 */
export const MIN_ANCHOR_AGE_DAYS = 21;

/**
 * How long a place stays quiet after it has been offered.
 *
 * On a daily route the same tree comes round every single day. Without this the
 * feature is an alarm clock.
 */
export const PLACE_COOLDOWN_DAYS = 14;

/**
 * At most one place-memory offer per walk.
 *
 * A well-trodden route can hold a dozen eligible anchors. Offering all of them
 * turns a walk into a checklist; offering the single best one keeps it a
 * surprise. This is the most important constant in the file.
 */
export const MAX_OFFERS_PER_WALK = 1;

/** A past keepsake close enough to count as "here", with its context. */
export interface PlaceAnchor {
  keepsake: Keepsake;
  distanceM: number;
  ageDays: number;
}

export interface PlaceMemoryOffer {
  /** The past moment to pair with — always the oldest eligible one. */
  anchor: Keepsake;
  ageDays: number;
  /** How many past moments this place holds, including the anchor. */
  visitCount: number;
  /**
   * Distinct calendar months represented here.
   *
   * Months rather than seasons on purpose: "season" flips meaning across the
   * equator, and Pawtchi has users in both hemispheres. A month count is
   * hemisphere-neutral and needs no lookup table to stay honest.
   */
  distinctMonths: number;
}

export interface PlaceMemoryInput {
  /** Where the walker is standing now. */
  here: GeoPoint;
  now: number;
  /** Past keepsakes from the neighbouring place cells — may include far ones. */
  candidates: readonly Keepsake[];
  /** When this place last produced an offer, or null if never. */
  lastPromptAt: number | null;
  /** Offers already made during this walk. */
  offersThisWalk: number;
  radiusM?: number;
}

/**
 * A keepsake can only anchor a then/now if its image can actually be shown.
 *
 * Rung 3 of the degradation ladder (metadata only) is a perfectly good way to
 * remember a walk, but it cannot carry a side-by-side: "compare this with the
 * photo from March" followed by an empty frame is a promise broken at the exact
 * moment the user leaned in.
 *
 * ── Why the thumbnail specifically, and not hasImage ──
 * An anchor comes from a DIFFERENT walk, often years back, and the offer is
 * rendered from a signed thumbnail URL — see useWalkKeepsakes. The local rungs
 * cannot serve it: a camera-roll id may be from a phone the user no longer
 * owns, and an owned file is gone after a reinstall. Accepting either would let
 * `evaluatePlaceMemory` pick an anchor that then resolves to nothing, and
 * because it returns only the single oldest match, one unusable anchor
 * suppresses the usable one behind it. The prompt would simply not appear, on a
 * feature that fires about once a fortnight — the kind of silence nobody
 * reports and nobody notices.
 */
export function canAnchor(keepsake: Keepsake): boolean {
  return Boolean(keepsake.thumbPath);
}

/** Whole days between two instants, floored. */
function ageInDays(from: number, to: number): number {
  return Math.floor((to - from) / DAY_MS);
}

/**
 * Narrow the coarse cell query down to what is genuinely here — stage 2 of the
 * two-stage lookup described in placeKey.ts. Sorted oldest first.
 */
export function findPlaceAnchors(
  input: Pick<PlaceMemoryInput, 'here' | 'now' | 'candidates' | 'radiusM'>,
): PlaceAnchor[] {
  const radiusM = input.radiusM ?? PLACE_MATCH_RADIUS_M;

  const anchors: PlaceAnchor[] = [];
  for (const keepsake of input.candidates) {
    if (keepsake.lat == null || keepsake.lng == null) continue;
    // A capture in the future is a clock-skew artefact; it cannot be a memory.
    if (keepsake.capturedAt > input.now) continue;

    const distanceM = haversineMeters(input.here, { lat: keepsake.lat, lng: keepsake.lng });
    if (distanceM > radiusM) continue;

    anchors.push({
      keepsake,
      distanceM,
      ageDays: ageInDays(keepsake.capturedAt, input.now),
    });
  }

  return anchors.sort((a, b) => a.keepsake.capturedAt - b.keepsake.capturedAt);
}

/**
 * Should we offer a then/now right here, right now?
 *
 * Returns null far more often than not, by design. The oldest eligible anchor
 * wins because it carries the largest visible change — the whole point of the
 * pairing is the delta, and a year beats a month every time.
 */
export function evaluatePlaceMemory(input: PlaceMemoryInput): PlaceMemoryOffer | null {
  if (input.offersThisWalk >= MAX_OFFERS_PER_WALK) return null;

  if (
    input.lastPromptAt != null &&
    ageInDays(input.lastPromptAt, input.now) < PLACE_COOLDOWN_DAYS
  ) {
    return null;
  }

  const anchors = findPlaceAnchors(input).filter((a) => canAnchor(a.keepsake));
  if (anchors.length === 0) return null;

  // Oldest first from findPlaceAnchors, so [0] is the biggest delta available.
  const oldest = anchors[0];
  if (oldest.ageDays < MIN_ANCHOR_AGE_DAYS) return null;

  const months = new Set(
    anchors.map((a) => {
      const d = new Date(a.keepsake.capturedAt);
      return `${d.getFullYear()}-${d.getMonth()}`;
    }),
  );

  return {
    anchor: oldest.keepsake,
    ageDays: oldest.ageDays,
    visitCount: anchors.length,
    distinctMonths: months.size,
  };
}

/**
 * dedupe — one place, one pin.
 *
 * Duplicates arrive two ways, and they need different answers:
 *
 *   1. **Same element twice.** Overpass can return an element more than once
 *      when it matches several clauses of a union query. Same id ⇒ same place,
 *      trivially.
 *   2. **The same real place mapped twice.** A vet mapped as both a node and
 *      the building outline around it; a park whose café is tagged
 *      `leisure=park` too. Different ids, ~same coordinates, same category.
 *
 * Case 2 is where care is needed. Collapsing too eagerly merges two genuinely
 * adjacent shops into one; collapsing too little puts two pins on one building.
 * 25 m is tuned for the second failure being the visible one — at Home's
 * backdrop zoom, two pins 25 m apart overlap into an unreadable smudge.
 *
 * Determinism matters as much as correctness: the same input must always
 * produce the same output in the same order, or the rail reshuffles itself on
 * every refresh.
 */

import { haversineMeters } from '../walk/geo';
import type { PawtchiSpot } from './types';

/** Below this, two same-category records are treated as one place. */
export const MERGE_RADIUS_M = 25;

/**
 * How much a record actually tells us. Decides which of two duplicates wins.
 *
 * A named record always beats an unnamed one — that is the difference between
 * "Fairhaven Veterinary" and "Veterinary clinic" on the card — so it is
 * weighted above everything else combined.
 */
export function richness(spot: PawtchiSpot): number {
  let score = 0;
  if (spot.name) score += 10;
  if (spot.openingHours) score += 2;
  if (spot.phone) score += 2;
  if (spot.website) score += 2;
  if (spot.address) score += 2;
  if (spot.dogAccess !== 'unknown') score += 3;
  if (spot.fenced !== null) score += 1;
  if (spot.lit !== null) score += 1;
  if (spot.surface) score += 1;
  return score;
}

/**
 * Merge two records of the same place, field by field.
 *
 * Not "keep the richer one wholesale": a node may carry the phone number while
 * the building way carries the opening hours, and taking either alone loses
 * real information. The richer record wins identity (id, name, position) and
 * the other fills its gaps.
 */
function merge(a: PawtchiSpot, b: PawtchiSpot): PawtchiSpot {
  const [primary, secondary] = richness(a) >= richness(b) ? [a, b] : [b, a];
  return {
    ...primary,
    name: primary.name ?? secondary.name,
    accessDescription: primary.accessDescription ?? secondary.accessDescription,
    address: primary.address ?? secondary.address,
    openingHours: primary.openingHours ?? secondary.openingHours,
    website: primary.website ?? secondary.website,
    phone: primary.phone ?? secondary.phone,
    surface: primary.surface ?? secondary.surface,
    fenced: primary.fenced ?? secondary.fenced,
    lit: primary.lit ?? secondary.lit,
    // A known access status beats an unknown one regardless of which record is
    // otherwise richer — this is the field we are least willing to lose.
    dogAccess: primary.dogAccess !== 'unknown' ? primary.dogAccess : secondary.dogAccess,
    sourceUpdatedAt: primary.sourceUpdatedAt ?? secondary.sourceUpdatedAt,
  };
}

/**
 * Collapse duplicates. Input order is preserved for survivors, so the result is
 * a deterministic function of the input.
 *
 * O(n²) in the proximity pass, deliberately. `n` is capped at 120 by the
 * endpoint, so this is at most ~7000 comparisons of a cheap trig function —
 * far below the cost of the spatial index that would replace it.
 */
export function dedupeSpots(spots: readonly PawtchiSpot[]): PawtchiSpot[] {
  // Pass 1 — exact identity.
  const byId = new Map<string, PawtchiSpot>();
  for (const spot of spots) {
    const existing = byId.get(spot.id);
    byId.set(spot.id, existing ? merge(existing, spot) : spot);
  }

  // Pass 2 — same place, different mapping.
  const out: PawtchiSpot[] = [];
  for (const spot of byId.values()) {
    const twinIndex = out.findIndex(
      candidate =>
        candidate.category === spot.category &&
        haversineMeters(
          { lat: candidate.latitude, lng: candidate.longitude },
          { lat: spot.latitude, lng: spot.longitude },
        ) <= MERGE_RADIUS_M,
    );
    if (twinIndex === -1) out.push(spot);
    else out[twinIndex] = merge(out[twinIndex], spot);
  }
  return out;
}

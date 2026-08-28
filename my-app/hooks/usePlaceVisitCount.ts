/**
 * usePlaceVisitCount — how many times this spot has been photographed before.
 *
 * The sentence this feeds ("the third time this spot has been worth stopping
 * for") is the one that turns a repeated route from the product's problem into
 * its point. Everything else in a caption describes one walk; this describes a
 * relationship with a place.
 *
 * Counts only moments STRICTLY EARLIER than the one being viewed, so the line
 * stays true when scrolling back through an archive — a photo from March must
 * not be told about photos taken in August.
 *
 * Fetched per viewed photo rather than for a whole gallery: it is one query at
 * the moment someone opens a picture and lingers, which is the cheapest place
 * in the product to spend one.
 */

import { useEffect, useState } from 'react';
import { fetchPlaceCandidates } from '../lib/walk/keepsakeSync';
import { findPlaceAnchors } from '../lib/walk/placeMemory';
import type { Keepsake } from '../lib/walk/keepsake';

export function usePlaceVisitCount(
  petId: string | null,
  keepsake: Keepsake | null,
): number {
  const [count, setCount] = useState(0);

  const lat = keepsake?.lat ?? null;
  const lng = keepsake?.lng ?? null;
  const capturedAt = keepsake?.capturedAt ?? null;
  const id = keepsake?.id ?? null;

  useEffect(() => {
    if (!petId || lat == null || lng == null || capturedAt == null) {
      setCount(0);
      return;
    }

    let cancelled = false;
    // Reset while the answer is in flight: carrying the previous photo's count
    // into this one would attach a true sentence to the wrong place.
    setCount(0);

    void (async () => {
      const candidates = await fetchPlaceCandidates(petId, lat, lng);
      if (cancelled) return;

      // The cell query is deliberately coarse; findPlaceAnchors applies the
      // real distance filter, so the two stages stay consistent with the rest
      // of place memory rather than re-deciding "here" with a second rule.
      const anchors = findPlaceAnchors({
        here: { lat, lng },
        now: capturedAt,
        candidates: candidates.filter(
          (c) => c.id !== id && c.capturedAt < capturedAt,
        ),
      });

      if (!cancelled) setCount(anchors.length);
    })();

    return () => {
      cancelled = true;
    };
  }, [petId, lat, lng, capturedAt, id]);

  return count;
}

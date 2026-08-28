/**
 * useKeepsakePins — the moments belonging to one walk, ready to pin on a map.
 *
 * Home draws a selected walk's route and its sniff stops; this supplies the
 * third layer, the photographs. Keyed on the walk rather than the pet on
 * purpose: the map is showing ONE walk's line, so scattering every photo the
 * dog has ever produced across it would attach moments to a route they did not
 * happen on.
 *
 * Only moments with an observed coordinate come back. A timestamp-only import
 * has an estimated position, which is fine for a pin on a bare route drawing
 * but not on a real map with streets underneath — there it would look like a
 * claim about a specific doorway.
 *
 * Never throws: a failed fetch yields an empty list and the map simply shows
 * the walk without its photos.
 */

import { useEffect, useState } from 'react';
import { fetchWalkKeepsakes } from '../lib/walk/keepsakeSync';
import type { KeepsakeMapPin } from '../components/walk/KeepsakeMapOverlay';

const EMPTY: KeepsakeMapPin[] = [];

export function useKeepsakePins(walkSessionId: string | null): KeepsakeMapPin[] {
  const [pins, setPins] = useState<KeepsakeMapPin[]>(EMPTY);

  useEffect(() => {
    if (!walkSessionId) {
      setPins(EMPTY);
      return;
    }

    let cancelled = false;
    void (async () => {
      const rows = await fetchWalkKeepsakes(walkSessionId);
      if (cancelled) return;

      setPins(
        rows.flatMap((keepsake) =>
          keepsake.lat != null && keepsake.lng != null
            ? [{ id: keepsake.id, lat: keepsake.lat, lng: keepsake.lng, keepsake }]
            : [],
        ),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [walkSessionId]);

  return pins;
}

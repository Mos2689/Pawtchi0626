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
 *
 * ── Why it remembers ──
 * The caller is Home's rail, which changes this id every time a card settles. A
 * week of walks browsed back and forth was one `walk_media` query per swipe, all
 * of them asking about rows that had not changed since the last time. The answer
 * for a FINISHED walk is fixed — moments are captured during a walk, not after
 * it — so a walk already looked at this session is answered from memory.
 */

import { useEffect, useRef, useState } from 'react';
import { fetchWalkKeepsakes } from '../lib/walk/keepsakeSync';
import type { KeepsakeMapPin } from '../components/walk/KeepsakeMapOverlay';

const EMPTY: KeepsakeMapPin[] = [];

/**
 * How many walks to remember. Comfortably more than a rail holds, small enough
 * that a long browsing session cannot grow without bound.
 */
const CACHE_MAX_WALKS = 30;

export function useKeepsakePins(walkSessionId: string | null): KeepsakeMapPin[] {
  const [pins, setPins] = useState<KeepsakeMapPin[]>(EMPTY);

  /**
   * Per-mount, so it dies with the screen rather than with the module.
   *
   * Walk ids are UUIDs, so no entry can ever be served to the wrong walk or the
   * wrong pet whatever the scope — but a module-level cache would survive a
   * sign-out and hold one account's photo metadata in memory while the next one
   * used the app, which is not something to leave to id collisions.
   */
  const cache = useRef(new Map<string, KeepsakeMapPin[]>());

  useEffect(() => {
    if (!walkSessionId) {
      setPins(EMPTY);
      return;
    }

    const remembered = cache.current.get(walkSessionId);
    if (remembered) {
      setPins(remembered);
      return;
    }

    let cancelled = false;
    void (async () => {
      const rows = await fetchWalkKeepsakes(walkSessionId);
      if (cancelled) return;

      const next = rows.flatMap((keepsake) =>
        keepsake.lat != null && keepsake.lng != null
          ? [{ id: keepsake.id, lat: keepsake.lat, lng: keepsake.lng, keepsake }]
          : [],
      );

      // Oldest-first eviction. Map preserves insertion order, so the first key
      // is the walk looked at longest ago.
      if (cache.current.size >= CACHE_MAX_WALKS) {
        const oldest = cache.current.keys().next().value;
        if (oldest !== undefined) cache.current.delete(oldest);
      }
      cache.current.set(walkSessionId, next);
      setPins(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [walkSessionId]);

  return pins;
}

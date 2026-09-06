/**
 * useSpotArrival — did the owner actually get to the place they asked
 * directions to?
 *
 * The whole of the arrival check, and deliberately the least clever code in the
 * feature: read a note, read a position, compare two coordinates. Everything
 * that could be a policy — how near counts, how long the note lives — lives in
 * lib/spots/arrivalIntent.ts as pure, tested functions. This hook only decides
 * WHEN to ask and whether it is allowed to.
 *
 * ── When ──
 * On focus, which is to say when Home is looked at. That is the whole schedule.
 * There is no timer, no subscription and no background task: Pawtchi has no
 * background-location permission (see constants/features.ts) and this feature
 * was built to work without one rather than as a reason to ask for one.
 *
 * The trade is honest and small. Pawtchi cannot tap the owner on the shoulder
 * as they pull into the car park; it can only be ready when they open the app.
 * They were going to open the app — starting the walk is why they drove here.
 *
 * ── Whether ──
 * Three gates, all of which must pass, and none of which will ever prompt for
 * anything:
 *
 *   1. There is a note. It is written only by an explicit "Get directions" tap
 *      on a walkable place, and it expires.
 *   2. Location is ALREADY granted. This never calls
 *      `requestForegroundPermissionsAsync` — an owner who declined location does
 *      not get a permission dialog because they once looked up a beach.
 *   3. No walk is running. Offering to start a walk during a walk is nonsense,
 *      and the note survives to be offered after it ends.
 */

import { useCallback, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';

import {
  clearArrivalIntent,
  hasArrived,
  readArrivalIntent,
  type ArrivalIntent,
} from '../lib/spots/arrivalIntent';
import type { GeoPoint } from '../lib/walk/geo';

/**
 * How stale a cached fix may be and still describe where someone is standing.
 *
 * The failure this prevents is specific and would have been the whole bug: the
 * OS's last known position after a drive is very often the fix it took at the
 * house before the car moved. Comparing THAT against the beach says "not here"
 * for the one owner the feature exists for.
 *
 * Two minutes is short enough that a fix from the start of a drive can never
 * qualify, and long enough that an owner who has had the app open a moment ago
 * does not pay for a fresh fix.
 */
const MAX_FIX_AGE_MS = 2 * 60 * 1000;

/**
 * Read where the phone is, without ever asking for the right to.
 *
 * Returns null on every unhappy path — denied, unavailable, timed out, module
 * missing. Null means the prompt does not appear, which is the correct outcome:
 * `hasArrived` refuses to guess, and so does this.
 */
async function readPositionIfPermitted(): Promise<GeoPoint | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    const cached = await Location.getLastKnownPositionAsync({ maxAge: MAX_FIX_AGE_MS });
    if (cached) {
      return { lat: cached.coords.latitude, lng: cached.coords.longitude };
    }

    // Nothing recent enough. A single balanced fix, taken while the owner is
    // looking at the screen — the same thing Home already does to centre its
    // map, and for the same one-shot reason. Balanced rather than High: this
    // decision is made at a 300 m radius and does not need metres.
    const fresh = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return fresh ? { lat: fresh.coords.latitude, lng: fresh.coords.longitude } : null;
  } catch {
    return null;
  }
}

export interface SpotArrival {
  /** The place the owner is standing at, or null when there is nothing to offer. */
  intent: ArrivalIntent | null;
  /** Answer the prompt by starting the walk. Clears the note first. */
  accept: () => ArrivalIntent | null;
  /** Answer it by declining. The note is spent either way. */
  dismiss: () => void;
}

export function useSpotArrival(
  userId: string | null | undefined,
  /** Walk surfaces on, spots on, dog not cat — resolved by the caller. */
  enabled: boolean,
  /** False while a walk is running. A walk in progress is not an arrival. */
  idle: boolean,
): SpotArrival {
  const [intent, setIntent] = useState<ArrivalIntent | null>(null);

  /**
   * One check per focus, at most.
   *
   * `getCurrentPositionAsync` can outlive the focus that started it — the owner
   * switches away mid-fix — and without this a fast tab-switch could have two
   * passes racing to set the same state from two different positions.
   */
  const checking = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!enabled || !idle || !userId) {
        setIntent(null);
        return;
      }
      if (checking.current) return;
      checking.current = true;

      let cancelled = false;

      void (async () => {
        try {
          const note = await readArrivalIntent(userId);
          if (cancelled || !note) return;

          const position = await readPositionIfPermitted();
          if (cancelled) return;

          // Deliberately NOT cleared when the owner is elsewhere. They may be
          // halfway there — the note is spent by an answer, not by a look.
          if (hasArrived(note, position)) setIntent(note);
        } finally {
          checking.current = false;
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [enabled, idle, userId]),
  );

  const accept = useCallback(() => {
    const answered = intent;
    setIntent(null);
    void clearArrivalIntent(userId);
    return answered;
  }, [intent, userId]);

  const dismiss = useCallback(() => {
    setIntent(null);
    // Cleared, not merely hidden. "Not now" said at the beach means the offer
    // has been made and answered; keeping the note would re-ask on the next
    // focus, which is every tab switch for the rest of the afternoon.
    void clearArrivalIntent(userId);
  }, [userId]);

  return { intent, accept, dismiss };
}

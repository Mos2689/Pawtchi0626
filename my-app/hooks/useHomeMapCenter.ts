/**
 * useHomeMapCenter — the single answer to "where is Home's map pointed?"
 *
 * Resolution order, most honest source first:
 *
 *   1. The most recent walk that logged any coordinate, at any age. Not just
 *      the last walk and not just the last 7 days: a walk that produced one
 *      stray fix, or an owner who last went out a fortnight ago, should still
 *      open onto their own streets. This is the source we prefer because it is
 *      the dog's actual geography, already on our own row, costing no prompt.
 *   2. The device's last known position — but only if location is ALREADY
 *      granted, and only the cached fix. `getLastKnownPositionAsync` reads what
 *      the OS already has; it never starts the GPS, so this cannot become
 *      continuous collection by accident.
 *   3. Nothing, plus an offer to ask. A first-time owner has no coordinate
 *      anywhere in the app, so the map has nothing to draw until they either
 *      walk or grant location.
 *
 * The coordinate is used to aim a camera and is never stored, never sent
 * anywhere, and never written to a walk.
 *
 * On the prompt: Google Play requires a prominent in-app disclosure BEFORE the
 * runtime request, so this hook never fires the OS dialog on its own. It
 * reports that an ask is possible and waits to be called from a gesture. An
 * owner who already accepted the disclosure to start a walk is not shown it
 * twice.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { supabase } from '../lib/supabase';
import { WALK_TRACKING_ENABLED } from '../constants/features';
import type { GeoPoint } from '../lib/walk/geo';
import {
  acknowledgeLocationDisclosure,
  hasAcknowledgedLocationDisclosure,
} from '../lib/walk/locationDisclosure';

/**
 * One ask per account, not per install. A declined prompt must never become a
 * recurring nag — but it must also not carry across accounts: the key was
 * global, so a second owner on the same phone was silently treated as having
 * already declined, and the offer (with its disclosure) never appeared for them.
 * Namespaced on the Supabase user id, like `hooks/useFirstWalkIntro.ts`.
 */
const ASKED_PREFIX = 'home:map_location_asked';

export function mapLocationAskedKey(userId: string): string {
  return `${ASKED_PREFIX}:${userId}`;
}

/**
 * Last resolved coordinate, per pet.
 *
 * This is the actual cold-start cost on Home. The map cannot mount until it has
 * somewhere to point, and finding that somewhere means a Supabase round trip —
 * so on every launch the screen sat on an empty ground waiting for the network
 * before the first tile could even be requested.
 *
 * A dog's neighbourhood does not change between launches, so the previous
 * answer is almost always the right one. We paint from it immediately and
 * revalidate behind the live map; a real move shows up on the next launch,
 * which is the correct trade for a backdrop.
 *
 * Keyed per pet so a multi-pet account never opens on the other dog's streets.
 */
const CENTER_CACHE_PREFIX = 'home:map_center:';

/** How many recent rows to scan for a usable coordinate before giving up. */
const PLACE_LOOKUP_LIMIT = 5;

/** route JSONB may be [[lat,lng], ...] or [{lat,lng}, ...] — same as the feed. */
function firstPointOf(raw: unknown): GeoPoint | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const head = raw[0];
  if (Array.isArray(head)) {
    const [lat, lng] = head as [number, number];
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }
  if (head && typeof head === 'object' && 'lat' in (head as object)) {
    const p = head as GeoPoint;
    return Number.isFinite(p.lat) && Number.isFinite(p.lng) ? { lat: p.lat, lng: p.lng } : null;
  }
  return null;
}

/** Read the cached coordinate for a pet. Never throws; a bad entry is ignored. */
async function readCachedCenter(petId: string): Promise<GeoPoint | null> {
  try {
    const raw = await AsyncStorage.getItem(CENTER_CACHE_PREFIX + petId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GeoPoint;
    return Number.isFinite(parsed?.lat) && Number.isFinite(parsed?.lng) ? parsed : null;
  } catch {
    return null;
  }
}

async function writeCachedCenter(petId: string, point: GeoPoint): Promise<void> {
  try {
    await AsyncStorage.setItem(CENTER_CACHE_PREFIX + petId, JSON.stringify(point));
  } catch {
    // A failed write only costs one slow launch.
  }
}

export interface HomeMapCenter {
  /** Where to aim the camera, or null when nothing is known yet. */
  center: GeoPoint | null;
  /**
   * True while we are still working out whether a coordinate exists.
   *
   * The map's caller needs this to tell "loading" from "nothing to show": a
   * skeleton promises a map is coming, so it must never be shown to a pet that
   * will never have one.
   */
  resolving: boolean;
  /** True when there is no coordinate and location could still supply one. */
  canAskLocation: boolean;
  /** Whether the prominent disclosure still has to be shown before the ask. */
  needsDisclosure: boolean;
  /** Run the disclosure acknowledgement + OS request. Safe to call once. */
  requestLocation: () => Promise<void>;
}

export function useHomeMapCenter(
  petId: string | null | undefined,
  /** Signed-in owner. Scopes the one-ask flag and the disclosure acknowledgement. */
  userId: string | null | undefined,
  enabled: boolean,
): HomeMapCenter {
  const [center, setCenter] = useState<GeoPoint | null>(null);
  const [resolving, setResolving] = useState(true);
  const [canAskLocation, setCanAskLocation] = useState(false);
  const [needsDisclosure, setNeedsDisclosure] = useState(true);
  // Guards the whole resolve pass, so a re-render can't re-run the lookup or
  // re-offer a prompt the owner already dismissed this session. Latched on the
  // account as well as the pet, so a sign-out / sign-in re-runs the pass under
  // the new owner's keys instead of reusing the previous one's decision.
  const resolvedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!WALK_TRACKING_ENABLED || !enabled || !petId) {
      setCenter(null);
      setCanAskLocation(false);
      setResolving(false);
      return;
    }
    const latch = `${userId ?? 'anon'}:${petId}`;
    if (resolvedFor.current === latch) return;
    resolvedFor.current = latch;

    let cancelled = false;
    setResolving(true);

    void (async () => {
      // ── 0. Last known answer ──
      // Paint from it immediately so the map can mount while the query runs.
      // The lookup below still runs and overwrites this if the dog has moved.
      const cached = await readCachedCenter(petId);
      if (cancelled) return;
      if (cached) setCenter(cached);

      // ── 1. The dog's own geography ──
      const { data } = await supabase
        .from('walk_sessions')
        .select('route')
        .eq('pet_id', petId)
        .not('route', 'is', null)
        .neq('validation_verdict', 'likely_vehicle')
        .order('started_at', { ascending: false })
        .limit(PLACE_LOOKUP_LIMIT);

      if (cancelled) return;

      for (const row of data ?? []) {
        const point = firstPointOf((row as { route: unknown }).route);
        if (point) {
          setCenter(point);
          setResolving(false);
          void writeCachedCenter(petId, point);
          return;
        }
      }

      // ── 2. A cached OS fix, only if already granted ──
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (status === 'granted') {
          const last = await Location.getLastKnownPositionAsync();
          if (cancelled) return;
          if (last) {
            const point = { lat: last.coords.latitude, lng: last.coords.longitude };
            setCenter(point);
            setResolving(false);
            void writeCachedCenter(petId, point);
            return;
          }
        }
      } catch {
        // No location module, or a denied read — fall through to the offer.
      }

      // ── 3. Offer the ask, at most once per account ──
      try {
        // No account, no offer: there is nobody to record the ask or the
        // disclosure against, and Home never asks an anonymous visitor.
        if (!userId) {
          if (!cancelled) setCanAskLocation(false);
          return;
        }
        const [asked, acked, perms] = await Promise.all([
          AsyncStorage.getItem(mapLocationAskedKey(userId)),
          hasAcknowledgedLocationDisclosure(userId),
          Location.getForegroundPermissionsAsync(),
        ]);
        if (cancelled) return;
        setNeedsDisclosure(!acked);
        setCanAskLocation(asked !== '1' && perms.canAskAgain && perms.status !== 'granted');
      } catch {
        if (!cancelled) setCanAskLocation(false);
      } finally {
        // Nothing left to find. Whatever the cache gave us is the final answer.
        if (!cancelled) setResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [petId, userId, enabled]);

  const requestLocation = useCallback(async () => {
    // Mark asked before prompting: a crash mid-dialog must not re-offer.
    setCanAskLocation(false);
    if (!userId) return;
    await AsyncStorage.setItem(mapLocationAskedKey(userId), '1').catch(() => {});
    await acknowledgeLocationDisclosure(userId);
    setNeedsDisclosure(false);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const last =
        (await Location.getLastKnownPositionAsync()) ??
        (await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        }));
      if (last) {
        const point = { lat: last.coords.latitude, lng: last.coords.longitude };
        setCenter(point);
        if (petId) void writeCachedCenter(petId, point);
      }
    } catch {
      // Denied, or no location module. The paper ground stays; nothing breaks.
    }
    // petId is a real dependency — it decides which pet's cache this writes to.
    // Omitting it would let a stale closure file one dog's coordinate under
    // another's key after a pet switch. userId is the same argument for the
    // ask flag and the disclosure acknowledgement.
  }, [petId, userId]);

  return { center, resolving, canAskLocation, needsDisclosure, requestLocation };
}

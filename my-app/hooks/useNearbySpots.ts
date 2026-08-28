/**
 * useNearbySpots — the Spots segment's data.
 *
 * ── On location, because this is the part that must not regress ──
 * This hook reads NO location of its own. It takes the coordinate Home already
 * resolved (`useHomeMapCenter`) as a prop. It never calls
 * `watchPositionAsync`, never `startLocationUpdatesAsync`, never
 * `stopLocationUpdatesAsync`, and never touches the `walk:active` record that
 * is the sole authority for whether a walk exists (lib/walk/walkTracker.ts).
 *
 * It reads that record exactly once per resolve pass, to decide whether to stay
 * off the network. That is a read of AsyncStorage, not of the GPS.
 *
 * ── Query discipline ──
 * Fetches happen on first entry to the segment and on an explicit Refresh or
 * Search-wider. Not on pan (Home's map is not interactive), not on focus, not
 * on every GPS update, and never during a walk. Every one of those rules lives
 * in lib/spots/fetchPolicy.ts where it can be tested.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { track } from '../lib/analytics';
import { reportError, type AppError } from '../lib/appError';
import { readActiveWalk } from '../lib/walk/walkTracker';
import type { GeoPoint } from '../lib/walk/geo';
import {
  DEFAULT_RADIUS_M,
  MAX_RADIUS_M,
  isFresh,
  type RadiusBucket,
} from '../lib/spots/cellKey';
import {
  LOCAL_TTL_MS,
  decideFetch,
  resolveCacheStatus,
  resolveStatus,
  type SpotsStatus,
} from '../lib/spots/fetchPolicy';
import {
  fetchNearbySpots,
  isInFlight,
  localCacheKey,
  readLocalCache,
} from '../lib/spots/nearbySpotsClient';
import { prepareForDisplay } from '../lib/spots/rank';
import type { PawtchiSpot, SpotCacheStatus } from '../lib/spots/types';

export interface UseNearbySpotsOptions {
  /** Feature flag AND "the Spots segment is on screen". */
  enabled: boolean;
  /** Home's resolved map centre. Null until it knows. */
  center: GeoPoint | null;
  /** Whether a location prompt is still possible, for the empty-state copy. */
  canAskLocation: boolean;
}

export interface UseNearbySpotsResult {
  spots: PawtchiSpot[];
  status: SpotsStatus;
  cacheStatus: SpotCacheStatus | null;
  radiusMeters: RadiusBucket;
  /** True once the radius is already at its maximum. */
  canExpand: boolean;
  refresh: () => void;
  expand: () => void;
}

export function useNearbySpots({
  enabled,
  center,
  canAskLocation,
}: UseNearbySpotsOptions): UseNearbySpotsResult {
  const [raw, setRaw] = useState<PawtchiSpot[] | null>(null);
  const [shownAt, setShownAt] = useState<string | null>(null);
  const [cacheStatus, setCacheStatus] = useState<SpotCacheStatus | null>(null);
  const [radius, setRadius] = useState<RadiusBucket>(DEFAULT_RADIUS_M);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * Bumped by Refresh / Search-wider to re-run the resolve pass. A counter
   * rather than a boolean so two taps in a row both take effect.
   */
  const [requestNonce, setRequestNonce] = useState(0);
  const userRequested = useRef(false);

  /** Guards against a late response from a previous cell overwriting a newer one. */
  const passId = useRef(0);

  /**
   * Which pass currently owns the spinner.
   *
   * Separate from `passId` because clearing the spinner and accepting a result
   * are different questions. A cancelled pass must NOT write its results — but
   * it absolutely must put back the spinner it raised, or the screen sits on
   * "Finding places near you" forever with nothing on the way. That was the
   * exact shape of the stuck-loader bug: tapping Refresh mid-request cancelled
   * the pass that owned the spinner, and the pass that replaced it took the
   * `in_flight` exit without ever touching `loading`.
   */
  const spinnerPass = useRef(0);

  const key = center ? localCacheKey(center.lat, center.lng, radius) : null;

  useEffect(() => {
    if (!enabled || !center || !key) return;

    const pass = ++passId.current;
    const wasUserRequested = userRequested.current;
    userRequested.current = false;
    let cancelled = false;

    void (async () => {
      // ── Paint from cache first, whatever its age ──
      // Even a stale entry is real places; showing it immediately is what makes
      // re-entering the segment feel instant.
      const cached = await readLocalCache(key);
      if (cancelled || pass !== passId.current) return;

      const cacheIsFresh = !!cached && isFresh(cached.fetchedAt, LOCAL_TTL_MS);
      if (cached) {
        setRaw(cached.spots);
        setShownAt(cached.fetchedAt);
        setCacheStatus(resolveCacheStatus('local', null, cacheIsFresh));
        setFailed(false);
      }

      // ── Decide whether to go to the network ──
      const walkActive = (await readActiveWalk()) !== null;
      if (cancelled || pass !== passId.current) return;

      const decision = decideFetch({
        enabled,
        hasCenter: true,
        walkActive,
        inFlight: isInFlight(key),
        cachedAt: cached?.fetchedAt ?? null,
        userRequested: wasUserRequested,
      });

      // `in_flight` is a reason to JOIN, not to give up. `fetchNearbySpots`
      // hands every caller for a key the same promise, so awaiting it costs no
      // extra request and is the only way this pass ever learns the answer.
      // Dropping out here instead is what left a tapped Refresh with results
      // sitting in the cache and a spinner on screen that nothing would clear.
      const shouldFetch = decision.fetch || decision.reason === 'in_flight';

      if (!shouldFetch) {
        // Nothing cached and nothing to fetch: settle to a resolved-empty state
        // rather than leaving the screen loading forever.
        if (!cached) {
          setRaw(decision.reason === 'walk_active' ? null : []);
        }
        return;
      }

      setLoading(true);
      spinnerPass.current = pass;
      try {
        const result = await fetchNearbySpots(center.lat, center.lng, radius);
        if (cancelled || pass !== passId.current) return;
        setRaw(result.spots);
        setShownAt(result.fetchedAt);
        setCacheStatus(resolveCacheStatus('network', result.cacheStatus, true));
        setFailed(false);
      } catch (err) {
        if (cancelled || pass !== passId.current) return;
        // A failed refresh over good data is a footnote, not an error screen —
        // `resolveStatus` turns this into 'stale' when spots are present.
        setFailed(true);
        reportError(err as AppError, 'generic');
        track('spots_results_failed', {
          error_type: (err as AppError)?.kind ?? 'unknown',
          search_radius_m: radius,
          walk_active: walkActive,
        });
      } finally {
        // Deliberately NOT guarded on `cancelled`. A newer pass that raised its
        // own spinner owns it now and clears it itself; anything else is ours to
        // put back, whether or not our result was still wanted.
        if (spinnerPass.current === pass) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, center, key, radius, requestNonce]);

  // Measure from the real position, drop the cell query's over-fetch, order.
  // Done here rather than server-side because the server never learns where the
  // user actually is — it only ever saw a grid cell.
  const spots = useMemo(
    () => (raw && center ? prepareForDisplay(raw, center, radius) : []),
    [raw, center, radius],
  );

  const status = resolveStatus({
    spots: raw === null ? null : spots,
    loading,
    failed,
    enabled,
    hasCenter: !!center,
    canAskLocation,
    shownAt,
  });

  const refresh = useCallback(() => {
    userRequested.current = true;
    setRequestNonce(n => n + 1);
    // Tagged so the dashboards can tell "ask again about here" from "ask about
    // somewhere I've dragged to" — the second is the one that says the map
    // became something people explore.
    track('spots_search_area_requested', {
      search_radius_m: radius,
      source_screen: 'refresh',
    });
  }, [radius]);

  const expand = useCallback(() => {
    if (radius >= MAX_RADIUS_M) return;
    userRequested.current = true;
    setRadius(MAX_RADIUS_M);
    track('spots_radius_expanded', { search_radius_m: MAX_RADIUS_M });
  }, [radius]);

  return {
    spots,
    status,
    cacheStatus,
    radiusMeters: radius,
    canExpand: radius < MAX_RADIUS_M,
    refresh,
    expand,
  };
}

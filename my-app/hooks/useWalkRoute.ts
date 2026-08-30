/**
 * useWalkRoute — the suggested walking line to a destination, and nothing more.
 *
 * ── What it is not ──
 *
 * Not navigation. There is no turn list, no voice, no arrival logic, and this
 * hook has no opinion about the walk itself: it cannot start, stop, pause or
 * influence tracking, and it reads position as a plain prop rather than
 * subscribing to anything. If it fails or never resolves, the walk is completely
 * unaffected — the same rule the Live Activity bridge follows.
 *
 * ── Being a guest ──
 *
 * Routes come from FOSSGIS's donated pedestrian OSRM instance. Every decision about
 * whether to spend a request lives in `routePolicy.ts` and is unit-tested,
 * including a hard per-walk ceiling that no sequence of wandering can exceed.
 * This file only carries out the decision.
 *
 * ── Why position is a ref and the timer exists ──
 *
 * The obvious shape — an effect keyed on `currentPosition` — is wrong, and
 * wrong in a way that would have been invisible in review: GPS delivers a new
 * position every few seconds, so the effect's cleanup would abort the in-flight
 * request on every fix. Because the first request is deliberately not gated on
 * the retry interval (there is no line yet to be off), each aborted attempt
 * would immediately qualify for another, and a walk would burn its entire
 * request budget against someone else's server in under a minute without ever
 * drawing a line.
 *
 * So the request's lifetime is tied to the DESTINATION, not to position: one
 * AbortController per destination, position read from a ref, and a slow timer
 * that asks the policy whether anything has changed. Aborting then means what it
 * should — the walk ended, or the owner is heading somewhere else.
 */

import { useEffect, useRef, useState } from 'react';
import { GeoPoint, distanceToPathM } from '../lib/walk/geo';
import { fetchWalkingRoute } from '../lib/walk/routeClient';
import { shouldFetchRoute } from '../lib/walk/routePolicy';
import {
  clearActiveRouteSession,
  ensureActiveRouteSession,
  readActiveRouteSession,
  recordActiveRoute,
  recordActiveRouteRequest,
} from '../lib/walk/activeRouteSession';

/**
 * How often to re-ask the policy. Not a request cadence — the policy's own
 * two-minute floor and per-walk cap decide that. This only has to be frequent
 * enough that a walker who has wandered off does not wait long for the line to
 * catch up.
 */
const EVALUATE_INTERVAL_MS = 10_000;

interface UseWalkRouteInput {
  /** Active-walk identity. Keeps presentation state out of the tracking store. */
  walkId?: string | null;
  /** Where the owner said they were heading. Null disables the hook entirely. */
  destination: GeoPoint | null;
  /** Latest accepted fix. Null before GPS settles. */
  currentPosition: GeoPoint | null;
  /** Home's last device-centred coordinate, used only until live GPS settles. */
  initialPosition?: GeoPoint | null;
  /**
   * False once the walk is over or the owner has arrived. A route to somewhere
   * you are already standing is noise, and one drawn after the walk ended is a
   * line to nowhere.
   */
  enabled: boolean;
}

export type WalkRouteStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface WalkRouteResult {
  route: GeoPoint[] | null;
  status: WalkRouteStatus;
}

export function useWalkRoute({
  walkId = null,
  destination,
  currentPosition,
  initialPosition = null,
  enabled,
}: UseWalkRouteInput): WalkRouteResult {
  // Coordinate identity, not object identity: callers naturally create a fresh
  // {lat,lng} object each render and that must never reset a live route.
  const destinationKey = destination ? `${destination.lat},${destination.lng}` : null;
  const restored = readActiveRouteSession(walkId, destinationKey);
  const [route, setRoute] = useState<GeoPoint[] | null>(restored?.route ?? null);
  const [status, setStatus] = useState<WalkRouteStatus>(
    restored?.route ? 'ready' : 'idle',
  );

  // Read inside the timer rather than depended on, so a new fix never tears
  // down a request that is already on its way. See the header.
  const positionRef = useRef(currentPosition ?? initialPosition);
  positionRef.current = currentPosition ?? initialPosition;

  const routeRef = useRef<GeoPoint[] | null>(route);
  routeRef.current = route;

  // Bookkeeping for the policy. Refs, not state: these must not re-enter the
  // decision that writes them.
  const fetchCount = useRef(restored?.fetchCount ?? 0);
  const lastFetchAt = useRef<number | null>(restored?.lastFetchAt ?? null);
  const inFlight = useRef(false);

  useEffect(() => {
    if (!enabled || !walkId || !destinationKey || !destination) {
      // Clear on the way out, so a finished walk never leaves a line behind for
      // the next one to inherit.
      if (!enabled && walkId) clearActiveRouteSession(walkId);
      setRoute(null);
      setStatus('idle');
      return;
    }

    // Reopening from Home restores BOTH the line and its request accounting.
    // That makes the line instant without letting remounts reset the fair-use
    // cap against the public routing server.
    const session = ensureActiveRouteSession(walkId, destinationKey);
    fetchCount.current = session.fetchCount;
    lastFetchAt.current = session.lastFetchAt;
    inFlight.current = false;
    routeRef.current = session.route;
    setRoute(session.route);
    setStatus(session.route ? 'ready' : 'loading');

    const controller = new AbortController();
    let cancelled = false;

    const evaluate = () => {
      if (cancelled) return;
      const position = positionRef.current;
      if (!position) return;

      const current = routeRef.current;
      const hasRoute = !!current && current.length > 1;
      const now = Date.now();

      const decision = shouldFetchRoute(
        {
          hasRoute,
          fetchCount: fetchCount.current,
          lastFetchAt: lastFetchAt.current,
          driftM: hasRoute ? distanceToPathM(position, current!) : null,
          inFlight: inFlight.current,
          wanted: true,
        },
        now,
      );
      if (decision === 'skip') return;

      inFlight.current = true;
      if (!hasRoute) setStatus('loading');
      const requested = recordActiveRouteRequest(walkId, destinationKey, now);
      fetchCount.current = requested.fetchCount;
      lastFetchAt.current = requested.lastFetchAt;

      fetchWalkingRoute(position, destination, controller.signal)
        .then(result => {
          // Null is ordinary — no signal, no footpath, a slow server. The
          // compass line above the map already answered the question well
          // enough to walk on, so a failure changes nothing on screen.
          if (!cancelled && result) {
            if (__DEV__) {
              console.info(`[walkRoute] drew ${result.path.length} route points`);
            }
            recordActiveRoute(walkId, destinationKey, result.path);
            routeRef.current = result.path;
            setRoute(result.path);
            setStatus('ready');
          } else if (!cancelled && __DEV__) {
            console.warn(`[walkRoute] request ${fetchCount.current} returned no route`);
            if (!routeRef.current) setStatus('unavailable');
          } else if (!cancelled && !routeRef.current) {
            setStatus('unavailable');
          }
        })
        .catch(() => {})
        .finally(() => {
          inFlight.current = false;
        });
    };

    evaluate();
    const timer = setInterval(evaluate, EVALUATE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
      controller.abort();
    };
    // Deliberately NOT `currentPosition` — that is the bug described in the
    // header. `destination` is included for the closure; `destinationKey` is
    // what actually decides identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destinationKey, enabled, walkId]);

  return { route, status };
}

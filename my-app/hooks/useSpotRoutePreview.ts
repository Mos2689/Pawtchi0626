/**
 * useSpotRoutePreview — the way to a place, drawn before any walk begins.
 *
 * ── Why this exists ──
 * "Walk here" used to be a single tap with no middle: the walk started, the
 * timer ran, and the line arrived afterwards. There was nowhere to stand and
 * think. This hook supplies the thinking state — the route on the map and a
 * real distance and duration to look at — while the owner has still committed
 * to nothing.
 *
 * ── Why not useWalkRoute ──
 * That hook is built for a walk in progress: it needs a `walkId`, it polls on a
 * ten-second evaluator, it re-routes on drift, and it books requests against a
 * per-walk ceiling. None of that applies before a walk exists, and bending it to
 * fit would put presentation state into the one place that must stay simple.
 *
 * So this is deliberately the smaller thing: ONE request per opened spot, no
 * timer, no re-route, no drift. It ends when the sheet closes.
 *
 * ── Being a guest, still ──
 * Requests go to FOSSGIS's donated pedestrian OSRM instance. Two things bound
 * the spend. Only walk-to categories reach this hook at all (spotAction.ts) —
 * nobody previews a route to a pet shop. And `fetchWalkingRoute` holds a short
 * in-memory cache, so reopening a place, or opening one already prefetched,
 * costs nothing.
 *
 * That cache is also why this composes with the walk itself: the preview
 * requests from `origin`, and `armWalkStart` hands that same coordinate to the
 * walk screen, so tapping Start joins a route that is already resolved instead
 * of asking for it again.
 *
 * ── Contract ──
 * Presentation only, and total. Every failure resolves to `status: 'unavailable'`
 * with a null route; nothing here throws and nothing can affect a walk. A place
 * with no drawable route still opens, still shows its details, and can still be
 * walked to — the compass heading and dog-paced ETA never needed the network.
 */

import { useEffect, useState } from 'react';
import type { GeoPoint } from '../lib/walk/geo';
import { fetchWalkingRoute } from '../lib/walk/routeClient';

export type SpotRoutePreviewStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

export interface SpotRoutePreview {
  /** The drawn line, or null on any rung below success. */
  route: GeoPoint[] | null;
  /** Metres along the route — the real thing, not a straight line. */
  distanceM: number | null;
  /** Seconds at OSRM's walking pace. The caller may re-pace it for the dog. */
  durationS: number | null;
  status: SpotRoutePreviewStatus;
}

const IDLE: SpotRoutePreview = {
  route: null,
  distanceM: null,
  durationS: null,
  status: 'idle',
};

export function useSpotRoutePreview(input: {
  /** Where the owner is. Null disables the hook — a route from nowhere is nothing. */
  origin: GeoPoint | null;
  /** The opened place. Null when no sheet is open, or when it is a maps handoff. */
  destination: GeoPoint | null;
}): SpotRoutePreview {
  const { origin, destination } = input;

  // Coordinate identity, not object identity: callers build a fresh {lat,lng}
  // every render, and depending on the objects would refetch on every keystroke
  // elsewhere on the screen.
  const originKey = origin ? `${origin.lat},${origin.lng}` : null;
  const destinationKey = destination ? `${destination.lat},${destination.lng}` : null;

  const [preview, setPreview] = useState<SpotRoutePreview>(IDLE);

  useEffect(() => {
    if (!originKey || !destinationKey || !origin || !destination) {
      setPreview(IDLE);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setPreview({ ...IDLE, status: 'loading' });

    void fetchWalkingRoute(origin, destination, controller.signal)
      .then(result => {
        if (cancelled) return;
        if (!result) {
          // Ordinary, not exceptional: no footpath, no signal, a slow donated
          // server. The sheet keeps its compass line and its details.
          setPreview({ ...IDLE, status: 'unavailable' });
          return;
        }
        setPreview({
          route: result.path,
          distanceM: result.distanceM,
          durationS: result.durationS,
          status: 'ready',
        });
      })
      .catch(() => {
        if (!cancelled) setPreview({ ...IDLE, status: 'unavailable' });
      });

    return () => {
      cancelled = true;
      // Closing the sheet abandons the request. The route client's cache keeps
      // any result that still lands, so reopening the same place is instant.
      controller.abort();
    };
    // `origin`/`destination` are read through their keys; including the objects
    // themselves would refetch on identity churn alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [originKey, destinationKey]);

  return preview;
}

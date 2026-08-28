/**
 * useWalkedRoutes — the dog's own traces, for asking "have we been here?"
 *
 * Deliberately NOT `useRecentWalks`. That one is the feed: seven days, every
 * column a card needs. This one is a history: a long window, two columns, and
 * it exists so a spot can say "you've walked here four times" — which needs
 * months, not a week, before it means anything.
 *
 * ── Why it is cheap enough to do at all ──
 * Routes are simplified to at most 200 points before they are ever stored
 * (lib/walk/geo.ts), and only `id` and `route` are selected. Sixty walks is a
 * few hundred kilobytes, fetched once per pet per mount and never on a timer.
 *
 * ── When it runs ──
 * Only while `enabled`, which the caller ties to the Spots segment actually
 * being on screen. Someone who never opens Spots never pays for this, and
 * switching segments back and forth does not re-fetch: the latch is on the pet,
 * not on the render.
 *
 * It reads no location and touches nothing to do with tracking — it is a plain
 * query against rows that already exist.
 */

import { useEffect, useRef, useState } from 'react';

import { supabase } from '../lib/supabase';
import { WALK_TRACKING_ENABLED } from '../constants/features';
import { parseRoutePoints } from '../lib/walk/routeJson';
import type { GeoPoint } from '../lib/walk/geo';

/**
 * How far back to look, in walks rather than in days.
 *
 * A count, because that is what bounds the cost. Sixty is roughly two months
 * for a daily walker and a couple of years for an occasional one — in both
 * cases enough history for "we come here often" to be a true statement, and in
 * neither case a query worth worrying about.
 */
const HISTORY_LIMIT = 60;

export function useWalkedRoutes(
  petId: string | null | undefined,
  enabled: boolean,
): GeoPoint[][] {
  const [routes, setRoutes] = useState<GeoPoint[][]>([]);
  /** Latched on the pet so re-entering the segment costs nothing. */
  const fetchedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!WALK_TRACKING_ENABLED || !enabled || !petId) return;
    if (fetchedFor.current === petId) return;
    fetchedFor.current = petId;

    let cancelled = false;

    void (async () => {
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, route')
        .eq('pet_id', petId)
        .not('route', 'is', null)
        // A car ride is not somewhere the dog walked, and counting one would
        // put "you've been here" on every shop along a motorway.
        .neq('validation_verdict', 'likely_vehicle')
        .order('started_at', { ascending: false })
        .limit(HISTORY_LIMIT);

      if (cancelled) return;
      if (error) {
        // Silent on purpose. This decorates a place with a nice-to-know; a
        // failure means the badge does not appear, which is indistinguishable
        // from never having been there and not worth an error state.
        fetchedFor.current = null;
        return;
      }

      const parsed = (data ?? [])
        .map(row => parseRoutePoints((row as { route: unknown }).route))
        .filter(points => points.length > 0);

      setRoutes(parsed);
    })();

    return () => {
      cancelled = true;
    };
  }, [petId, enabled]);

  // A pet switch must not leave the previous dog's history on screen — that
  // would attribute one dog's walks to another.
  useEffect(() => {
    if (fetchedFor.current && fetchedFor.current !== petId) setRoutes([]);
  }, [petId]);

  return routes;
}

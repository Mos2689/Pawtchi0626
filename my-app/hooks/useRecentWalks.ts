/**
 * useRecentWalks — fetches recent tracked walks for the active pet.
 *
 * `days` is the trailing window measured in local calendar days: 1 = just
 * today (the original useTodayWalks behavior), 7 = today plus the previous
 * six, and so on. "Today" is the calendar day in the phone's local timezone
 * (matches every other daily read in the app via lib/dateUtils.getLocalYMD).
 * Every real walk is a post — short outings and patchy-GPS ambles included;
 * only a discarded car ride (validation_verdict='likely_vehicle') stays out
 * of the feed.
 *
 * Refetches on focus and after a walk finishes (the Home screen already
 * calls invalidateContext on completion; this hook piggybacks on a matching
 * version bump so no extra plumbing is needed).
 *
 * The feed is cached per pet and painted before the query runs, for the same
 * reason hooks/useHomeMapCenter.ts caches its coordinate: this hook is what
 * Home is made of. The rail cards, the map pins, the drawn route, today's
 * totals and the story ring all derive from it, so an empty first frame here
 * empties the entire screen — and, worse, rendered the "no walks yet" card to
 * owners with months of history for the length of a round trip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getLocalYMD } from '../lib/dateUtils';
import type { GeoPoint } from '../lib/walk/geo';
import { WALK_TRACKING_ENABLED } from '../constants/features';
import { parseWalkStoryWeather } from '../lib/walkStorySnapshot';
import type { WalkWeather } from '../lib/walkStory';

export interface RecentWalk {
  id: string;
  started_at: string;
  duration_s: number;
  /** GPS moving time — the kcal basis; duration_s is elapsed, for display. */
  moving_time_s: number;
  distance_m: number;
  route: GeoPoint[] | null;
  /** Session pause coordinates — legacy fallback for the card loops. */
  pause_points: GeoPoint[];
  /** Sniff episodes ({lat,lng,dwellS}); null on rows predating the detector.
   *  Cards resolve via resolveSniffStops (episodes first, pauses fallback). */
  sniff_points: unknown[] | null;
  avg_speed_kmh: number | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
  weather: WalkWeather | null;
}

/** route/pause_points JSONB may be [[lat,lng], ...] or [{lat, lng}, ...]. */
function parseGeoPoints(raw: unknown): GeoPoint[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  if (Array.isArray(raw[0])) {
    return (raw as [number, number][]).map(([lat, lng]) => ({ lat, lng }));
  }
  if (raw[0] && typeof raw[0] === 'object' && 'lat' in (raw[0] as object)) {
    return raw as GeoPoint[];
  }
  return null;
}

/** Local-midnight start of the day `daysBack` days before today. */
function startOfDayNDaysAgo(daysBack: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d;
}

/**
 * The last feed we delivered, per pet and per window.
 *
 * Keyed on the window as well as the pet because `days` changes what the answer
 * means — a one-day feed served from a seven-day cache would show walks that
 * are not in the range the caller asked for.
 */
const FEED_CACHE_PREFIX = 'home:recent_walks:';

/**
 * How many walks to keep.
 *
 * Routes are point arrays and AsyncStorage is a key-value store, not a
 * database: an uncapped week of dense GPS traces is a payload big enough to
 * make the read cost more than the query it was meant to pre-empt. Twenty is
 * far more than the rail shows before someone reaches for the gallery.
 */
const CACHE_MAX_WALKS = 20;

/** Normalises the window the same way the query does, so a read and a write of
 *  the same request can never land on two different keys. */
function feedCacheKey(petId: string, days: number): string {
  return `${FEED_CACHE_PREFIX}${petId}:${Math.max(1, Math.floor(days))}`;
}

/**
 * Read the cached feed. Never throws; a malformed entry is treated as a miss.
 *
 * The window is a rolling one, so a cache written yesterday can hold walks that
 * have since fallen out of it. Re-trimmed on read rather than trusted, which is
 * also what keeps a stale entry from resurrecting a walk into "today".
 */
async function readCachedWalks(petId: string, days: number): Promise<RecentWalk[] | null> {
  try {
    const raw = await AsyncStorage.getItem(feedCacheKey(petId, days));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const cutoffYmd = getLocalYMD(startOfDayNDaysAgo(Math.max(1, Math.floor(days)) - 1));
    const fresh = (parsed as RecentWalk[]).filter(
      w =>
        w &&
        typeof w.started_at === 'string' &&
        getLocalYMD(new Date(w.started_at)) >= cutoffYmd,
    );
    return fresh.length > 0 ? fresh : null;
  } catch {
    return null;
  }
}

async function writeCachedWalks(
  petId: string,
  days: number,
  walks: RecentWalk[],
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      feedCacheKey(petId, days),
      JSON.stringify(walks.slice(0, CACHE_MAX_WALKS)),
    );
  } catch {
    // A failed write only costs one slow launch.
  }
}

export function useRecentWalks(
  petId: string | null | undefined,
  days: number = 1,
) {
  const [walks, setWalks] = useState<RecentWalk[]>([]);
  // Starts true whenever there is anything to fetch. The first frame of a cold
  // start is not a resolved empty feed, and callers render a very different
  // (and much more damaging) card if they are told that it is.
  const [loading, setLoading] = useState<boolean>(WALK_TRACKING_ENABLED && !!petId);

  /**
   * Whether the network has answered for the CURRENT pet and window.
   *
   * The disk read races the query, and on a warm connection the query can win.
   * Without this, a slow read would repaint yesterday's list over a live
   * answer — including over a live answer of "none", which is exactly the case
   * where showing walks would be a lie rather than a head start.
   */
  const answered = useRef(false);

  const fetchWalks = useCallback(async () => {
    if (!WALK_TRACKING_ENABLED || !petId) {
      setWalks([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rangeDays = Math.max(1, Math.floor(days));
      const startIso = startOfDayNDaysAgo(rangeDays - 1).toISOString();
      // Every real walk is a post — short outings and patchy-GPS ambles
      // included. Only vehicle rides stay out of the feed.
      const { data, error } = await supabase
        .from('walk_sessions')
        .select('id, started_at, duration_s, moving_time_s, distance_m, route, pause_points, sniff_points, avg_speed_kmh, validation_verdict, start_label, end_label, farthest_label, weather')
        .eq('pet_id', petId)
        .neq('validation_verdict', 'likely_vehicle')
        .gte('started_at', startIso)
        .order('started_at', { ascending: false });

      if (error) {
        // Deliberately does NOT clear the feed. Whatever is on screen came from
        // the last successful answer, and a failed revalidation is not evidence
        // that those walks stopped existing — blanking the rail on a dropped
        // connection would throw away the only useful thing we have.
        console.error('[useRecentWalks] fetch error', error);
        return;
      }

      // Server-side range filter is timestamp-based; belt-and-braces trim to
      // the phone's local calendar day window so a walk that started at
      // 23:59 UTC just outside the window doesn't surface.
      const cutoffYmd = getLocalYMD(startOfDayNDaysAgo(rangeDays - 1));
      const filtered = (data ?? []).filter(
        (w) => getLocalYMD(new Date(w.started_at)) >= cutoffYmd,
      );

      const parsed: RecentWalk[] = filtered.map(row => {
        // route/pause_points are JSONB — normalize both to GeoPoint[]. Missing
        // pause_points (older rows, NULL column) degrades to a loop-less card.
        const route = parseGeoPoints(row.route as unknown);
        return {
          id: row.id as string,
          started_at: row.started_at as string,
          duration_s: row.duration_s as number,
          moving_time_s: (row.moving_time_s as number) ?? 0,
          distance_m: Number(row.distance_m),
          avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
          route,
          pause_points: parseGeoPoints(row.pause_points as unknown) ?? [],
          sniff_points: Array.isArray(row.sniff_points) ? (row.sniff_points as unknown[]) : null,
          start_label: (row.start_label as string | null) ?? null,
          end_label: (row.end_label as string | null) ?? null,
          farthest_label: (row.farthest_label as string | null) ?? null,
          weather: parseWalkStoryWeather(row.weather),
        };
      });

      setWalks(parsed);
      answered.current = true;
      void writeCachedWalks(petId, rangeDays, parsed);
    } catch (e) {
      console.error('[useRecentWalks] unexpected', e);
    } finally {
      setLoading(false);
    }
  }, [petId, days]);

  /**
   * Paint the last delivered feed, then let the query above correct it.
   *
   * Runs on the pet rather than on focus: this is the cold-start head start,
   * not a refresh, and re-reading the disk every time Home regains focus would
   * be work behind content that is already live.
   */
  useEffect(() => {
    answered.current = false;

    if (!WALK_TRACKING_ENABLED || !petId) {
      setWalks([]);
      setLoading(false);
      return;
    }

    // One dog's walks must never linger while another's load — the rail would
    // be captioned with the wrong name and the map drawn on the wrong streets.
    setWalks([]);
    setLoading(true);

    let cancelled = false;
    void (async () => {
      const cached = await readCachedWalks(petId, days);
      if (cancelled || answered.current || !cached) return;
      setWalks(cached);
    })();

    return () => {
      cancelled = true;
    };
  }, [petId, days]);

  useFocusEffect(
    useCallback(() => {
      fetchWalks();
    }, [fetchWalks]),
  );

  return { walks, loading, refetch: fetchWalks };
}

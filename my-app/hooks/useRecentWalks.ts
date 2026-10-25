/**
 * useRecentWalks — the active pet's walks for Home, newest first, in pages.
 *
 * The first page is the newest WALK_PAGE_SIZE walks of any date; `loadMore`
 * appends the page before them, all the way back. There is no date window:
 * every walk is a card, built and drawn the same way however old it is. See
 * lib/home/walkFeed.ts for why the 7-day window (and the 1.0.27 fallback) went.
 *
 * Every real walk is a post — short outings and patchy-GPS ambles included;
 * only a discarded car ride (validation_verdict='likely_vehicle') stays out
 * of the feed.
 *
 * Refetches when something has actually changed, not on every focus. The
 * signal it watches is `usePetContextStore.dataVersion`, which
 * `invalidateContext` bumps from every mutation path — including
 * `fireCompletionSideEffects`, which runs at step 3 of lib/walk/walkSync.ts,
 * AFTER the `walk_sessions` upsert at step 1. So a finished walk still lands
 * immediately. A refresh replaces the feed with the newest page (paging starts
 * again), which is what puts that walk first.
 *
 * A max-age fallback backs that up, because one field arrives late: `weather` is
 * written to the row in a fire-and-forget update after the bump. Without the
 * fallback a walk fetched in that gap would keep a null weather for the rest of
 * the session, and its Walk Story would silently lose the conditions card.
 *
 * The first page is cached per pet and painted before the query runs, for the
 * same reason hooks/useHomeMapCenter.ts caches its coordinate: this hook is what
 * Home is made of. The rail cards, the map pins, the drawn route, today's
 * totals and the story ring all derive from it, so an empty first frame here
 * empties the entire screen — and rendered the "no walks yet" card to owners
 * with months of history for the length of a round trip.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { getLocalYMD } from '../lib/dateUtils';
import { withTimeout } from '../lib/withTimeout';
import type { GeoPoint } from '../lib/walk/geo';
import { WALK_TRACKING_ENABLED } from '../constants/features';
import { parseWalkStoryWeather } from '../lib/walkStorySnapshot';
import type { WalkWeather } from '../lib/walkStory';
import { usePetContextStore } from '../store/usePetContextStore';
import { homeMark } from '../lib/perf/homeTrace';
import {
  WALK_PAGE_SIZE,
  hasMorePages,
  mergeWalkPages,
  nextPageCursor,
  type WalkFeedStatus,
} from '../lib/home/walkFeed';

const WALK_COLUMNS =
  'id, started_at, duration_s, moving_time_s, distance_m, route, pause_points, sniff_points, avg_speed_kmh, validation_verdict, start_label, end_label, farthest_label, weather';

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

function toRecentWalk(row: Record<string, unknown>): RecentWalk {
  // route/pause_points are JSONB — normalize both to GeoPoint[]. Missing
  // pause_points (older rows, NULL column) degrades to a loop-less card.
  return {
    id: row.id as string,
    started_at: row.started_at as string,
    duration_s: row.duration_s as number,
    moving_time_s: (row.moving_time_s as number) ?? 0,
    distance_m: Number(row.distance_m),
    avg_speed_kmh: row.avg_speed_kmh != null ? Number(row.avg_speed_kmh) : null,
    route: parseGeoPoints(row.route),
    pause_points: parseGeoPoints(row.pause_points) ?? [],
    sniff_points: Array.isArray(row.sniff_points) ? (row.sniff_points as unknown[]) : null,
    start_label: (row.start_label as string | null) ?? null,
    end_label: (row.end_label as string | null) ?? null,
    farthest_label: (row.farthest_label as string | null) ?? null,
    weather: parseWalkStoryWeather(row.weather),
  };
}

/**
 * One page of walks, newest first: the newest of all when `before` is null,
 * otherwise those that started strictly before it. Served by
 * idx_walk_sessions_pet_started (pet_id, started_at DESC).
 */
async function fetchWalkPage(petId: string, before: string | null, label: string) {
  let query = supabase
    .from('walk_sessions')
    .select(WALK_COLUMNS)
    .eq('pet_id', petId)
    .neq('validation_verdict', 'likely_vehicle');
  if (before) query = query.lt('started_at', before);
  return withTimeout(
    query
      .order('started_at', { ascending: false })
      .limit(WALK_PAGE_SIZE)
      .then(r => r),
    FEED_TIMEOUT_MS,
    label,
  );
}

/**
 * The first page, cached per pet. Same key the 1.0.27 fallback wrote, so a
 * phone updating from that build opens on what it already had.
 */
const FEED_CACHE_PREFIX = 'home:recent_walks:';

/**
 * Ceiling on each page query.
 *
 * `lib/supabase.ts` sets no global fetch timeout, so a stalled connection leaves
 * this promise pending forever — and with it `loading`, which is what the rail
 * reads to decide between "opening the logbook" and "no walks yet". A breathing
 * card that never resolves is the worst of the three states.
 */
const FEED_TIMEOUT_MS = 12_000;

/**
 * How long a delivered feed is trusted without a change signal.
 *
 * Only reached when nothing has been logged, completed or regenerated — so it is
 * a backstop for late server-side enrichment rather than the normal path.
 */
const FEED_MAX_AGE_MS = 5 * 60 * 1000;

function feedCacheKey(petId: string): string {
  return `${FEED_CACHE_PREFIX}${petId}:latest`;
}

/** Read the cached first page. Never throws; a malformed entry is a miss. */
async function readCachedWalks(petId: string): Promise<RecentWalk[] | null> {
  try {
    const raw = await AsyncStorage.getItem(feedCacheKey(petId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const walks = (parsed as RecentWalk[]).filter(w => w && typeof w.started_at === 'string');
    return walks.length > 0 ? walks : null;
  } catch {
    return null;
  }
}

async function writeCachedWalks(petId: string, walks: RecentWalk[]): Promise<void> {
  try {
    await AsyncStorage.setItem(feedCacheKey(petId), JSON.stringify(walks.slice(0, WALK_PAGE_SIZE)));
  } catch {
    // A failed write only costs one slow launch.
  }
}

/**
 * What the feed in state is an answer TO: which pet, which day, and how many
 * logged-data changes ago. Any of them moving means the answer may have moved
 * with it; none of them moving means asking again would return the same rows.
 */
function feedSignature(petId: string, dataVersion: number): string {
  return `${petId}:${getLocalYMD(new Date())}:${dataVersion}`;
}

export function useRecentWalks(petId: string | null | undefined) {
  const [walks, setWalks] = useState<RecentWalk[]>([]);
  // Starts true whenever there is anything to fetch. The first frame of a cold
  // start is not a resolved empty feed, and callers render a very different
  // (and much more damaging) card if they are told that it is.
  const [loading, setLoading] = useState<boolean>(WALK_TRACKING_ENABLED && !!petId);
  /**
   * How the first page's last load ended. Only `ready` may let the rail say
   * "No walks yet"; `error` with nothing on screen is a retry card.
   */
  const [status, setStatus] = useState<WalkFeedStatus>('idle');
  /** Whether there may be walks before the oldest one held. */
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** The last "Show more" failed; the card offers to try again. */
  const [moreFailed, setMoreFailed] = useState(false);

  /** The walks in state, readable from inside a request without re-creating it. */
  const walksRef = useRef<RecentWalk[]>([]);
  walksRef.current = walks;
  const loadingMoreRef = useRef(false);

  /**
   * Whether the network has answered for the CURRENT pet.
   *
   * The disk read races the query, and on a warm connection the query can win.
   * Without this, a slow read would repaint yesterday's list over a live
   * answer — including over a live answer of "none", which is exactly the case
   * where showing walks would be a lie rather than a head start.
   */
  const answered = useRef(false);

  /** The feed in state as a signature; compared on focus. */
  const deliveredKey = useRef<string | null>(null);
  const deliveredAt = useRef(0);

  /**
   * Which request owns the answer.
   *
   * Two first-page passes can be in flight at once — a focus refetch that is
   * still going when a walk completes and forces another — and the slower one
   * must not win. A "Show more" in flight when a first page lands is dropped
   * too: it was paging a list that no longer exists.
   */
  const passId = useRef(0);

  /** The pet the screen is on RIGHT NOW, readable from inside a live request. */
  const petIdRef = useRef(petId);
  petIdRef.current = petId;

  const fetchWalks = useCallback(async () => {
    if (!WALK_TRACKING_ENABLED || !petId) {
      setWalks([]);
      setLoading(false);
      return;
    }
    const pass = ++passId.current;
    const forPet = petId;
    // Captured at the START of the request, not at its answer. A walk that
    // completes while this is in flight bumps the version, and recording the
    // post-bump number would mark data that predates it as already covering it.
    const forKey = feedSignature(forPet, usePetContextStore.getState().dataVersion);
    setLoading(true);
    try {
      const { data, error } = await fetchWalkPage(forPet, null, 'useRecentWalks');

      // A late answer for a pet we have moved on from, or one a newer pass has
      // already superseded, is discarded rather than rendered. The pet is
      // checked in its own right because a switch made while Home is BLURRED
      // never re-runs the focus effect, so `passId` alone would not have moved.
      if (pass !== passId.current || forPet !== petIdRef.current) return;

      if (error) {
        // Deliberately does NOT clear the feed. Whatever is on screen came from
        // the last successful answer, and a failed revalidation is not evidence
        // that those walks stopped existing.
        console.error('[useRecentWalks] fetch error', error);
        setStatus('error');
        return;
      }

      const rows = (data ?? []) as Record<string, unknown>[];
      const parsed = rows.map(toRecentWalk);
      setWalks(parsed);
      setHasMore(hasMorePages(rows.length));
      setMoreFailed(false);
      setStatus('ready');
      answered.current = true;
      // Recorded on success only. A failed or timed-out pass must leave the
      // signature stale so the next focus tries again.
      deliveredKey.current = forKey;
      deliveredAt.current = Date.now();
      homeMark('walks_resolved');
      void writeCachedWalks(forPet, parsed);
    } catch (e) {
      // A timeout lands here too, and is treated exactly like an error: whatever
      // is on screen stays, and `loading` clears so the rail stops promising
      // cards that are not coming.
      console.error('[useRecentWalks] unexpected', e);
      if (pass === passId.current) setStatus('error');
    } finally {
      if (pass === passId.current) setLoading(false);
    }
  }, [petId]);

  /**
   * The page before the oldest walk held. Ignored while one is in flight, and
   * dropped if a fresh first page lands meanwhile.
   */
  const loadMore = useCallback(async () => {
    if (!WALK_TRACKING_ENABLED || !petId || loadingMoreRef.current) return;
    const cursor = nextPageCursor(walksRef.current);
    if (!cursor) return;
    const pass = passId.current;
    const forPet = petId;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const { data, error } = await fetchWalkPage(forPet, cursor, 'useRecentWalks.more');
      if (pass !== passId.current || forPet !== petIdRef.current) return;
      if (error) {
        console.error('[useRecentWalks] more error', error);
        setMoreFailed(true);
        return;
      }
      const rows = (data ?? []) as Record<string, unknown>[];
      setWalks(current => mergeWalkPages(current, rows.map(toRecentWalk)));
      setHasMore(hasMorePages(rows.length));
    } catch (e) {
      console.error('[useRecentWalks] more unexpected', e);
      if (pass === passId.current) setMoreFailed(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [petId]);

  /**
   * Paint the last delivered first page, then let the query above correct it.
   *
   * Runs on the pet rather than on focus: this is the cold-start head start,
   * not a refresh, and re-reading the disk every time Home regains focus would
   * be work behind content that is already live.
   */
  useEffect(() => {
    answered.current = false;
    // A different pet is a different feed; nothing already delivered covers it.
    deliveredKey.current = null;
    deliveredAt.current = 0;
    setStatus('idle');
    setHasMore(false);
    setMoreFailed(false);

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
      const cached = await readCachedWalks(petId);
      if (cancelled || answered.current || !cached) return;
      setWalks(cached);
      homeMark('walks_cached');
    })();

    return () => {
      cancelled = true;
    };
  }, [petId]);

  /**
   * Bumped by every mutation path in the app via `invalidateContext`. Subscribed
   * rather than read on demand so a walk finishing while Home is already focused
   * refreshes the rail without waiting for the next focus.
   */
  const dataVersion = usePetContextStore(s => s.dataVersion);

  useFocusEffect(
    useCallback(() => {
      if (!WALK_TRACKING_ENABLED || !petId) return;
      const key = feedSignature(petId, dataVersion);
      const fresh =
        deliveredKey.current === key && Date.now() - deliveredAt.current < FEED_MAX_AGE_MS;
      if (fresh) return;
      fetchWalks();
    }, [fetchWalks, petId, dataVersion]),
  );

  return {
    walks,
    loading,
    status,
    hasMore,
    loadingMore,
    moreFailed,
    loadMore,
    refetch: fetchWalks,
  };
}

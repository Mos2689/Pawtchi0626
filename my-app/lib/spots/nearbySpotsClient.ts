/**
 * nearbySpotsClient — the I/O half of Spots.
 *
 * Everything decision-shaped lives in fetchPolicy.ts; this file only performs
 * what has already been decided. That split is why the rules are testable at
 * all under a ts-jest suite that cannot mount React or reach a network.
 *
 * Three jobs:
 *   1. Read/write the device cache (AsyncStorage, keyed by cell + radius +
 *      query version).
 *   2. Call the endpoint, bounded by a timeout.
 *   3. Coalesce concurrent callers so a re-render storm produces one request.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '../supabase';
import { withTimeout } from '../withTimeout';
import { extractInvokeErrorCode, toAppError, type AppError } from '../appError';
import { SPOT_QUERY_VERSION } from './osmTags';
import { cellKey, radiusBucketFor, spotCacheKey } from './cellKey';
import type { NearbySpotsResult, PawtchiSpot, SpotCacheStatus } from './types';

/**
 * Client-side ceiling. Above the endpoint's own 28 s upstream bound so a slow
 * -but-working Overpass fetch is allowed to finish rather than being abandoned
 * a second before it would have populated the shared cache for everyone else.
 */
const REQUEST_TIMEOUT_MS = 32_000;

/** What we persist per cell. Mirrors the endpoint's response minus the status. */
interface CachedEntry {
  spots: PawtchiSpot[];
  fetchedAt: string;
}

/** The storage key for a coordinate + radius. Never contains a raw position. */
export function localCacheKey(lat: number, lng: number, radius: number): string {
  return spotCacheKey(cellKey(lat, lng), radiusBucketFor(radius), SPOT_QUERY_VERSION);
}

export async function readLocalCache(key: string): Promise<CachedEntry | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedEntry;
    // A truncated or hand-edited entry must not crash the screen; treat any
    // shape we don't recognise as a cache miss.
    if (!Array.isArray(parsed?.spots) || typeof parsed?.fetchedAt !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeLocalCache(key: string, entry: CachedEntry): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // A failed write costs one extra request next time. Not worth surfacing.
  }
}

/**
 * In-flight requests, keyed the same way as the cache.
 *
 * Coalescing rather than debouncing: two callers asking for the same cell get
 * the SAME promise, so neither waits longer than it would have and only one
 * request leaves the device. The entry is cleared in `finally`, so a failure
 * never wedges the key permanently.
 */
const inFlight = new Map<string, Promise<NearbySpotsResult>>();

export function isInFlight(key: string): boolean {
  return inFlight.has(key);
}

/**
 * Ask the endpoint. Throws an AppError on failure — the caller decides whether
 * to fall back to stale data, because only it knows whether it has any.
 */
async function requestFromServer(
  lat: number,
  lng: number,
  radius: number,
): Promise<NearbySpotsResult> {
  const { data, error } = await withTimeout(
    supabase.functions.invoke('nearby-spots', {
      // The cell quantization happens server-side too — a client is not a
      // trustworthy source of its own constraints — but sending the raw
      // position would still put it in a request log for no benefit.
      body: { lat, lng, radius: radiusBucketFor(radius) },
    }),
    REQUEST_TIMEOUT_MS,
    'nearby-spots',
  );

  if (error) {
    // Read the `error_code` out of the non-2xx body before classifying.
    //
    // Without this the only thing a FunctionsHttpError carries is "returned a
    // non-2xx status code", which sniffs to nothing and defaults to `server` —
    // so a rate-limit, a dead upstream and a genuine bug all reported
    // identically, and the endpoint's careful error taxonomy was thrown away at
    // the last step. Every other invoke call site in the app already does this.
    throw toAppError(error, { errorCode: await extractInvokeErrorCode(error) });
  }

  const body = data as
    | { success?: boolean; spots?: PawtchiSpot[]; cacheStatus?: SpotCacheStatus; fetchedAt?: string }
    | null;

  if (!body?.success || !Array.isArray(body.spots)) {
    throw toAppError(new Error('nearby-spots returned an unusable body'));
  }

  return {
    spots: body.spots,
    cacheStatus: body.cacheStatus ?? 'upstream_fetch',
    radiusMeters: radiusBucketFor(radius),
    fetchedAt: body.fetchedAt ?? new Date().toISOString(),
  };
}

/**
 * Fetch for a coordinate, writing through to the device cache on success.
 *
 * Concurrent calls for the same cell share one request. The cache write happens
 * before the promise resolves, so a caller that immediately re-reads the cache
 * sees the fresh entry rather than racing it.
 */
export function fetchNearbySpots(
  lat: number,
  lng: number,
  radius: number,
): Promise<NearbySpotsResult> {
  const key = localCacheKey(lat, lng, radius);
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = (async () => {
    try {
      const result = await requestFromServer(lat, lng, radius);
      await writeLocalCache(key, { spots: result.spots, fetchedAt: result.fetchedAt });
      return result;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

export type { AppError, CachedEntry };

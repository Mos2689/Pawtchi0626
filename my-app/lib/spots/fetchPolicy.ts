/**
 * fetchPolicy — when Spots is allowed to hit the network, and what to show.
 *
 * Extracted from the hook because these are the rules that matter and a rule
 * buried in a `useEffect` is a rule nobody can test. The hook does I/O; this
 * file decides.
 *
 * Two of these rules are load-bearing for reasons beyond tidiness:
 *
 *   • **Never fetch during a walk.** Not because it would break tracking — it
 *     cannot; Spots never touches the location task (see walkTracker.ts) — but
 *     because a walk is the one time the phone is in a pocket, the screen is
 *     off, and the radio should be left alone. Battery during a walk is the
 *     feature's whole reliability story.
 *   • **Never fetch on a fresh cache.** Reopening the tab must not cost an
 *     upstream request. This is the rule that keeps Pawtchi within Overpass's
 *     usage policy as the user base grows.
 */

import { isFresh } from './cellKey';
import type { PawtchiSpot, SpotCacheStatus } from './types';

/** Device-side TTL. Shorter than the server's 72 h — cheap to revalidate. */
export const LOCAL_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * What the screen is doing. `stale` is deliberately distinct from `ready`: the
 * user is looking at real results, but we owe them a quiet note saying so.
 */
export type SpotsStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'stale'
  | 'error'
  | 'needs_location';

export interface FetchDecisionInput {
  /** The feature flag plus "the Spots segment is actually showing". */
  enabled: boolean;
  /** Null until Home has resolved somewhere to point the map. */
  hasCenter: boolean;
  /** A tracked walk is in progress. */
  walkActive: boolean;
  /** A request for this exact key is already in flight. */
  inFlight: boolean;
  /** fetchedAt of whatever the local cache holds for this key, if anything. */
  cachedAt: string | null;
  /** The user pressed Refresh or Search wider. Overrides the freshness gate. */
  userRequested: boolean;
  now?: number;
}

export type FetchDecision =
  | { fetch: true; reason: 'cold' | 'stale' | 'user' }
  | {
      fetch: false;
      reason: 'disabled' | 'no_center' | 'walk_active' | 'in_flight' | 'fresh';
    };

/**
 * The single place that answers "may we call the endpoint right now?".
 *
 * Order matters. The hard blocks come first so that a user-initiated refresh
 * can override *freshness* — the one gate that exists for politeness rather
 * than correctness — without being able to override the walk guard.
 */
export function decideFetch(input: FetchDecisionInput): FetchDecision {
  const { enabled, hasCenter, walkActive, inFlight, cachedAt, userRequested } = input;
  const now = input.now ?? Date.now();

  if (!enabled) return { fetch: false, reason: 'disabled' };
  if (!hasCenter) return { fetch: false, reason: 'no_center' };
  // Deliberately above `userRequested`: tapping Refresh mid-walk must not wake
  // the radio either. Cached spots still render; only the network is held.
  if (walkActive) return { fetch: false, reason: 'walk_active' };
  // Coalescing, not debouncing. Two effects racing on the same key produce one
  // request, so a re-render storm cannot multiply upstream load.
  if (inFlight) return { fetch: false, reason: 'in_flight' };

  if (userRequested) return { fetch: true, reason: 'user' };
  if (!cachedAt) return { fetch: true, reason: 'cold' };
  if (isFresh(cachedAt, LOCAL_TTL_MS, now)) return { fetch: false, reason: 'fresh' };
  return { fetch: true, reason: 'stale' };
}

export interface StatusInput {
  spots: PawtchiSpot[] | null;
  loading: boolean;
  failed: boolean;
  enabled: boolean;
  hasCenter: boolean;
  canAskLocation: boolean;
  /** fetchedAt of what is currently on screen. */
  shownAt: string | null;
  now?: number;
}

/**
 * What the screen should render.
 *
 * The ordering encodes one principle: **data beats state**. If we have spots to
 * show, we show them — a failed refresh over a good cache is a footnote, not an
 * error screen. Only a failure with nothing behind it earns `error`.
 */
export function resolveStatus(input: StatusInput): SpotsStatus {
  const { spots, loading, failed, enabled, hasCenter, canAskLocation, shownAt } = input;
  const now = input.now ?? Date.now();

  if (!enabled) return 'idle';

  const hasData = spots !== null && spots.length > 0;

  // Real results outrank everything below, including an in-flight revalidation:
  // swapping good data for a spinner on every focus is how a cached screen
  // ends up feeling slower than an uncached one.
  if (hasData) {
    if (failed) return 'stale';
    if (shownAt && !isFresh(shownAt, LOCAL_TTL_MS, now)) return 'stale';
    return 'ready';
  }

  if (loading) return 'loading';
  if (failed) return 'error';

  // No coordinate and a prompt is still possible — ask, rather than claiming
  // the area is empty. Getting these two the wrong way round would tell someone
  // there are no parks near them when we simply never knew where they were.
  if (!hasCenter) return canAskLocation ? 'needs_location' : 'idle';

  // A genuine, successful, empty answer.
  return spots !== null ? 'empty' : 'idle';
}

/**
 * The `cache_status` analytics property.
 *
 * Kept honest about a subtle case: results served from a *local* cache that the
 * server had originally answered are `local_hit`, not `server_hit`. Conflating
 * them would make the device cache look useless in the dashboards, which is
 * precisely the number we need to read to know whether it is earning its place.
 */
export function resolveCacheStatus(
  source: 'local' | 'network',
  networkStatus: SpotCacheStatus | null,
  wasFresh: boolean,
): SpotCacheStatus {
  if (source === 'local') return wasFresh ? 'local_hit' : 'stale_hit';
  return networkStatus ?? 'upstream_fetch';
}

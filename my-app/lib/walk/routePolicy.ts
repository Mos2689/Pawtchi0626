/**
 * routePolicy — when Pawtchi is allowed to ask for a walking route, and when it
 * must not.
 *
 * ── Why this is its own file, and why it is pure ──
 *
 * Routes come from FOSSGIS's public pedestrian OSRM endpoint, which is donated OpenStreetMap
 * community infrastructure with a fair-use policy — not a service we pay for and
 * not one we are entitled to hammer. A dog walk is also the worst possible
 * traffic shape for a routing endpoint: an hour of wandering, off the line more
 * often than on it, because wandering is the point.
 *
 * So the decision to fetch is separated from the fetching, given real limits,
 * and unit-tested. A bug in a request loop against someone else's donated server
 * is not the kind of bug you want to discover in production.
 *
 * The limits below are deliberately conservative. A walk that never settles
 * still costs at most a handful of requests, and when the cap is reached the
 * line simply stops updating — the compass heading and ETA from
 * `wayfinding.ts` are still there, and they never needed the network at all.
 */

/** Off the line by more than this before a re-route is even considered. */
export const REROUTE_DRIFT_M = 150;

/** Never two requests closer together than this, however far off the line. */
export const REROUTE_MIN_INTERVAL_MS = 2 * 60_000;

/**
 * Hard ceiling per walk, including the first fetch.
 *
 * Six is enough for a walk that genuinely changes its mind a few times and far
 * too few to matter to the endpoint. There is no path by which a single walk
 * can exceed it — which is the property that matters when the server belongs to
 * someone else.
 */
export const MAX_ROUTE_FETCHES_PER_WALK = 6;

export interface RouteFetchState {
  /** A route is already drawn. */
  hasRoute: boolean;
  /** How many requests this walk has already made. */
  fetchCount: number;
  /** When the last request went out; null before the first. */
  lastFetchAt: number | null;
  /**
   * Distance from the walker to the nearest point on the drawn route, in
   * meters. Null when there is no route or no fix yet to measure from.
   */
  driftM: number | null;
  /** A request is in flight — never start a second. */
  inFlight: boolean;
  /** False once the walker has arrived, or if there is no destination. */
  wanted: boolean;
}

export type RouteFetchDecision = 'fetch' | 'skip';

/**
 * Should we ask for a route right now?
 *
 * The first fetch is free of the interval and drift gates — there is nothing
 * drawn yet, so there is nothing to be off. Every request after that has to earn
 * itself twice: the walker must be genuinely off the line, AND enough time must
 * have passed that a brief detour around a parked car cannot trigger it.
 */
export function shouldFetchRoute(state: RouteFetchState, now: number): RouteFetchDecision {
  if (!state.wanted) return 'skip';
  if (state.inFlight) return 'skip';
  if (state.fetchCount >= MAX_ROUTE_FETCHES_PER_WALK) return 'skip';

  // The first request is immediate. If it failed, absence of a line must not
  // turn the 10-second evaluator into a retry loop against donated
  // infrastructure; failed attempts observe the same interval floor.
  if (!state.hasRoute) {
    if (state.lastFetchAt === null) return 'fetch';
    return now - state.lastFetchAt >= REROUTE_MIN_INTERVAL_MS ? 'fetch' : 'skip';
  }

  if (state.driftM === null) return 'skip';
  if (state.driftM < REROUTE_DRIFT_M) return 'skip';
  if (state.lastFetchAt !== null && now - state.lastFetchAt < REROUTE_MIN_INTERVAL_MS) {
    return 'skip';
  }
  return 'fetch';
}

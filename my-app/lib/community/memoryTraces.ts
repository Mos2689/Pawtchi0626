/**
 * The numbers on a shared walk's memory, and which of them are honest.
 *
 * ── There is no shared distance ─────────────────────────────────────────────
 *
 * Three phones walked the same walk and measured 2.2, 2.4 and 2.5 km. None of
 * those is "the walk's distance" — they are three correct answers to three
 * slightly different questions, because the dogs did not walk in lockstep and
 * GPS is GPS. Averaging them would invent a fourth number nobody recorded.
 *
 * So the summary leads with what genuinely IS shared: how long the walk was
 * open, how many of you were on it, and how many photos came back. Distance
 * lives in the per-walker rows, where it is true of exactly one person.
 *
 * This is the same rule the live map states out loud — paths belong to phones.
 * It is worth keeping on the screen that outlives the walk.
 */

import type { CommunityWalk, WalkerTrace } from '../communityWalks';

/** A row of `community_walk_sessions`, as much of it as this needs. */
export interface TraceLink { user_id: string; walk_session_id: string }
/** A row of `walk_sessions`, as much of it as this needs. */
export interface TraceSession {
  id: string;
  route?: unknown;
  distance_m?: unknown;
  duration_s?: unknown;
  sniff_points?: unknown;
}

/**
 * One trace per person, not one per recording.
 *
 * ── The bug this exists to prevent ─────────────────────────────────────────
 *
 * `community_walk_sessions` is unique on (walk_id, user_id, walk_session_id),
 * so one person can link several personal recordings to a single community
 * walk — they stopped and restarted, or the outing outlasted a recording.
 * Production already had a walker with four. Emitting a trace per link gave
 * that walker four rows in the pack list, all with the same name and the same
 * React key, which is how it surfaced: "two children with the same key".
 *
 * Numbers are summed, because they did walk all of it. Routes are kept as
 * separate segments, because they did not walk between them — joining two
 * recordings end to end draws a straight line from where one stopped to where
 * the next began, across whatever is in between.
 */
export function mergeTraces(links: readonly TraceLink[], sessions: readonly TraceSession[]): WalkerTrace[] {
  const byId = new Map<string, TraceSession>(sessions.map(row => [row.id, row]));
  const byUser = new Map<string, WalkerTrace>();
  for (const link of links) {
    const row = byId.get(link.walk_session_id);
    if (!row) continue;
    const trace: WalkerTrace = byUser.get(link.user_id) ?? {
      userId: link.user_id,
      routes: [],
      distanceM: 0,
      durationS: 0,
      sniffs: 0,
    };
    const route = Array.isArray(row.route) ? row.route : [];
    // A recording of one point is a dot, not a line. Its numbers still land;
    // only its geometry is dropped.
    if (route.length > 1) trace.routes.push(route as { lat: number; lng: number }[]);
    trace.distanceM += Number(row.distance_m) || 0;
    trace.durationS += Number(row.duration_s) || 0;
    trace.sniffs += Array.isArray(row.sniff_points) ? row.sniff_points.length : 0;
    byUser.set(link.user_id, trace);
  }
  return [...byUser.values()];
}

/** "2.4 km", or "840 m" while it is still short enough to count in metres. */
export function distanceLabel(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** "31:04", or "1:02:11" once it runs past the hour. */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Minutes and seconds per kilometre, the way a runner reads it.
 *
 * Null rather than a number when there is not enough walk to divide: a 12 m
 * recording produces a pace in the hours, which is arithmetically correct and
 * says nothing true about how anyone was walking.
 */
export function paceLabel(meters: number, seconds: number): string | null {
  if (!Number.isFinite(meters) || !Number.isFinite(seconds)) return null;
  if (meters < 100 || seconds <= 0) return null;
  const perKm = seconds / (meters / 1000);
  const m = Math.floor(perKm / 60);
  const s = Math.round(perKm % 60);
  // 59.6 s rounds to 60, which would print 12'60".
  const carried = s === 60 ? { m: m + 1, s: 0 } : { m, s };
  if (carried.m > 99) return null;
  return `${carried.m}'${String(carried.s).padStart(2, '0')}"`;
}

/**
 * How long the walk itself was open — start to close, not anybody's recording.
 *
 * The one duration that belongs to the group rather than to a phone. Null when
 * the walk was never started or never closed, in which case the summary says
 * nothing about time rather than guessing at it.
 */
export function togetherSeconds(walk: Pick<CommunityWalk, 'started_at' | 'ended_at'>): number | null {
  if (!walk.started_at || !walk.ended_at) return null;
  const from = Date.parse(walk.started_at);
  const to = Date.parse(walk.ended_at);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const seconds = (to - from) / 1000;
  return seconds > 0 ? seconds : null;
}

/**
 * The line under the avatar stack: what is true of the whole pack.
 *
 * Deliberately never a distance. Parts that cannot be said are dropped rather
 * than defaulted — a walk with no close time reads "3 walked · 4 moments",
 * which is less than we would like and all we know.
 */
export function togetherSummary(input: {
  walkers: number;
  seconds: number | null;
  moments: number;
}): string {
  const parts: string[] = [];
  if (input.walkers > 0) {
    parts.push(input.walkers === 1 ? 'You walked' : `${input.walkers} walked`);
  }
  if (input.seconds !== null) parts.push(`${Math.round(input.seconds / 60)} min together`);
  if (input.moments > 0) parts.push(`${input.moments} ${input.moments === 1 ? 'moment' : 'moments'}`);
  return parts.join(' · ');
}

/**
 * Traces in the order the pack list shows them, longest walk first.
 *
 * Not alphabetical and not by join time: the row order is the only ranking on
 * this screen, and the interesting one is who covered the most ground. Ties
 * fall back to user id so the order cannot shuffle between renders.
 */
export function rankTraces(traces: readonly WalkerTrace[]): WalkerTrace[] {
  return [...traces].sort((a, b) =>
    b.distanceM - a.distanceM || a.userId.localeCompare(b.userId));
}

/**
 * walkSession — pure state machine for an in-progress tracked walk.
 *
 * Ingests raw GPS points (from the location engine or a crash-recovery
 * buffer) and maintains distance / moving time / pause state without touching
 * any native API, so every behavior here is unit-testable from synthetic
 * traces.
 *
 * Dog-walk specifics (vs. a human fitness tracker):
 *   - Sniff stops are the point of the walk. Stationary spells only become an
 *     auto-pause after minutes, not seconds, and never invalidate the walk.
 *   - Speeds are gated at dog-walk plausible values; a burst of vehicle-speed
 *     samples is rejected (and counted, for the validator's vehicle check)
 *     rather than inflating distance.
 *   - Auto-stop ends the walk without user action: a long stationary spell
 *     ("we're home, phone on the counter"), re-entering the start geofence
 *     after a real loop, or a hard time cap.
 *   - Stillness is judged against a LOITER ANCHOR, not just the last fix.
 *     Indoor GPS drift fabricates plausible 3–15m "moves" that would reset a
 *     naive stationary clock forever; movement only counts as going somewhere
 *     once it escapes the anchor radius, so a phone on a shelf still
 *     auto-pauses and auto-stops however much its fix wanders.
 */

import { GeoPoint, haversineMeters } from './geo';

export interface RawGpsPoint {
  lat: number;
  lng: number;
  /** Horizontal accuracy radius in meters; null = unknown. */
  accuracy: number | null;
  /** Unix ms. */
  timestamp: number;
}

export interface SessionConfig {
  /** Reject points with a worse (larger) accuracy radius. */
  maxAccuracyM: number;
  /** Reject segments implying faster-than-plausible movement. */
  maxSpeedKmh: number;
  /** Displacement below this is jitter, not movement. */
  minDisplacementM: number;
  /** One signal-gap segment credits at most this much distance. */
  maxSegmentDistanceM: number;
  /** One segment credits at most this much moving time. */
  maxSegmentTimeMs: number;
  /** Stationary this long → auto-pause (sniff-stop tolerant). */
  autoPauseAfterMs: number;
  /** Stationary this long → the walk is over. */
  autoStopStationaryMs: number;
  /** Accepted movement that never escapes this radius around the loiter
   *  anchor is drift, not progress — the stationary clock keeps running. */
  loiterRadiusM: number;
  /** The home-return stop needs the stationary clock at least this old, so a
   *  brisk lap PAST the front door is never clipped. */
  homeLingerMs: number;
  /** Re-entering this radius around the start point can end the walk… */
  homeRadiusM: number;
  /** …but only after having been at least this far from the start. */
  minExcursionM: number;
  /** …and only after this much elapsed time. */
  minDurationForHomeStopMs: number;
  /** Absolute session ceiling. */
  hardCapMs: number;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  maxAccuracyM: 30,
  maxSpeedKmh: 14,
  minDisplacementM: 3,
  maxSegmentDistanceM: 100,
  maxSegmentTimeMs: 60_000,
  autoPauseAfterMs: 4 * 60_000,
  autoStopStationaryMs: 10 * 60_000,
  loiterRadiusM: 25,
  homeLingerMs: 60_000,
  homeRadiusM: 40,
  minExcursionM: 60,
  minDurationForHomeStopMs: 5 * 60_000,
  hardCapMs: 3 * 60 * 60_000,
};

export type SessionStatus = 'active' | 'auto_paused';

export type EndReason =
  | 'auto_stationary'
  | 'auto_home'
  | 'manual'
  | 'time_cap'
  | 'recovered';

export interface WalkSessionState {
  status: SessionStatus;
  startedAt: number;
  startPoint: GeoPoint | null;
  lastAccepted: (GeoPoint & { timestamp: number }) | null;
  /** Accepted points, in order — the route. */
  path: GeoPoint[];
  distanceM: number;
  movingTimeMs: number;
  /** Farthest the walk has been from its start point. */
  maxExcursionM: number;
  /** Coordinate at which the max-excursion distance was measured. Used to
   *  label loop walks with a "turned at X" pin instead of an end pin that
   *  would sit on top of the start. */
  farthestPoint: GeoPoint | null;
  /** Start of the current stationary spell, or null while moving. */
  stationarySince: number | null;
  /** Where each auto-pause began — the sniff stops, in order. One entry per
   *  transition into 'auto_paused'; the share card draws a loop at each. */
  pausePoints: GeoPoint[];
  /** Loiter anchor: the last position the walk genuinely departed from. */
  anchorPoint: GeoPoint | null;
  /** When the anchor was planted — the stationary clock for drift loitering. */
  anchorSince: number | null;
  acceptedCount: number;
  rejectedForAccuracy: number;
  rejectedForSpeed: number;
}

export function createSession(startedAt: number): WalkSessionState {
  return {
    status: 'active',
    startedAt,
    startPoint: null,
    lastAccepted: null,
    path: [],
    distanceM: 0,
    movingTimeMs: 0,
    maxExcursionM: 0,
    farthestPoint: null,
    stationarySince: null,
    pausePoints: [],
    anchorPoint: null,
    anchorSince: null,
    acceptedCount: 0,
    rejectedForAccuracy: 0,
    rejectedForSpeed: 0,
  };
}

/** Feed one raw GPS point through the hygiene gates. Returns the next state. */
export function ingestPoint(
  state: WalkSessionState,
  point: RawGpsPoint,
  config: SessionConfig = DEFAULT_SESSION_CONFIG,
): WalkSessionState {
  // Accuracy gate — a 50m-radius fix tells us nothing at walking scale.
  if (point.accuracy !== null && point.accuracy > config.maxAccuracyM) {
    return { ...state, rejectedForAccuracy: state.rejectedForAccuracy + 1 };
  }

  const p: GeoPoint = { lat: point.lat, lng: point.lng };

  // First accepted fix anchors the session.
  if (!state.lastAccepted || !state.startPoint) {
    return {
      ...state,
      startPoint: state.startPoint ?? p,
      lastAccepted: { ...p, timestamp: point.timestamp },
      path: [...state.path, p],
      anchorPoint: p,
      anchorSince: point.timestamp,
      acceptedCount: state.acceptedCount + 1,
    };
  }

  const dtMs = point.timestamp - state.lastAccepted.timestamp;
  if (dtMs <= 0) return state; // out-of-order duplicate

  const rawDistM = haversineMeters(state.lastAccepted, p);
  const speedKmh = rawDistM / 1000 / (dtMs / 3_600_000);

  // Speed gate — vehicle-fast segments never count as walking. The rejection
  // is tallied so the validator can call the whole session a car ride.
  if (speedKmh > config.maxSpeedKmh) {
    return { ...state, rejectedForSpeed: state.rejectedForSpeed + 1 };
  }

  // Jitter floor — GPS wobble around a sniffing dog is stillness, not steps.
  // lastAccepted deliberately stays put so genuinely slow movement still
  // accumulates once it drifts past the floor. Stillness is measured from the
  // last observed movement fix, not from the first wobble that confirmed it.
  if (rawDistM < config.minDisplacementM) {
    const stationarySince = state.stationarySince ?? state.lastAccepted.timestamp;
    const pausedLongEnough =
      point.timestamp - stationarySince >= config.autoPauseAfterMs;
    // Sniff stop begins: record WHERE, exactly once per pause spell.
    const becamePaused = pausedLongEnough && state.status === 'active';
    return {
      ...state,
      stationarySince,
      status: pausedLongEnough ? 'auto_paused' : state.status,
      pausePoints: becamePaused
        ? [...state.pausePoints, { lat: state.lastAccepted.lat, lng: state.lastAccepted.lng }]
        : state.pausePoints,
    };
  }

  // Real movement. Signal gaps credit capped distance/time — a 3-minute
  // dropout shouldn't teleport the dog 400m at full credit.
  const distM = Math.min(rawDistM, config.maxSegmentDistanceM);
  const creditMs = Math.min(dtMs, config.maxSegmentTimeMs);
  const excursion = haversineMeters(state.startPoint, p);
  const isNewFarthest = excursion > state.maxExcursionM;

  // Loiter check: accepted movement that stays inside the anchor radius is
  // drift (or tight circling), not departure — the stationary clock keeps
  // running so auto-pause/auto-stop can still fire. Only escaping the radius
  // plants a new anchor and resumes a paused session.
  const withinAnchor =
    state.anchorPoint !== null &&
    state.anchorSince !== null &&
    haversineMeters(state.anchorPoint, p) <= config.loiterRadiusM;
  const stationarySince = withinAnchor
    ? (state.stationarySince ?? state.anchorSince)
    : null;
  const pausedLongEnough =
    stationarySince !== null &&
    point.timestamp - stationarySince >= config.autoPauseAfterMs;
  // Loiter-drift can also open a pause spell — same once-per-transition rule.
  const becamePaused = pausedLongEnough && state.status === 'active';

  return {
    ...state,
    status: pausedLongEnough ? 'auto_paused' : 'active',
    pausePoints: becamePaused ? [...state.pausePoints, p] : state.pausePoints,
    lastAccepted: { ...p, timestamp: point.timestamp },
    path: [...state.path, p],
    distanceM: state.distanceM + distM,
    movingTimeMs: state.movingTimeMs + creditMs,
    maxExcursionM: isNewFarthest ? excursion : state.maxExcursionM,
    farthestPoint: isNewFarthest ? p : state.farthestPoint,
    stationarySince,
    anchorPoint: withinAnchor ? state.anchorPoint : p,
    anchorSince: withinAnchor ? state.anchorSince : point.timestamp,
    acceptedCount: state.acceptedCount + 1,
  };
}

export interface StopCheck {
  shouldStop: boolean;
  reason?: Extract<EndReason, 'auto_stationary' | 'auto_home' | 'time_cap'>;
}

/**
 * Poll for auto-stop. Called on every ingested point and on a slow timer (so
 * a walk with no fresh points — phone on the hallway shelf — still ends).
 */
export function checkAutoStop(
  state: WalkSessionState,
  nowMs: number,
  config: SessionConfig = DEFAULT_SESSION_CONFIG,
): StopCheck {
  if (nowMs - state.startedAt >= config.hardCapMs) {
    return { shouldStop: true, reason: 'time_cap' };
  }

  if (
    state.stationarySince !== null &&
    nowMs - state.stationarySince >= config.autoStopStationaryMs
  ) {
    return { shouldStop: true, reason: 'auto_stationary' };
  }

  // Home-return: back inside the start geofence after a genuine loop. The
  // stationary clock must have AGED — the anchor model marks brief
  // within-radius moments during real movement, so non-null alone would clip
  // a brisk lap past the front door.
  if (
    state.startPoint &&
    state.lastAccepted &&
    state.maxExcursionM >= config.minExcursionM &&
    nowMs - state.startedAt >= config.minDurationForHomeStopMs &&
    state.stationarySince !== null && // linger at the door, don't clip a lap
    nowMs - state.stationarySince >= config.homeLingerMs &&
    haversineMeters(state.startPoint, state.lastAccepted) <= config.homeRadiusM
  ) {
    return { shouldStop: true, reason: 'auto_home' };
  }

  return { shouldStop: false };
}

export interface WalkSummary {
  startedAt: number;
  endedAt: number;
  durationS: number;
  movingTimeS: number;
  distanceM: number;
  avgMovingSpeedKmh: number;
  path: GeoPoint[];
  startPoint: GeoPoint | null;
  endPoint: GeoPoint | null;
  farthestPoint: GeoPoint | null;
  maxExcursionM: number;
  acceptedCount: number;
  rejectedForAccuracy: number;
  rejectedForSpeed: number;
  endReason: EndReason;
  /** Sniff stops — one point per auto-pause, in walk order. */
  pausePoints: GeoPoint[];
}

export function finalizeSession(
  state: WalkSessionState,
  endedAt: number,
  reason: EndReason,
): WalkSummary {
  const movingTimeS = Math.round(state.movingTimeMs / 1000);
  const avgMovingSpeedKmh =
    movingTimeS > 0 ? state.distanceM / 1000 / (movingTimeS / 3600) : 0;
  const endPoint = state.lastAccepted
    ? { lat: state.lastAccepted.lat, lng: state.lastAccepted.lng }
    : null;
  return {
    startedAt: state.startedAt,
    endedAt,
    durationS: Math.max(0, Math.round((endedAt - state.startedAt) / 1000)),
    movingTimeS,
    distanceM: Math.round(state.distanceM * 10) / 10,
    avgMovingSpeedKmh: Math.round(avgMovingSpeedKmh * 100) / 100,
    path: state.path,
    startPoint: state.startPoint,
    endPoint,
    farthestPoint: state.farthestPoint,
    maxExcursionM: Math.round(state.maxExcursionM),
    acceptedCount: state.acceptedCount,
    rejectedForAccuracy: state.rejectedForAccuracy,
    rejectedForSpeed: state.rejectedForSpeed,
    endReason: reason,
    pausePoints: state.pausePoints,
  };
}

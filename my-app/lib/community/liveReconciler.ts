/**
 * Live Walk v2 — one reducer for everything the live map hears.
 *
 * Sources: Broadcast `pos`/`snap`, postgres_changes rows, the
 * live_walk_positions read, Presence, the room connection itself, and
 * attendance. They arrive late, twice, out of order and from phones whose
 * clocks disagree; this module is where that stops mattering.
 *
 * ORDERING is (gen, seq) and nothing else. `gen` is the server-issued session
 * generation (a relaunch is a new one); `seq` is one counter per (walk, user,
 * gen), shared by Broadcast and database writes. A higher gen replaces the
 * walker's session, a lower one is dropped, and per user the highest gen ever
 * seen (the WATERMARK) is remembered for the whole visit, including after the
 * walker has been removed, so a delayed message from an old session can never
 * bring anyone back.
 *
 * TIME is the server's. Contact ("heard") and GPS-fix times are kept in server
 * time and mapped to this phone's clock through the calibrated offset
 * (serverClock.ts). Without a calibration they are NOT guessed: the age is
 * unknown (`age_known: false`) and contact is not advanced. Mappings made while
 * calibrated are pinned to the clock epoch they were made in and reused while
 * no estimate is available, so a walker already known to be present does not
 * flicker away when an estimate expires.
 *
 * CONTACT (`contact_at`) is the single rule for visibility, removal and order:
 *   present in the room as a walker  → now
 *   otherwise                         → the later of last heard and
 *                                       when Presence saw them leave
 *   nothing calibrated, not present   → null (hidden)
 * Hidden 2 minutes after contact. GPS age is only ever the label.
 *
 * ROUTES are index-aligned: each `pos` says which route index its points start
 * at, so loops and retraced paths are never mistaken for duplicates. A missing
 * stretch leaves the walker "behind" until a snapshot (a `snap`, or a database
 * row's path) repairs it. Snapshots repair geometry only; they never move a
 * dot, never count as contact.
 */

import { simplifyRoute, type GeoPoint } from '../walk/geo';
import type { LiveParty } from '../communityWalks';
import type { LiveRow, PositionsSnapshot, PosUpdate, SnapUpdate } from './liveProtocol';

export const LIVE_CONTACT_WINDOW_MS = 2 * 60_000;
export const ROUTE_TAIL_COMPACT_AT = 400;
export const ROUTE_BASE_POINTS = 160;

/** What the live screen renders: today's LiveParty plus the two v2 fields. */
export type LivePartyV2 = LiveParty & {
  /** Effective contact time; the only field used for visibility and order. */
  contact_at: string | null;
  /** Whether `recorded_at` (the GPS fix time) is calibrated. If not, show no age. */
  age_known: boolean;
};

export interface ReconcileClock {
  /** Date.now() */
  wall: number;
  /** serverClock epoch: local times from another epoch are not comparable. */
  epoch: number;
  /** server − local, or null while uncalibrated. */
  offsetMs: number | null;
}

interface Pin {
  local: number;
  epoch: number;
}

interface RouteState {
  gen: number;
  /** Route indices below baseRv are in `base` (simplified). */
  baseRv: number;
  base: GeoPoint[];
  /** Raw points for indices baseRv, baseRv + 1, … */
  tail: GeoPoint[];
  /** Highest route length the sender has announced for this gen. */
  latestRv: number;
}

export interface WalkerState {
  user: string;
  position: { gen: number; seq: number; lat: number; lng: number; accuracy: number | null } | null;
  heardServer: number | null;
  heardPin: Pin | null;
  fixServer: number | null;
  fixPin: Pin | null;
  route: RouteState;
  present: boolean;
  presenceLeft: Pin | null;
}

export interface ReconcilerState {
  walkId: string;
  walkers: Readonly<Record<string, WalkerState>>;
  watermarks: Readonly<Record<string, number>>;
  /** Users walking with sharing on, from attendance; null until known. */
  sharing: ReadonlySet<string> | null;
  walkActive: boolean;
}

export function createReconciler(walkId: string): ReconcilerState {
  return { walkId, walkers: {}, watermarks: {}, sharing: null, walkActive: true };
}

// ── Time helpers ────────────────────────────────────────────────────────────

const pinOf = (serverMs: number | null, clock: ReconcileClock): Pin | null =>
  serverMs === null || clock.offsetMs === null ? null : { local: serverMs - clock.offsetMs, epoch: clock.epoch };

const later = (a: Pin | null, b: Pin | null): Pin | null => {
  if (!a) return b;
  if (!b) return a;
  if (a.epoch !== b.epoch) return a.epoch > b.epoch ? a : b;
  return a.local >= b.local ? a : b;
};

const maxOrNull = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

/** A server time on this phone's clock, if it can honestly be said. */
function localTime(serverMs: number | null, pin: Pin | null, clock: ReconcileClock): number | null {
  if (serverMs !== null && clock.offsetMs !== null) return serverMs - clock.offsetMs;
  return pin && pin.epoch === clock.epoch ? pin.local : null;
}

export function contactLocal(walker: WalkerState, clock: ReconcileClock): number | null {
  if (walker.present) return clock.wall;
  const heard = localTime(walker.heardServer, walker.heardPin, clock);
  const left = walker.presenceLeft && walker.presenceLeft.epoch === clock.epoch ? walker.presenceLeft.local : null;
  return maxOrNull(heard, left);
}

// ── Routes ──────────────────────────────────────────────────────────────────

const emptyRoute = (gen: number): RouteState => ({ gen, baseRv: 0, base: [], tail: [], latestRv: 0 });

const heldRv = (route: RouteState) => route.baseRv + route.tail.length;

function compact(route: RouteState): RouteState {
  if (route.tail.length <= ROUTE_TAIL_COMPACT_AT) return route;
  return {
    ...route,
    base: simplifyRoute([...route.base, ...route.tail], ROUTE_BASE_POINTS),
    baseRv: heldRv(route),
    tail: [],
  };
}

function mergeDelta(route: RouteState, msg: PosUpdate): RouteState {
  if (route.gen > msg.gen) return route;
  const current = route.gen < msg.gen ? emptyRoute(msg.gen) : route;
  const expected = heldRv(current);
  let tail = current.tail;
  if (msg.pathIndex <= expected) {
    const skip = expected - msg.pathIndex;
    if (skip < msg.points.length) tail = [...tail, ...msg.points.slice(skip)];
  }
  return compact({ ...current, tail, latestRv: Math.max(current.latestRv, msg.routeVersion) });
}

function applySnapshot(route: RouteState, gen: number, routeVersion: number, points: GeoPoint[]): RouteState {
  if (gen < route.gen) return route;
  if (gen === route.gen && routeVersion < heldRv(route)) return route;
  return {
    gen,
    baseRv: routeVersion,
    base: points.slice(),
    tail: [],
    latestRv: Math.max(gen === route.gen ? route.latestRv : 0, routeVersion),
  };
}

// ── Walkers ─────────────────────────────────────────────────────────────────

function emptyWalker(user: string): WalkerState {
  return {
    user,
    position: null,
    heardServer: null,
    heardPin: null,
    fixServer: null,
    fixPin: null,
    route: emptyRoute(0),
    present: false,
    presenceLeft: null,
  };
}

function isNewer(position: WalkerState['position'], gen: number, seq: number): boolean {
  if (!position) return true;
  if (gen !== position.gen) return gen > position.gen;
  // Rows from builds without ordering metadata (gen 0): the latest write wins.
  return gen === 0 ? true : seq > position.seq;
}

function withWalker(state: ReconcilerState, walker: WalkerState, gen: number): ReconcilerState {
  return {
    ...state,
    walkers: { ...state.walkers, [walker.user]: walker },
    watermarks: { ...state.watermarks, [walker.user]: Math.max(state.watermarks[walker.user] ?? 0, gen) },
  };
}

function admits(state: ReconcilerState, user: string): boolean {
  if (!state.walkActive) return false;
  return state.sharing === null || state.sharing.has(user);
}

// ── Sources ─────────────────────────────────────────────────────────────────

export function applyPos(state: ReconcilerState, msg: PosUpdate, clock: ReconcileClock): ReconcilerState {
  if (msg.gen < (state.watermarks[msg.user] ?? 0) || !admits(state, msg.user)) return state;
  const walker = state.walkers[msg.user] ?? emptyWalker(msg.user);
  if (walker.position && msg.gen < walker.position.gen) return state;

  let next: WalkerState = { ...walker, route: mergeDelta(walker.route, msg) };
  if (isNewer(walker.position, msg.gen, msg.seq)) {
    const fixServer = msg.atServer === null ? null : msg.atServer - msg.fixAgeMs;
    next = {
      ...next,
      position: { gen: msg.gen, seq: msg.seq, lat: msg.lat, lng: msg.lng, accuracy: msg.obsAccuracy },
      fixServer,
      fixPin: pinOf(fixServer, clock),
    };
  }
  // Contact only when the sender could say when (server time). A message from
  // an uncalibrated sender still moves the dot, but proves nothing about now.
  if (msg.atServer !== null) {
    next = {
      ...next,
      heardServer: maxOrNull(next.heardServer, msg.atServer),
      heardPin: later(next.heardPin, pinOf(msg.atServer, clock)),
    };
  }
  return withWalker(state, next, msg.gen);
}

export function applySnap(state: ReconcilerState, msg: SnapUpdate): ReconcilerState {
  if (msg.gen < (state.watermarks[msg.user] ?? 0) || !admits(state, msg.user)) return state;
  const walker = state.walkers[msg.user] ?? emptyWalker(msg.user);
  const route = applySnapshot(walker.route, msg.gen, msg.routeVersion, msg.points);
  if (route === walker.route) return state;
  return withWalker(state, { ...walker, route }, msg.gen);
}

export function applyRow(state: ReconcilerState, row: LiveRow, clock: ReconcileClock): ReconcilerState {
  const mark = state.watermarks[row.user] ?? 0;
  // A row from a replaced session, or a row an older build wrote for someone
  // already on a v2 session, says nothing current.
  if ((row.gen > 0 && row.gen < mark) || (row.gen === 0 && mark > 0) || !admits(state, row.user)) return state;
  const walker = state.walkers[row.user] ?? emptyWalker(row.user);
  if (walker.position && row.gen < walker.position.gen) return state;

  // heard_at is when the server actually received this write: honest contact
  // however late the event itself arrives.
  let next: WalkerState = {
    ...walker,
    heardServer: maxOrNull(walker.heardServer, row.heardAt),
    heardPin: later(walker.heardPin, pinOf(row.heardAt, clock)),
  };
  const newer = isNewer(walker.position, row.gen, row.seq);
  if (newer) {
    next = {
      ...next,
      position: { gen: row.gen, seq: row.seq, lat: row.lat, lng: row.lng, accuracy: row.accuracy },
      fixServer: row.fixAt,
      fixPin: pinOf(row.fixAt, clock),
    };
  }
  if (row.routeVersion !== null) {
    next = { ...next, route: applySnapshot(next.route, row.gen, row.routeVersion, row.path) };
  } else if (newer) {
    next = { ...next, route: { gen: 0, baseRv: row.path.length, base: row.path.slice(), tail: [], latestRv: row.path.length } };
  }
  return withWalker(state, next, row.gen);
}

export function applyPositions(state: ReconcilerState, snapshot: PositionsSnapshot, clock: ReconcileClock): ReconcilerState {
  if (!snapshot.visible) return { ...state, walkers: {} };
  const watermarks = { ...state.watermarks };
  for (const [user, gen] of Object.entries(snapshot.watermarks)) watermarks[user] = Math.max(watermarks[user] ?? 0, gen);
  // A walker whose session the server has since replaced is gone from this
  // phone's point of view until their new session speaks.
  const walkers: Record<string, WalkerState> = {};
  for (const [user, walker] of Object.entries(state.walkers)) {
    if (!walker.position || walker.position.gen >= (watermarks[user] ?? 0)) walkers[user] = walker;
  }
  let next: ReconcilerState = { ...state, walkers, watermarks };
  for (const row of snapshot.rows) next = applyRow(next, row, clock);
  return next;
}

/** A full Presence sync: the users currently in the room as walkers. */
export function applyPresence(state: ReconcilerState, presentWalkers: readonly string[], clock: ReconcileClock): ReconcilerState {
  const present = new Set(presentWalkers);
  const walkers: Record<string, WalkerState> = {};
  for (const [user, walker] of Object.entries(state.walkers)) {
    if (present.has(user)) walkers[user] = walker.present ? walker : { ...walker, present: true, presenceLeft: null };
    else if (walker.present) walkers[user] = { ...walker, present: false, presenceLeft: { local: clock.wall, epoch: clock.epoch } };
    else walkers[user] = walker;
  }
  for (const user of present) {
    if (!walkers[user] && admits(state, user)) walkers[user] = { ...emptyWalker(user), present: true };
  }
  return { ...state, walkers };
}

/**
 * This phone's own room connection dropped: whatever Presence said is no
 * longer being kept up to date, so everyone present is treated as having left
 * now (and so stays visible for the 2-minute grace, then not).
 */
export function applyLinkDown(state: ReconcilerState, clock: ReconcileClock): ReconcilerState {
  return applyPresence(state, [], clock);
}

/** Attendance is the authority on who may be on the map at all. */
export function applyAttendance(
  state: ReconcilerState,
  input: { sharing: readonly string[]; walkActive: boolean },
): ReconcilerState {
  const sharing = new Set(input.sharing);
  const walkers: Record<string, WalkerState> = {};
  if (input.walkActive) {
    for (const [user, walker] of Object.entries(state.walkers)) if (sharing.has(user)) walkers[user] = walker;
  }
  return { ...state, sharing, walkActive: input.walkActive, walkers };
}

/** Refresh pinned local times after a new calibration, so they outlive it. */
export function applyClock(state: ReconcilerState, clock: ReconcileClock): ReconcilerState {
  if (clock.offsetMs === null) return state;
  const walkers: Record<string, WalkerState> = {};
  for (const [user, walker] of Object.entries(state.walkers)) {
    walkers[user] = {
      ...walker,
      heardPin: pinOf(walker.heardServer, clock) ?? walker.heardPin,
      fixPin: pinOf(walker.fixServer, clock) ?? walker.fixPin,
    };
  }
  return { ...state, walkers };
}

/** Drop walkers whose contact is known and more than 2 minutes old. */
export function prune(state: ReconcilerState, clock: ReconcileClock): ReconcilerState {
  let changed = false;
  const walkers: Record<string, WalkerState> = {};
  for (const [user, walker] of Object.entries(state.walkers)) {
    const contact = contactLocal(walker, clock);
    if (contact !== null && clock.wall - contact >= LIVE_CONTACT_WINDOW_MS) changed = true;
    else walkers[user] = walker;
  }
  return changed ? { ...state, walkers } : state;
}

// ── Output ──────────────────────────────────────────────────────────────────

/** Walkers missing part of their route, for whom a catch-up should be asked. */
export function walkersBehind(state: ReconcilerState): string[] {
  return Object.values(state.walkers)
    .filter(w => w.position && w.route.gen === w.position.gen && w.route.latestRv > heldRv(w.route))
    .map(w => w.user)
    .sort();
}

export function selectParties(state: ReconcilerState, clock: ReconcileClock): LivePartyV2[] {
  if (!state.walkActive) return [];
  const out: { party: LivePartyV2; contact: number }[] = [];
  for (const walker of Object.values(state.walkers)) {
    if (!walker.position || !admits(state, walker.user)) continue;
    const contact = contactLocal(walker, clock);
    if (contact === null || clock.wall - contact >= LIVE_CONTACT_WINDOW_MS) continue;
    const fix = localTime(walker.fixServer, walker.fixPin, clock);
    out.push({
      contact,
      party: {
        walk_id: state.walkId,
        user_id: walker.user,
        lat: walker.position.lat,
        lng: walker.position.lng,
        accuracy_m: walker.position.accuracy,
        path: [...walker.route.base, ...walker.route.tail],
        // Never in the future: a small offset error must not read as "in 3 s".
        recorded_at: new Date(Math.min(fix ?? contact, clock.wall)).toISOString(),
        contact_at: new Date(Math.min(contact, clock.wall)).toISOString(),
        age_known: fix !== null,
      },
    });
  }
  return out
    .sort((a, b) => b.contact - a.contact || (a.party.user_id < b.party.user_id ? -1 : 1))
    .map(entry => entry.party);
}

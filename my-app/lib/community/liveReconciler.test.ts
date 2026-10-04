import {
  LIVE_CONTACT_WINDOW_MS,
  applyAttendance,
  applyClock,
  applyLinkDown,
  applyPos,
  applyPositions,
  applyPresence,
  applyRow,
  applySnap,
  createReconciler,
  prune,
  selectParties,
  walkersBehind,
  type ReconcileClock,
  type ReconcilerState,
} from './liveReconciler';
import type { LiveRow, PosUpdate, SnapUpdate } from './liveProtocol';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';

// This phone's clock is 5 minutes behind the server's.
const OFFSET = 5 * 60_000;
const SERVER_NOW = 1_760_000_000_000;
const LOCAL_NOW = SERVER_NOW - OFFSET;
const iso = (ms: number) => new Date(ms).toISOString();

const clock = (over: Partial<ReconcileClock> = {}): ReconcileClock => ({ wall: LOCAL_NOW, epoch: 0, offsetMs: OFFSET, ...over });
const later = (ms: number, over: Partial<ReconcileClock> = {}) => clock({ wall: LOCAL_NOW + ms, ...over });

// A zig-zag, so simplification cannot collapse it to a line.
const pt = (i: number) => ({ lat: -33.87 + i * 1e-4, lng: 151.2 + (i % 2 ? 1e-4 : 0) });
const run = (from: number, n: number) => Array.from({ length: n }, (_, i) => pt(from + i));

const pos = (user: string, gen: number, seq: number, over: Partial<PosUpdate> = {}): PosUpdate => ({
  kind: 'pos',
  user,
  gen,
  seq,
  atServer: SERVER_NOW - 1_000,
  fixAgeMs: 2_000,
  lat: -33.87 + seq / 1e4,
  lng: 151.2,
  obsAgeMs: null,
  obsAccuracy: 5,
  pathIndex: 0,
  points: [],
  routeVersion: 0,
  ...over,
});

const delta = (user: string, gen: number, seq: number, pathIndex: number, n: number, over: Partial<PosUpdate> = {}) =>
  pos(user, gen, seq, { pathIndex, points: run(pathIndex, n), routeVersion: pathIndex + n, ...over });

const snap = (user: string, gen: number, routeVersion: number, points = run(0, routeVersion)): SnapUpdate => ({
  kind: 'snap', user, gen, routeVersion, points,
});

const row = (user: string, gen: number, seq: number, over: Partial<LiveRow> = {}): LiveRow => ({
  user,
  lat: -33.9,
  lng: 151.3,
  accuracy: 8,
  path: [],
  heardAt: SERVER_NOW - 1_000,
  fixAt: SERVER_NOW - 3_000,
  gen,
  seq,
  routeVersion: 0,
  ...over,
});

const start = () => applyAttendance(createReconciler('w1'), { sharing: [ANA, BEN], walkActive: true });
const party = (state: ReconcilerState, c = clock(), user = ANA) => selectParties(state, c).find(p => p.user_id === user);

describe('ordering is (gen, seq) and nothing else', () => {
  it('moves the dot for a newer seq, not for an older one', () => {
    let s = applyPos(start(), pos(ANA, 2, 5), clock());
    s = applyPos(s, pos(ANA, 2, 4), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 5 / 1e4);
  });

  it('does not let a stale checkpoint move the dot back after a newer Broadcast', () => {
    let s = applyPos(start(), pos(ANA, 2, 10), clock());
    s = applyRow(s, row(ANA, 2, 8), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 10 / 1e4);
  });

  it('takes a new session (relaunch) whose numbering restarts at 1', () => {
    let s = applyPos(start(), pos(ANA, 2, 50), clock());
    s = applyPos(s, pos(ANA, 3, 1), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 1 / 1e4);
    s = applyPos(s, pos(ANA, 2, 99), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 1 / 1e4);
  });

  it('remembers generations after a walker is removed, so an old session cannot bring them back', () => {
    let s = applyPos(start(), pos(ANA, 3, 4), clock());
    s = applyAttendance(s, { sharing: [BEN], walkActive: true });
    s = applyAttendance(s, { sharing: [ANA, BEN], walkActive: true });
    s = applyPos(s, pos(ANA, 2, 100), clock());
    expect(party(s)).toBeUndefined();
    s = applyPos(s, pos(ANA, 3, 5), clock());
    expect(party(s)).toBeDefined();
  });

  it('takes watermarks from the read, and drops walkers the server has moved past', () => {
    let s = applyPos(start(), pos(ANA, 2, 9), clock());
    s = applyPositions(s, { visible: true, serverNow: SERVER_NOW, rows: [], watermarks: { [ANA]: 3 } }, clock());
    expect(party(s)).toBeUndefined();
    s = applyPos(s, pos(ANA, 2, 10), clock());
    expect(party(s)).toBeUndefined();
    s = applyPos(s, pos(ANA, 3, 1), clock());
    expect(party(s)).toBeDefined();
  });

  it('is not affected by the time a message claims (sender clocks never order anything)', () => {
    let s = applyPos(start(), pos(ANA, 2, 5, { atServer: SERVER_NOW - 1_000 }), clock());
    s = applyPos(s, pos(ANA, 2, 6, { atServer: SERVER_NOW - 90_000 }), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 6 / 1e4);
    expect(party(s)?.contact_at).toBe(iso(LOCAL_NOW - 1_000));
  });
});

describe('time is the server’s', () => {
  it('gives the same ages on phones whose clocks disagree', () => {
    const msg = pos(ANA, 2, 1, { atServer: SERVER_NOW - 1_000, fixAgeMs: 2_000 });
    const behind = party(applyPos(start(), msg, clock()));
    expect(behind?.recorded_at).toBe(iso(LOCAL_NOW - 3_000));
    expect(behind?.contact_at).toBe(iso(LOCAL_NOW - 1_000));
    // A phone 5 minutes AHEAD of the server.
    const ahead = clock({ wall: SERVER_NOW + OFFSET, offsetMs: -OFFSET });
    const p = party(applyPos(start(), msg, ahead), ahead);
    expect(p?.recorded_at).toBe(iso(SERVER_NOW + OFFSET - 3_000));
    expect(p?.age_known).toBe(true);
  });

  it('shows a database event that arrived 60 s late with its true ages', () => {
    const s = applyRow(start(), row(ANA, 2, 1, { heardAt: SERVER_NOW - 60_000, fixAt: SERVER_NOW - 65_000 }), clock());
    expect(party(s)?.contact_at).toBe(iso(LOCAL_NOW - 60_000));
    expect(party(s)?.recorded_at).toBe(iso(LOCAL_NOW - 65_000));
  });

  it('does not show Broadcast delivered late (a phone resuming) as fresh', () => {
    const s = applyPos(start(), pos(ANA, 2, 1, { atServer: SERVER_NOW - 5 * 60_000 }), clock());
    expect(party(s)).toBeUndefined();
    expect(prune(s, clock()).walkers[ANA]).toBeUndefined();
  });

  it('while uncalibrated: no age, no contact; both appear once calibration arrives', () => {
    const blind = clock({ offsetMs: null });
    const s = applyPos(start(), pos(ANA, 2, 1), blind);
    expect(party(s, blind)).toBeUndefined();
    expect(party(s, clock())).toMatchObject({ age_known: true, contact_at: iso(LOCAL_NOW - 1_000) });
  });

  it('while uncalibrated, shows a present walker without an age', () => {
    const blind = clock({ offsetMs: null });
    let s = applyPos(start(), pos(ANA, 2, 1), blind);
    s = applyPresence(s, [ANA], blind);
    expect(party(s, blind)).toMatchObject({ age_known: false, contact_at: iso(LOCAL_NOW) });
  });

  it('moves the dot for an uncalibrated sender but takes it as no proof of contact', () => {
    const s = applyPos(start(), pos(ANA, 2, 1, { atServer: null }), clock());
    expect(party(s)).toBeUndefined();
    expect(party(applyPresence(s, [ANA], clock()))).toMatchObject({ age_known: false });
  });

  it('keeps what it knew when an estimate expires, not when the clock changes', () => {
    const s = applyClock(applyPos(start(), pos(ANA, 2, 1), clock()), clock());
    expect(party(s, clock({ offsetMs: null }))).toMatchObject({ age_known: true, contact_at: iso(LOCAL_NOW - 1_000) });
    expect(party(s, clock({ offsetMs: null, epoch: 1 }))).toBeUndefined();
  });

  it('never dates anything in the future', () => {
    const s = applyPos(start(), pos(ANA, 2, 1, { atServer: SERVER_NOW + 5_000, fixAgeMs: 0 }), clock());
    expect(party(s)?.recorded_at).toBe(iso(LOCAL_NOW));
    expect(party(s)?.contact_at).toBe(iso(LOCAL_NOW));
  });
});

describe('Presence', () => {
  const old = pos(ANA, 2, 1, { atServer: SERVER_NOW - 10 * 60_000, fixAgeMs: 0 });

  it('keeps a present walker current while their GPS age stays honest', () => {
    const s = applyPresence(applyPos(start(), old, clock()), [ANA], clock());
    expect(party(s)).toMatchObject({ contact_at: iso(LOCAL_NOW), recorded_at: iso(LOCAL_NOW - 10 * 60_000), age_known: true });
  });

  it('gives 2 minutes of grace from the moment they leave, in the filter and in pruning alike', () => {
    let s = applyPresence(applyPos(start(), old, clock()), [ANA], clock());
    s = applyPresence(s, [], clock());
    const justIn = later(LIVE_CONTACT_WINDOW_MS - 1);
    const justOut = later(LIVE_CONTACT_WINDOW_MS);
    expect(party(s, justIn)).toBeDefined();
    expect(prune(s, justIn).walkers[ANA]).toBeDefined();
    expect(party(s, justOut)).toBeUndefined();
    expect(prune(s, justOut).walkers[ANA]).toBeUndefined();
  });

  it('stops trusting Presence when this phone’s own connection drops', () => {
    let s = applyPresence(applyPos(start(), old, clock()), [ANA], clock());
    s = applyLinkDown(s, clock());
    expect(party(s, later(LIVE_CONTACT_WINDOW_MS - 1))).toBeDefined();
    expect(party(s, later(LIVE_CONTACT_WINDOW_MS))).toBeUndefined();
  });

  it('orders by contact, newest first', () => {
    let s = applyPos(start(), pos(ANA, 2, 1, { atServer: SERVER_NOW - 30_000 }), clock());
    s = applyPos(s, pos(BEN, 2, 1, { atServer: SERVER_NOW - 10 * 60_000 }), clock());
    s = applyPresence(s, [BEN], clock());
    expect(selectParties(s, clock()).map(p => p.user_id)).toEqual([BEN, ANA]);
  });
});

describe('routes are index-aligned', () => {
  it('appends deltas, keeping loops and retraced points', () => {
    let s = applyPos(start(), pos(ANA, 2, 1, { pathIndex: 0, points: [pt(0), pt(1), pt(2)], routeVersion: 3 }), clock());
    s = applyPos(s, pos(ANA, 2, 2, { pathIndex: 3, points: [pt(1), pt(0)], routeVersion: 5 }), clock());
    expect(party(s)?.path).toEqual([pt(0), pt(1), pt(2), pt(1), pt(0)]);
  });

  it('skips points it already holds', () => {
    let s = applyPos(start(), delta(ANA, 2, 1, 0, 3), clock());
    s = applyPos(s, delta(ANA, 2, 2, 1, 3), clock());
    expect(party(s)?.path).toEqual(run(0, 4));
  });

  it('marks a gap without holding the dot back, and a snapshot repairs only the geometry', () => {
    let s = applyPos(start(), delta(ANA, 2, 1, 0, 2), clock());
    s = applyPos(s, delta(ANA, 2, 3, 5, 1, { atServer: SERVER_NOW - 500 }), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 3 / 1e4);
    expect(party(s)?.path).toEqual(run(0, 2));
    expect(walkersBehind(s)).toEqual([ANA]);

    const before = party(s);
    s = applySnap(s, snap(ANA, 2, 6));
    expect(walkersBehind(s)).toEqual([]);
    expect(party(s)?.path).toEqual(run(0, 6));
    expect(party(s)).toMatchObject({ lat: before?.lat, contact_at: before?.contact_at, recorded_at: before?.recorded_at });
  });

  it('accepts the snap and the empty-delta pos in either order', () => {
    const empty = pos(ANA, 2, 7, { pathIndex: 40, points: [], routeVersion: 40 });
    const snapFirst = applyPos(applySnap(start(), snap(ANA, 2, 40)), empty, clock());
    expect(walkersBehind(snapFirst)).toEqual([]);
    expect(party(snapFirst)?.path).toHaveLength(40);

    // Pos first: the empty delta reveals the gap (a lost snap would leave it
    // here, and the catch-up request repairs it).
    const posFirst = applyPos(start(), empty, clock());
    expect(walkersBehind(posFirst)).toEqual([ANA]);
    expect(walkersBehind(applySnap(posFirst, snap(ANA, 2, 40)))).toEqual([]);
  });

  it('never lets a smaller or older snapshot overwrite the route', () => {
    let s = applyPos(start(), delta(ANA, 3, 1, 0, 12), clock());
    s = applySnap(s, snap(ANA, 3, 10));
    expect(party(s)?.path).toHaveLength(12);
    s = applySnap(s, snap(ANA, 2, 50));
    expect(party(s)?.path).toHaveLength(12);
  });

  it('compacts a long tail and keeps appending in step', () => {
    let s = start();
    for (let batch = 0; batch < 21; batch += 1) s = applyPos(s, delta(ANA, 2, batch + 1, batch * 20, 20), clock());
    const compacted = party(s)?.path ?? [];
    expect(compacted.length).toBeLessThanOrEqual(160);
    expect(compacted[compacted.length - 1]).toEqual(pt(419));
    s = applyPos(s, delta(ANA, 2, 22, 420, 2), clock());
    expect(walkersBehind(s)).toEqual([]);
    expect(party(s)?.path.slice(-2)).toEqual([pt(420), pt(421)]);
  });

  it('starts the route afresh with a new session', () => {
    let s = applyPos(start(), delta(ANA, 2, 1, 0, 5), clock());
    s = applyPos(s, delta(ANA, 3, 1, 10, 1), clock());
    expect(party(s)?.path).toEqual([]);
    expect(walkersBehind(s)).toEqual([ANA]);
  });

  it('takes a route snapshot from a database row', () => {
    const s = applyRow(start(), row(ANA, 2, 1, { path: run(0, 30), routeVersion: 30 }), clock());
    expect(party(s)?.path).toEqual(run(0, 30));
  });
});

describe('rows from older builds', () => {
  it('still show, with no age, and the latest one wins', () => {
    let s = applyRow(start(), row(ANA, 0, 0, { fixAt: null, routeVersion: null, path: run(0, 3) }), clock());
    expect(party(s)).toMatchObject({ age_known: false, path: run(0, 3) });
    s = applyRow(s, row(ANA, 0, 0, { fixAt: null, routeVersion: null, lat: -34, path: run(0, 4) }), clock());
    expect(party(s)).toMatchObject({ lat: -34, path: run(0, 4) });
  });

  it('are ignored for someone already on a v2 session', () => {
    let s = applyPos(start(), pos(ANA, 2, 1), clock());
    s = applyRow(s, row(ANA, 0, 0, { fixAt: null, routeVersion: null, lat: -34 }), clock());
    expect(party(s)?.lat).toBeCloseTo(-33.87 + 1 / 1e4);
  });
});

describe('attendance and the walk decide who may appear', () => {
  it('shows only walking, sharing attendees, and drops anyone who stops', () => {
    let s = applyPos(start(), pos(ANA, 2, 1), clock());
    s = applyAttendance(s, { sharing: [BEN], walkActive: true });
    expect(party(s)).toBeUndefined();
    expect(party(applyPos(s, pos(ANA, 2, 2), clock()))).toBeUndefined();
  });

  it('shows nobody once the walk is over', () => {
    const s = applyAttendance(applyPos(start(), pos(ANA, 2, 1), clock()), { sharing: [ANA], walkActive: false });
    expect(selectParties(s, clock())).toEqual([]);
    expect(selectParties(applyPos(s, pos(ANA, 2, 2), clock()), clock())).toEqual([]);
  });

  it('clears everything when the read says this walk is not visible', () => {
    const s = applyPositions(applyPos(start(), pos(ANA, 2, 1), clock()), { visible: false, serverNow: SERVER_NOW, rows: [], watermarks: {} }, clock());
    expect(s.walkers).toEqual({});
  });

  it('renders today’s LiveParty shape plus contact_at and age_known', () => {
    expect(Object.keys(party(applyPos(start(), pos(ANA, 2, 1), clock())) ?? {}).sort()).toEqual(
      ['accuracy_m', 'age_known', 'contact_at', 'lat', 'lng', 'path', 'recorded_at', 'user_id', 'walk_id'],
    );
  });
});

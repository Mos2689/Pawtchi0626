import { LiveReceiver, RECEIVER_FALLBACK_POLL_MS, RECEIVER_RECONCILE_MS, type ReceiverDeps } from './liveReceiver';
import type { LinkConsumer, LinkHandle, LinkStatus } from './liveLink';
import { buildPos, buildSnap, parseLiveMessage } from './liveProtocol';
import type { LivePartyV2 } from './liveReconciler';

const ME = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';
const WALK = '33333333-3333-4333-8333-333333333333';
const T0 = Date.parse('2026-10-05T09:00:00.000Z');

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const pt = (i: number) => ({ lat: -33.87 + i * 0.0001, lng: 151.2 });

function row(over: Record<string, unknown> = {}) {
  return {
    user_id: ANA, lat: pt(2).lat, lng: 151.2, accuracy_m: 5,
    path: [pt(0), pt(1), pt(2)], heard_at: new Date(T0 - 5_000).toISOString(), fix_at: new Date(T0 - 6_000).toISOString(),
    live_gen: 1, seq: 1, route_version: 3,
    ...over,
  };
}

function setup(options: { transport?: 'db' | 'broadcast' | null; positions?: unknown; linkStatus?: LinkStatus } = {}) {
  let wall = T0;
  let mono = 0;
  const lists: LivePartyV2[][] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const sent: { event: string; payload: Record<string, unknown> }[] = [];
  let reads = 0;
  let positions: unknown = options.positions ?? { status: 'ok', server_now: new Date(T0).toISOString(), rows: [row()], watermarks: [] };
  let consumer: LinkConsumer | null = null;
  let status: LinkStatus = options.linkStatus ?? 'connecting';
  let released = 0;
  const link: LinkHandle = {
    status: () => status,
    isReady: () => status === 'joined',
    isHealthy: () => true,
    send: async (event, payload) => { sent.push({ event, payload: payload as Record<string, unknown> }); return 'ok'; },
    setRole: () => {},
    release: () => { released += 1; },
  };
  const hints: number[] = [];
  const deps: ReceiverDeps = {
    readPositions: async () => { reads += 1; return { data: positions, error: null }; },
    readTransport: async () => options.transport === undefined ? 'db' : options.transport,
    acquireLink: c => { consumer = c; return link; },
    // A calibrated phone whose clock agrees with the server.
    clock: () => ({ wall, epoch: 1, offsetMs: 0 }),
    mono: () => mono,
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    onParties: parties => lists.push(parties),
    onEndHint: () => hints.push(1),
  };
  const receiver = new LiveReceiver(deps, WALK, ME);
  return {
    receiver,
    lists,
    sent,
    hints,
    reads: () => reads,
    released: () => released,
    latest: () => lists[lists.length - 1] ?? [],
    advance: (ms: number) => { wall += ms; mono += ms; },
    setPositions: (value: unknown) => { positions = value; },
    consumer: () => consumer,
    setStatus: (next: LinkStatus) => { status = next; consumer?.onStatus?.(next); },
  };
}

describe('reading positions', () => {
  it('shows a walker from the first read, with a known age', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    expect(t.latest()).toHaveLength(1);
    expect(t.latest()[0]).toMatchObject({ user_id: ANA, age_known: true, path: [pt(0), pt(1), pt(2)] });
  });

  it('reads again once a minute on a db walk, not every tick', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    expect(t.reads()).toBe(1);
    t.advance(30_000);
    t.receiver.tick();
    expect(t.reads()).toBe(1);
    t.advance(RECEIVER_RECONCILE_MS - 30_000);
    t.receiver.tick();
    await flush();
    expect(t.reads()).toBe(2);
  });

  it('does not render again when nothing visible changed', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    const renders = t.lists.length;
    await t.receiver.refresh();
    expect(t.lists.length).toBe(renders);
  });

  it('hides a walker two minutes after last contact', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    t.advance(2 * 60_000);
    t.receiver.tick();
    expect(t.latest()).toEqual([]);
  });
});

describe('rows from postgres_changes', () => {
  it('moves the walker on a newer row and ignores an older one', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    t.receiver.onRow(row({ seq: 2, lat: pt(3).lat, path: [pt(0), pt(1), pt(2), pt(3)], route_version: 4, heard_at: new Date(T0).toISOString() }));
    expect(t.latest()[0].lat).toBe(pt(3).lat);
    t.receiver.onRow(row({ seq: 1, lat: pt(9).lat }));
    expect(t.latest()[0].lat).toBe(pt(3).lat);
  });

  it('drops a malformed row without throwing', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    expect(() => t.receiver.onRow({ user_id: 'nope' })).not.toThrow();
  });
});

describe('attendance', () => {
  it('removes a walker who stopped sharing, and everyone when the walk closes', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    t.receiver.setAttendance([ANA], true);
    expect(t.latest()).toHaveLength(1);
    t.receiver.setAttendance([], true);
    expect(t.latest()).toEqual([]);
    t.receiver.setAttendance([ANA], false);
    expect(t.latest()).toEqual([]);
  });

  it('reads again when someone starts sharing, so they appear without waiting', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    t.receiver.setAttendance([], true);
    await flush();
    const before = t.reads();
    t.receiver.setAttendance([ANA], true);
    await flush(); await flush();
    expect(t.reads()).toBe(before + 1);
    expect(t.latest()).toHaveLength(1);
  });
});

describe('on a broadcast walk', () => {
  const pos = (seq: number, i: number, atServer: number) => parseLiveMessage('pos', buildPos({
    user: ANA, gen: 1, seq, atServer, fixAgeMs: 1_000, lat: pt(i).lat, lng: 151.2,
    obsAgeMs: 500, obsAccuracy: 5, pathIndex: i, points: [pt(i)],
  }));

  it('joins the room only on a broadcast walk', async () => {
    const db = setup({ transport: 'db' });
    db.receiver.start();
    await flush();
    expect(db.consumer()).toBeNull();
    const live = setup({ transport: 'broadcast' });
    live.receiver.start();
    await flush();
    expect(live.consumer()).not.toBeNull();
  });

  it('moves the walker on a pos from the room', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush(); await flush();
    t.consumer()?.onMessage?.(pos(2, 3, T0)!);
    expect(t.latest()[0].lat).toBeCloseTo(pt(3).lat, 5);
    expect(t.latest()[0].path).toHaveLength(4);
  });

  it('asks for missing route once, then repairs from a snap', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush(); await flush();
    // Holds 3 points; this pos starts at index 6, so 3..5 are missing.
    t.consumer()?.onMessage?.(pos(2, 6, T0)!);
    expect(t.sent.filter(s => s.event === 'req')).toHaveLength(1);
    expect(t.sent[0].payload).toMatchObject({ want: ANA });
    t.consumer()?.onMessage?.(parseLiveMessage('snap', buildSnap({
      user: ANA, gen: 1, routeVersion: 7, points: [0, 1, 2, 3, 4, 5, 6].map(pt),
    }))!);
    expect(t.latest()[0].path).toHaveLength(7);
  });

  it('polls every 15 s while the room is not joined', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'waiting' });
    t.receiver.start();
    await flush(); await flush();
    const before = t.reads();
    t.advance(RECEIVER_FALLBACK_POLL_MS);
    t.receiver.tick();
    await flush();
    expect(t.reads()).toBe(before + 1);
  });

  it('reads once on (re)joining the room', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'waiting' });
    t.receiver.start();
    await flush(); await flush();
    const before = t.reads();
    t.setStatus('joined');
    await flush();
    expect(t.reads()).toBe(before + 1);
  });

  it('keeps a present walker visible past two minutes, and lets them go two minutes after the room drops', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush(); await flush();
    t.consumer()?.onPresence?.([ANA]);
    t.advance(5 * 60_000);
    t.receiver.tick();
    expect(t.latest()).toHaveLength(1);
    t.setStatus('waiting');
    t.advance(60_000);
    t.receiver.tick();
    expect(t.latest()).toHaveLength(1);
    t.advance(60_000);
    t.receiver.tick();
    expect(t.latest()).toEqual([]);
  });

  it('passes the host’s end hint on', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush();
    t.consumer()?.onMessage?.({ kind: 'endhint', user: ANA });
    expect(t.hints).toHaveLength(1);
  });

  it('leaves the room when the walk is switched to db', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush();
    t.receiver.setTransport('db');
    expect(t.released()).toBe(1);
  });

  it('sends the end hint only through a joined room', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush();
    t.receiver.sendEndHint();
    expect(t.sent.filter(s => s.event === 'endhint')).toHaveLength(1);
  });
});

describe('stopping', () => {
  it('releases the room and ignores late answers', async () => {
    const t = setup({ transport: 'broadcast', linkStatus: 'joined' });
    t.receiver.start();
    await flush();
    t.receiver.stop();
    expect(t.released()).toBe(1);
    const renders = t.lists.length;
    t.receiver.onRow(row({ seq: 5 }));
    expect(t.lists.length).toBe(renders);
  });
});

describe('field-health summary', () => {
  it('counts reads, rows and walkers seen, and carries no coordinates or ids', async () => {
    const t = setup();
    t.receiver.start();
    await flush(); await flush();
    t.receiver.onRow(row({ seq: 2 }));
    t.receiver.stop();
    const summary = t.receiver.summary();
    expect(summary).toMatchObject({ transport: 'db', reads_ok: 1, reads_failed: 0, rows: 1, max_walkers: 1, clock_known: true });
    expect(JSON.stringify(summary)).not.toMatch(/-33\.|151\.|2222|3333/);
  });
});

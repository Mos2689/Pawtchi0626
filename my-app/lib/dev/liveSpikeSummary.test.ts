import {
  backgroundIntervals,
  formatSpikeSummary,
  maxGap,
  percentile,
  summariseSpike,
  type SpikeEvent,
  type SpikeEventBody,
} from './liveSpikeSummary';

const at = (s: number, a: string, body: SpikeEventBody): SpikeEvent => ({ ...body, t: s * 1000, m: s * 1000, a });
const tick = (s: number, a: string, conn = 'open', tokExp: number | null = 5000) =>
  at(s, a, { k: 'tick', drift: 0, conn, ch: 'joined', tokExp, peers: 1 });

describe('backgroundIntervals', () => {
  it('pairs each move to the background with the return', () => {
    const events = [tick(0, 'active'), tick(5, 'background'), tick(10, 'background'), tick(15, 'active'), tick(20, 'inactive')];
    expect(backgroundIntervals(events)).toEqual([{ from: 5000, to: 15000 }, { from: 20000, to: 20000 }]);
  });
});

describe('maxGap', () => {
  it('finds the largest gap, optionally only where it touches the background', () => {
    const times = [0, 5000, 10000, 70000, 75000];
    expect(maxGap(times)).toBe(60000);
    expect(maxGap(times, [{ from: 71000, to: 80000 }])).toBe(5000);
    expect(maxGap([1])).toBeNull();
  });
});

describe('percentile', () => {
  it('uses nearest rank', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('summariseSpike', () => {
  const events: SpikeEvent[] = [
    at(0, 'active', { k: 'start', room: 'a1', role: 'walker', platform: 'ios', build: '100' }),
    at(1, 'active', { k: 'ch', status: 'SUBSCRIBED' }),
    tick(5, 'active'),
    at(6, 'active', { k: 'send', seq: 1, via: 'timer', res: 'ok', rtt: 120 }),
    at(7, 'active', { k: 'recv', from: 'bbbbbbbb', seq: 1, via: 'timer', sentApp: 'active', sentAt: 6800 }),
    at(8, 'background', { k: 'app', state: 'background' }),
    tick(10, 'background'),
    at(11, 'background', { k: 'hb', status: 'sent' }),
    at(12, 'background', { k: 'send', seq: 2, via: 'loc', res: 'timed out', rtt: 10000 }),
    at(13, 'background', { k: 'skip', seq: 3, via: 'timer', why: 'not_ready' }),
    at(20, 'background', { k: 'recv', from: 'bbbbbbbb', seq: 2, via: 'loc', sentApp: 'background', sentAt: 19500 }),
    tick(70, 'background', 'closed', 5000),
    at(75, 'background', { k: 'pres', what: 'leave', keys: ['bbbbbbbb'] }),
    at(80, 'background', { k: 'rt', what: 'close', code: 1000, reason: 'heartbeat timeout' }),
    tick(90, 'active', 'open', 9000),
    at(91, 'active', { k: 'app', state: 'active' }),
    at(92, 'active', { k: 'auth', event: 'TOKEN_REFRESHED', exp: 9000 }),
    at(93, 'active', { k: 'pgc', ev: 'UPDATE', from: 'bbbbbbbb', recordedAt: new Date(92_500).toISOString() }),
    at(94, 'active', { k: 'probe', what: 'public', status: 'SUBSCRIBED', pings: 0, presence: 0 }),
    at(95, 'active', { k: 'note', text: 'unlocked' }),
    at(96, 'active', { k: 'walk', phase: 'saving' }),
  ];
  const s = summariseSpike(events);

  it('reads the run header and how long it spent in the background', () => {
    expect([s.room, s.role, s.platform, s.build]).toEqual(['a1', 'walker', 'ios', '100']);
    expect(s.durationMin).toBe(1.6);
    expect(s.backgroundMin).toBe(1.4);
  });

  it('measures the timer gap that touched the background', () => {
    expect(s.timers).toEqual({ ticks: 4, backgroundTicks: 2, maxBackgroundGapSec: 60, maxDriftMs: 0 });
  });

  it('counts sends by result, in and out of the background, and ack round trips', () => {
    expect(s.sends.byResult).toEqual({ ok: 1, 'timed out': 1 });
    expect(s.sends.backgroundByResult).toEqual({ 'timed out': 1 });
    expect(s.sends.skipped).toEqual({ not_ready: 1 });
    expect(s.sends.ackRttMs).toEqual({ p50: 120, p95: 120, max: 120 });
  });

  it('reports what arrived from each peer and how late', () => {
    expect(s.received.from.bbbbbbbb).toEqual({ count: 2, background: 1, maxGapSec: 13, lagMsP50: 200, lagMsP95: 500, lagMsMax: 500 });
  });

  it('says how long a peer had been silent when Presence noticed', () => {
    expect(s.presence.leaves).toEqual([{ key: 'bbbbbbbb', at: 75000, silentSec: 55 }]);
  });

  it('tracks socket downtime, closes and token renewal', () => {
    expect(s.socket.disconnectedSec).toBe(20);
    expect(s.socket.closes).toEqual([{ code: 1000, reason: 'heartbeat timeout', at: 80000 }]);
    expect(s.socket.backgroundHeartbeatsSent).toBe(1);
    expect(s.token).toMatchObject({ firstExp: 5000, lastExp: 9000, renewals: 1, authEvents: { TOKEN_REFRESHED: 1 } });
  });

  it('flags ticks where the socket stayed open past token expiry', () => {
    const late = summariseSpike([tick(6000, 'background', 'open', 5000)]);
    expect(late.token.ticksPastExpiryWhileOpen).toBe(1);
  });

  it('measures database-change lag, probes and notes', () => {
    expect(s.postgresChanges).toEqual({ count: 1, lagMsP50: 500, lagMsMax: 500 });
    expect(s.probes).toEqual([{ what: 'public', status: 'SUBSCRIBED', pings: 0, presence: 0, at: 94000 }]);
    expect(s.notes).toEqual([{ text: 'unlocked', at: 95000 }]);
    expect(s.walkPhases).toEqual([{ phase: 'saving', at: 96000 }]);
    expect(formatSpikeSummary(s)).toContain('Walk: saving');
  });

  it('formats every question, even for an empty log', () => {
    const text = formatSpikeSummary(s);
    for (const n of ['1 Location', '2 Socket', '3 Presence', '4 Sends', '5 Token', '6 Timers', '7 Database', '8 Isolation', '9 Ack']) {
      expect(text).toContain(n);
    }
    expect(formatSpikeSummary(summariseSpike([]))).toContain('Ran 0 min');
  });
});

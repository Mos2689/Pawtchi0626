/**
 * Live Walk v2 — Phase A device spike: the log format and its summary.
 *
 * Throwaway. Lives only on the spike/live-walk-a branch.
 *
 * Each phone records what it saw (timers, location batches, the socket, the
 * channel, heartbeats, Presence, Broadcast sends and receipts, the token) and
 * this module turns one phone's log into answers for the nine spike questions
 * in the plan. Pure, so it is tested without a device.
 *
 * Privacy: the log never holds coordinates, routes or tokens. Token expiry is
 * recorded as the `exp` claim only; people are recorded as an 8-character id
 * prefix.
 */

export type SpikeRole = 'walker' | 'viewer';

export type SpikeEventBody =
  | { k: 'start'; room: string; role: SpikeRole; platform: string; build: string; me?: string }
  | { k: 'stop' }
  | { k: 'app'; state: string }
  | { k: 'auth'; event: string; exp: number | null }
  | { k: 'rt'; what: 'open' | 'close' | 'error'; code?: number; reason?: string }
  | { k: 'hb'; status: string; latency?: number }
  | { k: 'ch'; status: string; err?: string }
  | { k: 'tick'; drift: number; conn: string; ch: string; tokExp: number | null; peers: number }
  | { k: 'loc'; accepted: number; fixAge: number | null }
  | { k: 'send'; seq: number; via: string; res: string; rtt: number }
  | { k: 'skip'; seq: number; via: string; why: string }
  | { k: 'recv'; from: string; seq: number; via: string; sentApp: string; sentAt: number }
  | { k: 'pres'; what: 'sync' | 'join' | 'leave'; keys: string[] }
  | { k: 'pgc'; ev: string; from: string; recordedAt: string | null }
  | { k: 'probe'; what: 'public' | 'anon_private'; status: string; pings: number; presence: number }
  | { k: 'walk'; phase: string }
  | { k: 'note'; text: string };

/** `t` wall clock ms, `m` monotonic ms, `a` app state when it happened. */
export type SpikeEvent = SpikeEventBody & { t: number; m: number; a: string };

const isBackground = (state: string) => state !== 'active';

type Interval = { from: number; to: number };

/** Wall-clock intervals the app spent outside `active`. */
export function backgroundIntervals(events: readonly SpikeEvent[]): Interval[] {
  const out: Interval[] = [];
  let openedAt: number | null = null;
  for (const e of events) {
    const bg = isBackground(e.a);
    if (bg && openedAt === null) openedAt = e.t;
    if (!bg && openedAt !== null) {
      out.push({ from: openedAt, to: e.t });
      openedAt = null;
    }
  }
  const last = events[events.length - 1];
  if (openedAt !== null && last) out.push({ from: openedAt, to: last.t });
  return out;
}

function overlapsBackground(from: number, to: number, bg: readonly Interval[]): boolean {
  return bg.some(i => i.from < to && from < i.to);
}

/** Largest gap (ms) between consecutive times; only gaps touching the background when `bg` is given. */
export function maxGap(times: readonly number[], bg?: readonly Interval[]): number | null {
  let best: number | null = null;
  for (let i = 1; i < times.length; i += 1) {
    const from = times[i - 1];
    const to = times[i];
    if (bg && !overlapsBackground(from, to, bg)) continue;
    const gap = to - from;
    if (best === null || gap > best) best = gap;
  }
  return best;
}

export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((x, y) => x - y);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function only<K extends SpikeEvent['k']>(events: readonly SpikeEvent[], k: K): Extract<SpikeEvent, { k: K }>[] {
  return events.filter((e): e is Extract<SpikeEvent, { k: K }> => e.k === k);
}

export interface SpikeSummary {
  room: string | null;
  role: SpikeRole | null;
  platform: string | null;
  build: string | null;
  durationMin: number;
  backgroundMin: number;
  /** Q1 — location callbacks. */
  location: { batches: number; backgroundBatches: number; maxBackgroundGapSec: number | null };
  /** Q2 — socket, channel and heartbeat. */
  socket: {
    opens: number;
    closes: { code: number | null; reason: string | null; at: number }[];
    errors: number;
    disconnectedSec: number;
    channel: Record<string, number>;
    channelErrors: string[];
    heartbeats: Record<string, number>;
    backgroundHeartbeatsSent: number;
    maxBackgroundHeartbeatGapSec: number | null;
  };
  /** Q3 — Presence as seen from this phone. */
  presence: {
    joins: number;
    leaves: { key: string; at: number; silentSec: number | null }[];
  };
  /** Q4 — Broadcast sends from this phone. */
  sends: {
    byResult: Record<string, number>;
    backgroundByResult: Record<string, number>;
    skipped: Record<string, number>;
    ackRttMs: { p50: number | null; p95: number | null; max: number | null };
  };
  /** Q4 (other side) — what this phone received from others. */
  received: {
    from: Record<string, { count: number; background: number; maxGapSec: number | null; lagMsP50: number | null; lagMsP95: number | null; lagMsMax: number | null }>;
  };
  /** Q5 — token renewal. */
  token: {
    firstExp: number | null;
    lastExp: number | null;
    renewals: number;
    authEvents: Record<string, number>;
    ticksPastExpiryWhileOpen: number;
  };
  /** Q6 — JS timers. */
  timers: { ticks: number; backgroundTicks: number; maxBackgroundGapSec: number | null; maxDriftMs: number | null };
  /** Q7 — postgres_changes on the private channel. */
  postgresChanges: { count: number; lagMsP50: number | null; lagMsMax: number | null };
  /** Q8 — isolation probes. */
  probes: { what: string; status: string; pings: number; presence: number; at: number }[];
  /** Walk recording phases, to see whether auto-stop ended the walk while locked. */
  walkPhases: { phase: string; at: number }[];
  notes: { text: string; at: number }[];
}

const sec = (ms: number | null) => (ms === null ? null : Math.round(ms / 100) / 10);

export function summariseSpike(events: readonly SpikeEvent[]): SpikeSummary {
  const start = only(events, 'start')[0] ?? null;
  const first = events[0];
  const last = events[events.length - 1];
  const bg = backgroundIntervals(events);
  const bgMs = bg.reduce((sum, i) => sum + (i.to - i.from), 0);

  const locs = only(events, 'loc');
  const ticks = only(events, 'tick');
  const hbs = only(events, 'hb');
  const rts = only(events, 'rt');
  const chs = only(events, 'ch');
  const sends = only(events, 'send');
  const skips = only(events, 'skip');
  const recvs = only(events, 'recv');
  const pres = only(events, 'pres');
  const auths = only(events, 'auth');
  const pgcs = only(events, 'pgc');

  // Time spent with the socket not open, from the tick that saw it to the next.
  let disconnectedMs = 0;
  ticks.forEach((tick, i) => {
    const next = ticks[i + 1];
    if (next && tick.conn !== 'open') disconnectedMs += next.t - tick.t;
  });

  const sentHeartbeats = hbs.filter(h => h.status === 'sent');

  // How long each leaving key had already been silent when Presence noticed.
  // This phone's own Presence entry also "leaves" whenever its socket drops
  // and rejoins; that is item 2, not someone else going away.
  const leaves = pres
    .filter(p => p.what === 'leave')
    .flatMap(p => p.keys.filter(key => key !== start?.me).map(key => {
      const heard = recvs.filter(r => r.from === key && r.t <= p.t);
      const lastHeard = heard[heard.length - 1];
      return { key, at: p.t, silentSec: lastHeard ? sec(p.t - lastHeard.t) : null };
    }));

  const from: SpikeSummary['received']['from'] = {};
  for (const key of Array.from(new Set(recvs.map(r => r.from)))) {
    const mine = recvs.filter(r => r.from === key);
    const lags = mine.map(r => r.t - r.sentAt);
    from[key] = {
      count: mine.length,
      background: mine.filter(r => r.sentApp !== 'active').length,
      maxGapSec: sec(maxGap(mine.map(r => r.t))),
      lagMsP50: percentile(lags, 50),
      lagMsP95: percentile(lags, 95),
      lagMsMax: lags.length ? Math.max(...lags) : null,
    };
  }

  const exps = ticks.map(tick => tick.tokExp).filter((exp): exp is number => exp !== null);
  let renewals = 0;
  for (let i = 1; i < exps.length; i += 1) if (exps[i] > exps[i - 1]) renewals += 1;

  const ackRtts = sends.filter(s => s.res === 'ok').map(s => s.rtt);
  const pgLags = pgcs
    .filter(p => p.recordedAt !== null && Number.isFinite(Date.parse(p.recordedAt)))
    .map(p => p.t - Date.parse(p.recordedAt as string));

  return {
    room: start?.room ?? null,
    role: start?.role ?? null,
    platform: start?.platform ?? null,
    build: start?.build ?? null,
    durationMin: first && last ? Math.round((last.t - first.t) / 6000) / 10 : 0,
    backgroundMin: Math.round(bgMs / 6000) / 10,
    location: {
      batches: locs.length,
      backgroundBatches: locs.filter(l => isBackground(l.a)).length,
      maxBackgroundGapSec: sec(maxGap(locs.map(l => l.t), bg)),
    },
    socket: {
      opens: rts.filter(r => r.what === 'open').length,
      closes: rts.filter(r => r.what === 'close').map(r => ({ code: r.code ?? null, reason: r.reason ?? null, at: r.t })),
      errors: rts.filter(r => r.what === 'error').length,
      disconnectedSec: Math.round(disconnectedMs / 1000),
      channel: countBy(chs, c => c.status),
      channelErrors: Array.from(new Set(chs.map(c => c.err).filter((err): err is string => !!err))),
      heartbeats: countBy(hbs, h => h.status),
      backgroundHeartbeatsSent: sentHeartbeats.filter(h => isBackground(h.a)).length,
      maxBackgroundHeartbeatGapSec: sec(maxGap(sentHeartbeats.map(h => h.t), bg)),
    },
    presence: {
      joins: pres.filter(p => p.what === 'join').reduce((n, p) => n + p.keys.filter(key => key !== start?.me).length, 0),
      leaves,
    },
    sends: {
      byResult: countBy(sends, s => s.res),
      backgroundByResult: countBy(sends.filter(s => isBackground(s.a)), s => s.res),
      skipped: countBy(skips, s => s.why),
      ackRttMs: { p50: percentile(ackRtts, 50), p95: percentile(ackRtts, 95), max: ackRtts.length ? Math.max(...ackRtts) : null },
    },
    received: { from },
    token: {
      firstExp: exps[0] ?? null,
      lastExp: exps[exps.length - 1] ?? null,
      renewals,
      authEvents: countBy(auths, a => a.event),
      ticksPastExpiryWhileOpen: ticks.filter(tick => tick.tokExp !== null && tick.conn === 'open' && tick.t / 1000 > tick.tokExp).length,
    },
    timers: {
      ticks: ticks.length,
      backgroundTicks: ticks.filter(tick => isBackground(tick.a)).length,
      maxBackgroundGapSec: sec(maxGap(ticks.map(tick => tick.t), bg)),
      maxDriftMs: ticks.length ? Math.max(...ticks.map(tick => tick.drift)) : null,
    },
    postgresChanges: { count: pgcs.length, lagMsP50: percentile(pgLags, 50), lagMsMax: pgLags.length ? Math.max(...pgLags) : null },
    probes: only(events, 'probe').map(p => ({ what: p.what, status: p.status, pings: p.pings, presence: p.presence, at: p.t })),
    walkPhases: only(events, 'walk').map(w => ({ phase: w.phase, at: w.t })),
    notes: only(events, 'note').map(n => ({ text: n.text, at: n.t })),
  };
}

const clock = (t: number) => new Date(t).toISOString().slice(11, 19);
const show = (value: unknown) => (value === null || value === undefined ? '–' : String(value));
const counts = (record: Record<string, number>) =>
  Object.keys(record).length ? Object.entries(record).map(([k, n]) => `${k} ${n}`).join(', ') : 'none';

/** Plain text, sized to paste into a chat. */
export function formatSpikeSummary(s: SpikeSummary): string {
  const lines: string[] = [];
  lines.push(`Live Walk spike — ${show(s.platform)} build ${show(s.build)} — room ${show(s.room)} as ${show(s.role)}`);
  lines.push(`Ran ${s.durationMin} min, ${s.backgroundMin} min in the background (locked or switched away).`);
  lines.push('');
  lines.push(`1 Location: ${s.location.batches} batches, ${s.location.backgroundBatches} in background; longest background gap ${show(s.location.maxBackgroundGapSec)} s`);
  lines.push(`2 Socket: ${s.socket.opens} opens, ${s.socket.closes.length} closes, ${s.socket.errors} errors, ${s.socket.disconnectedSec} s not open`);
  for (const close of s.socket.closes) lines.push(`    close ${clock(close.at)} code ${show(close.code)} ${show(close.reason)}`);
  lines.push(`  Channel: ${counts(s.socket.channel)}`);
  for (const err of s.socket.channelErrors) lines.push(`    channel error: ${err}`);
  lines.push(`  Heartbeats: ${counts(s.socket.heartbeats)}; ${s.socket.backgroundHeartbeatsSent} sent in background; longest background gap ${show(s.socket.maxBackgroundHeartbeatGapSec)} s`);
  lines.push(`3 Presence: ${s.presence.joins} joins, ${s.presence.leaves.length} leaves`);
  for (const leave of s.presence.leaves) lines.push(`    ${leave.key} left ${clock(leave.at)}, silent ${show(leave.silentSec)} s before`);
  lines.push(`4 Sends: ${counts(s.sends.byResult)} (background: ${counts(s.sends.backgroundByResult)}); skipped ${counts(s.sends.skipped)}`);
  for (const [key, r] of Object.entries(s.received.from)) {
    lines.push(`  From ${key}: ${r.count} received (${r.background} sent from background), longest gap ${show(r.maxGapSec)} s, lag p50 ${show(r.lagMsP50)} / p95 ${show(r.lagMsP95)} / max ${show(r.lagMsMax)} ms`);
  }
  lines.push(`5 Token: exp ${show(s.token.firstExp)} → ${show(s.token.lastExp)}, ${s.token.renewals} renewals, auth events ${counts(s.token.authEvents)}, ${s.token.ticksPastExpiryWhileOpen} ticks past expiry with the socket open`);
  lines.push(`6 Timers: ${s.timers.ticks} ticks, ${s.timers.backgroundTicks} in background; longest background gap ${show(s.timers.maxBackgroundGapSec)} s; max drift ${show(s.timers.maxDriftMs)} ms`);
  lines.push(`7 Database changes on the private channel: ${s.postgresChanges.count}, lag p50 ${show(s.postgresChanges.lagMsP50)} / max ${show(s.postgresChanges.lagMsMax)} ms`);
  lines.push(`8 Isolation probes: ${s.probes.length ? '' : 'none run'}`);
  for (const p of s.probes) lines.push(`    ${p.what} ${clock(p.at)}: ${p.status}, ${p.pings} pings, ${p.presence} presence entries seen`);
  lines.push(`9 Ack round trip: p50 ${show(s.sends.ackRttMs.p50)} / p95 ${show(s.sends.ackRttMs.p95)} / max ${show(s.sends.ackRttMs.max)} ms`);
  if (s.walkPhases.length) {
    lines.push('');
    lines.push(`Walk: ${s.walkPhases.map(w => `${w.phase} ${clock(w.at)}`).join(' → ')}`);
  }
  if (s.notes.length) {
    lines.push('');
    lines.push('Notes:');
    for (const note of s.notes) lines.push(`    ${clock(note.at)} ${note.text}`);
  }
  return lines.join('\n');
}

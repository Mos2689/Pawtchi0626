/**
 * Live Walk v2 — Phase A device spike: the recorder.
 *
 * Throwaway, TestFlight only: DELETE before any App Store release. Reachable
 * only by typing pawtchi://dev-live-spike, and does nothing until Start is
 * pressed. The lock is the server's: its room refuses every account not in
 * private.live_spike_testers, so anyone else sees a channel error. (A PostHog
 * flag gate was tried first and never opened on device — removed rather than
 * debugged, since the server list already does the job.)
 * Runbook: supabase/spike/RUNBOOK.md.
 *
 * While running it holds one private Realtime channel, `spike:<room>`, with
 * Broadcast, Presence and (when a meetup id is given) that meetup's
 * live-location database changes, and writes down everything that happens to
 * it: timers, location batches, socket and channel state, heartbeats, token
 * expiry, Presence, and every ping sent and received. The summary in
 * liveSpikeSummary.ts turns that into answers for the plan's nine questions.
 *
 * It observes the walk recorder (useWalkStore) and never drives it: start a
 * walk the normal way, then start the spike.
 *
 * The log never holds coordinates, routes or tokens.
 */

import { AppState, Platform, Share, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { create } from 'zustand';
import { RealtimeClient, type RealtimeChannel } from '@supabase/supabase-js';

import { supabase } from '../supabase';
import { currentUserId } from '../sessionUser';
import { useWalkStore } from '../../store/useWalkStore';
import {
  formatSpikeSummary,
  summariseSpike,
  type SpikeEvent,
  type SpikeEventBody,
  type SpikeRole,
} from './liveSpikeSummary';


const TICK_MS = 5_000;
const LOCATION_PING_MIN_GAP_MS = 2_000;
const FLUSH_MS = 15_000;
const PROBE_MS = 45_000;
const ROOM = /^[a-z0-9-]{1,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface SpikeView {
  running: boolean;
  runId: string | null;
  room: string | null;
  me: string | null;
  conn: string;
  channel: string;
  peers: string[];
  sent: number;
  failed: number;
  skipped: number;
  received: number;
  dbChanges: number;
  tokenExp: number | null;
  probing: string | null;
  lines: string[];
}

const IDLE: SpikeView = {
  running: false,
  runId: null,
  room: null,
  me: null,
  conn: '–',
  channel: '–',
  peers: [],
  sent: 0,
  failed: 0,
  skipped: 0,
  received: 0,
  dbChanges: 0,
  tokenExp: null,
  probing: null,
  lines: [],
};

export const useLiveSpike = create<SpikeView>(() => ({ ...IDLE }));

// ── Log ────────────────────────────────────────────────────────────────────

const dir = () => new Directory(Paths.document, 'live-spike');
let unflushed: SpikeEvent[] = [];
let chunk = 0;

function monotonic(): number {
  return Math.round(globalThis.performance?.now?.() ?? Date.now());
}

function describe(e: SpikeEvent): string {
  const { t, m: _m, a, k, ...rest } = e;
  const time = new Date(t).toISOString().slice(11, 19);
  return `${time} ${a === 'active' ? '' : '[bg] '}${k} ${JSON.stringify(rest)}`;
}

/** When the log last reached the phone's storage. */
let lastFlushAt = 0;
/** Write at least this often, on any event — not only from the timer. */
const FLUSH_EVERY_MS = 5_000;

function log(body: SpikeEventBody): void {
  const e = { ...body, t: Date.now(), m: monotonic(), a: AppState.currentState ?? 'unknown' } as SpikeEvent;
  unflushed.push(e);
  useLiveSpike.setState(s => ({ lines: [describe(e), ...s.lines].slice(0, 40) }));
  // A locked Android runs no timers, and may close the app at any moment, so
  // every event that does get to run also saves what is waiting.
  if (e.t - lastFlushAt >= FLUSH_EVERY_MS || e.a !== 'active') flush();
}

function flush(): void {
  const runId = useLiveSpike.getState().runId;
  if (!runId || unflushed.length === 0) return;
  const batch = unflushed;
  unflushed = [];
  lastFlushAt = Date.now();
  try {
    const folder = dir();
    folder.create({ intermediates: true, idempotent: true });
    const file = new File(folder, `${runId}-${String(chunk).padStart(4, '0')}.jsonl`);
    if (!file.exists) file.create();
    file.write(batch.map(e => JSON.stringify(e)).join('\n') + '\n');
    chunk += 1;
  } catch {
    // Keep the events for the next attempt rather than losing them.
    unflushed = batch.concat(unflushed);
  }
}

/** Every event of a run, from disk plus whatever is still in memory. */
export async function readRun(runId: string): Promise<SpikeEvent[]> {
  const folder = dir();
  if (!folder.exists) return [];
  const files = folder
    .list()
    .filter((entry): entry is File => entry instanceof File && entry.name.startsWith(`${runId}-`))
    .sort((x, y) => x.name.localeCompare(y.name));
  const events: SpikeEvent[] = [];
  for (const file of files) {
    for (const line of (await file.text()).split('\n')) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as SpikeEvent);
      } catch {
        // A torn final line from a killed process; skip it.
      }
    }
  }
  if (useLiveSpike.getState().runId === runId) events.push(...unflushed);
  return events;
}

/** Run ids on disk, newest first. */
export function listRuns(): string[] {
  const folder = dir();
  if (!folder.exists) return [];
  const ids = new Set<string>();
  for (const entry of folder.list()) {
    const match = entry instanceof File ? /^(.*)-\d{4}\.jsonl$/.exec(entry.name) : null;
    if (match) ids.add(match[1]);
  }
  return Array.from(ids).sort().reverse();
}

export async function shareSummary(runId: string): Promise<void> {
  const text = formatSpikeSummary(summariseSpike(await readRun(runId)));
  await Share.share({ message: text });
}

export async function shareFullLog(runId: string): Promise<void> {
  const events = await readRun(runId);
  const out = new File(Paths.cache, `live-spike-${runId}.jsonl`);
  if (out.exists) out.delete();
  out.create();
  out.write(events.map(e => JSON.stringify(e)).join('\n') + '\n');
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(out.uri, { mimeType: 'text/plain', dialogTitle: 'Live walk spike log' });
  }
}

export function deleteAllRuns(): void {
  const folder = dir();
  if (folder.exists) folder.delete();
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** The `exp` claim of a JWT; never the token itself. */
export function tokenExp(jwt: string | null): number | null {
  if (!jwt) return null;
  try {
    const part = jwt.split('.')[1];
    if (!part) return null;
    const base64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    const exp = (JSON.parse(globalThis.atob(base64)) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

const shortId = (id: unknown) => (typeof id === 'string' ? id.slice(0, 8) : '?');

function runIdFor(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}-${Platform.OS}`;
}

/** The meetup this phone is recording a leg of, if any. */
export function suggestedMeetup(): string {
  return useWalkStore.getState().marker?.trail?.walkId ?? '';
}

// ── Run ────────────────────────────────────────────────────────────────────

type Cleanup = () => void;
let cleanups: Cleanup[] = [];
let channel: RealtimeChannel | null = null;
let seq = 0;

function realtimeReady(ch: RealtimeChannel): boolean {
  return supabase.realtime.isConnected() && ch.state === 'joined';
}

async function ping(via: string): Promise<void> {
  const ch = channel;
  const me = useLiveSpike.getState().me;
  if (!ch || !me) return;
  seq += 1;
  const mine = seq;
  // The SDK quietly falls back to an HTTP request when the socket or channel
  // is not ready. The real design must never do that, so neither does this.
  if (!realtimeReady(ch)) {
    log({ k: 'skip', seq: mine, via, why: supabase.realtime.isConnected() ? `channel_${ch.state}` : 'socket' });
    useLiveSpike.setState(s => ({ skipped: s.skipped + 1 }));
    return;
  }
  const started = monotonic();
  let res: string;
  try {
    res = await ch.send({
      type: 'broadcast',
      event: 'ping',
      payload: { from: me, seq: mine, via, app: AppState.currentState ?? 'unknown', at: Date.now() },
    });
  } catch {
    res = 'threw';
  }
  log({ k: 'send', seq: mine, via, res, rtt: monotonic() - started });
  useLiveSpike.setState(s => (res === 'ok' ? { sent: s.sent + 1 } : { failed: s.failed + 1 }));
}

export async function startSpike(room: string, role: SpikeRole, meetupId: string | null): Promise<void> {
  if (useLiveSpike.getState().running) return;
  if (!ROOM.test(room)) throw new Error('Room: 1–64 lowercase letters, digits or dashes.');
  if (meetupId && !UUID.test(meetupId)) throw new Error('Meetup id: leave it empty, or use the id of a meetup you are in.');
  const userId = await currentUserId();
  if (!userId) throw new Error('Sign in first.');

  const me = shortId(userId);
  const runId = runIdFor(new Date());
  unflushed = [];
  chunk = 0;
  seq = 0;
  useLiveSpike.setState({ ...IDLE, running: true, runId, room, me });
  log({ k: 'start', room, role, platform: Platform.OS, build: Application.nativeBuildVersion ?? '?', me });
  if (meetupId) log({ k: 'note', text: `database changes from meetup ${shortId(meetupId)}` });

  // App state.
  const appSub: NativeEventSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
    log({ k: 'app', state });
    if (state !== 'active') flush();
  });
  cleanups.push(() => appSub.remove());

  // Auth events (never the token).
  const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
    log({ k: 'auth', event, exp: session?.expires_at ?? null });
  });
  cleanups.push(() => authSub.subscription.unsubscribe());

  // Socket lifecycle and heartbeats.
  const rt = supabase.realtime;
  const onOpen = () => log({ k: 'rt', what: 'open' });
  const onClose = (event: { code?: number; reason?: string } | undefined) =>
    log({ k: 'rt', what: 'close', code: event?.code, reason: event?.reason });
  const onError = () => log({ k: 'rt', what: 'error' });
  rt.stateChangeCallbacks.open.push(onOpen);
  rt.stateChangeCallbacks.close.push(onClose);
  rt.stateChangeCallbacks.error.push(onError);
  cleanups.push(() => {
    rt.stateChangeCallbacks.open = rt.stateChangeCallbacks.open.filter(cb => cb !== onOpen);
    rt.stateChangeCallbacks.close = rt.stateChangeCallbacks.close.filter(cb => cb !== onClose);
    rt.stateChangeCallbacks.error = rt.stateChangeCallbacks.error.filter(cb => cb !== onError);
  });
  rt.onHeartbeat((status, latency) => log({ k: 'hb', status, latency }));
  cleanups.push(() => rt.onHeartbeat(() => {}));

  // The room.
  const ch = supabase.channel(`spike:${room}`, {
    config: { private: true, broadcast: { self: false, ack: true }, presence: { key: me } },
  });
  channel = ch;
  ch.on('broadcast', { event: 'ping' }, ({ payload }) => {
    const p = (payload ?? {}) as Record<string, unknown>;
    log({
      k: 'recv',
      from: shortId(p.from),
      seq: typeof p.seq === 'number' ? p.seq : -1,
      via: typeof p.via === 'string' ? p.via : '?',
      sentApp: typeof p.app === 'string' ? p.app : '?',
      sentAt: typeof p.at === 'number' ? p.at : 0,
    });
    useLiveSpike.setState(s => ({ received: s.received + 1 }));
  });
  const peers = () => Object.keys(ch.presenceState()).filter(key => key !== me);
  ch.on('presence', { event: 'sync' }, () => {
    log({ k: 'pres', what: 'sync', keys: Object.keys(ch.presenceState()) });
    useLiveSpike.setState({ peers: peers() });
  });
  ch.on('presence', { event: 'join' }, ({ key }) => log({ k: 'pres', what: 'join', keys: [key] }));
  ch.on('presence', { event: 'leave' }, ({ key }) => log({ k: 'pres', what: 'leave', keys: [key] }));
  if (meetupId) {
    // Q7: database changes delivered over a private channel. Authorised by the
    // table's own RLS, not by the spike policy.
    const onRow = (payload: { eventType: string; new: Record<string, unknown> }) => {
      const row = payload.new ?? {};
      log({
        k: 'pgc',
        ev: payload.eventType,
        from: shortId(row.user_id),
        recordedAt: typeof row.recorded_at === 'string' ? row.recorded_at : null,
      });
      useLiveSpike.setState(s => ({ dbChanges: s.dbChanges + 1 }));
    };
    const filter = `walk_id=eq.${meetupId}`;
    ch.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'community_live_locations', filter }, onRow);
    ch.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'community_live_locations', filter }, onRow);
  }
  ch.subscribe((status, err) => {
    log({ k: 'ch', status, err: err?.message });
    if (status === 'SUBSCRIBED') {
      // Presence does not survive a rejoin, so it is tracked on every one.
      void ch.track({ role, platform: Platform.OS, since: Date.now() })
        .then(res => log({ k: 'ch', status: `track_${res}` }))
        .catch(() => log({ k: 'ch', status: 'track_threw' }));
    }
  });
  cleanups.push(() => {
    channel = null;
    void ch.untrack().catch(() => {});
    void supabase.removeChannel(ch);
  });

  // Location batches from the walk recorder (observed, never driven).
  let lastLocationPing = 0;
  const unsubscribeWalk = useWalkStore.subscribe((state, prev) => {
    if (state.phase !== prev.phase) log({ k: 'walk', phase: state.phase });
    if (state.session && state.session !== prev.session) {
      const fix = state.session.lastAccepted?.timestamp;
      log({ k: 'loc', accepted: state.session.acceptedCount, fixAge: fix ? Date.now() - fix : null });
      if (Date.now() - lastLocationPing >= LOCATION_PING_MIN_GAP_MS) {
        lastLocationPing = Date.now();
        void ping('loc');
      }
    }
  });
  cleanups.push(unsubscribeWalk);
  log({ k: 'walk', phase: useWalkStore.getState().phase });

  // Q6: does a JS timer fire while locked? Measured as drift on a monotonic clock.
  let expected = monotonic() + TICK_MS;
  const tick = setInterval(() => {
    const now = monotonic();
    const drift = now - expected;
    expected = now + TICK_MS;
    const exp = tokenExp(supabase.realtime.accessTokenValue);
    log({ k: 'tick', drift, conn: supabase.realtime.connectionState(), ch: ch.state, tokExp: exp, peers: peers().length });
    useLiveSpike.setState({ conn: supabase.realtime.connectionState(), channel: ch.state, tokenExp: exp });
    void ping('timer');
  }, TICK_MS);
  cleanups.push(() => clearInterval(tick));

  const flusher = setInterval(flush, FLUSH_MS);
  cleanups.push(() => clearInterval(flusher));
}

export function stopSpike(): void {
  if (!useLiveSpike.getState().running) return;
  log({ k: 'stop' });
  const pending = cleanups;
  cleanups = [];
  for (const cleanup of pending.reverse()) {
    try {
      cleanup();
    } catch {
      // Best effort: a failed cleanup must not keep the others from running.
    }
  }
  flush();
  useLiveSpike.setState({ running: false, conn: '–', channel: '–', peers: [] });
}

export function note(text: string): void {
  if (useLiveSpike.getState().running) log({ k: 'note', text });
}

export function manualPing(): void {
  void ping('manual');
}

/**
 * Q8: from a separate, signed-out socket, join the same topic and count what
 * leaks. `public` joins without `private`; `anon_private` asks for the private
 * channel with no account. Both should see nothing (and the second should be
 * refused). Run while the other phone, or this one, is pinging.
 */
export async function probe(what: 'public' | 'anon_private'): Promise<void> {
  const { running, room } = useLiveSpike.getState();
  if (!running || !room || useLiveSpike.getState().probing) return;
  useLiveSpike.setState({ probing: what });
  const url = new URL('realtime/v1', `${process.env.EXPO_PUBLIC_SUPABASE_URL ?? ''}/`);
  url.protocol = url.protocol.replace('http', 'ws');
  const client = new RealtimeClient(url.href, { params: { apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '' } });
  const ch = client.channel(`spike:${room}`, { config: { private: what === 'anon_private', broadcast: { self: false } } });
  let pings = 0;
  let status = 'pending';
  ch.on('broadcast', { event: 'ping' }, () => { pings += 1; });
  ch.on('presence', { event: 'sync' }, () => {});
  ch.subscribe((s, err) => { status = err ? `${s}: ${err.message}` : s; });
  await new Promise(resolve => setTimeout(resolve, PROBE_MS));
  const presence = Object.keys(ch.presenceState()).length;
  log({ k: 'probe', what, status, pings, presence });
  try {
    await client.removeChannel(ch);
    client.disconnect();
  } catch {
    // The probe socket is disposable.
  }
  useLiveSpike.setState({ probing: null });
}

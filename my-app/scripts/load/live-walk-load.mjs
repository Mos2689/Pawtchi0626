#!/usr/bin/env node
// Live walk load test: N simulated phones walk one meetup walk together.
//
// Each simulated phone does what a real walker's phone does on build 104:
//   • joins the walk (join_community_walk_v2) and takes a live session
//     (begin_live_session)
//   • opens the private room `walk:<id>` with Presence and the five walk
//     database-change bindings, exactly as lib/community/liveLink.ts
//   • broadcast walk: a `pos` every 10 s while moving + a checkpoint RPC every
//     60 s; db walk: publish_live_location every 12 s
//   • re-reads live_walk_positions every 60 s, like the live map
// It follows whatever transport the walk already has; the host's phone
// decided that when it started the walk.
//
// Safety:
//   • refuses any walk whose title does not start with "Load test"
//   • aborts on its own when the server degrades (RPC p95 > 3 s or > 5 %
//     errors over the last minute) — production is shared with real people
//   • on exit every simulated walker is marked finished and leaves the room
//
// Usage (from my-app/):
//   node scripts/load/live-walk-load.mjs --accounts scripts/load/accounts.json \
//     --walk <walk uuid> --phones 25 --minutes 10 --ramp 60
//
// accounts.json (never commit it; scripts/load/accounts*.json is gitignored):
//   [{ "email": "loadtest+01@…", "password": "…" }, …]
// Every account must already be a member of the load-test meetup (a dog is
// optional) — setup-test-accounts.mjs does both. The Supabase URL and anon key
// come from my-app/.env.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// ── Arguments and config ────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => {
    if (a.startsWith('--')) pairs.push([a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]);
    return pairs;
  }, []),
);
const WALK = args.walk;
const PHONES = Number(args.phones ?? 10);
const MINUTES = Number(args.minutes ?? 10);
const RAMP_S = Number(args.ramp ?? 60);
const ACCOUNTS = args.accounts ?? 'scripts/load/accounts.json';
const ABORT_P95_MS = Number(args['abort-p95'] ?? 3000);
const ABORT_ERROR_RATE = Number(args['abort-errors'] ?? 0.05);
if (!WALK) { console.error('--walk <uuid> is required'); process.exit(2); }

function env(name) {
  if (process.env[name]) return process.env[name];
  if (existsSync('.env')) {
    const line = readFileSync('.env', 'utf8').split(/\r?\n/).find(l => l.startsWith(name + '='));
    if (line) return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '');
  }
  return undefined;
}
const URL_ = env('EXPO_PUBLIC_SUPABASE_URL');
const ANON = env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
if (!URL_ || !ANON) { console.error('EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY not found (run from my-app/)'); process.exit(2); }

const accounts = JSON.parse(readFileSync(ACCOUNTS, 'utf8'));
if (accounts.length < PHONES) { console.error(`accounts.json has ${accounts.length} accounts, --phones asks for ${PHONES}`); process.exit(2); }

// ── Metrics ─────────────────────────────────────────────────────────────────
const samples = []; // { t, kind, ms, ok }
const counters = { posOk: 0, posTimeout: 0, posError: 0, posNotReady: 0, received: 0, changes: 0, presenceSyncs: 0, channelErrors: 0, channelClosed: 0, joined: 0 };
const record = (kind, ms, ok) => samples.push({ t: Date.now(), kind, ms, ok });
const pct = (list, p) => { if (!list.length) return null; const s = [...list].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };

function summarise(since = 0) {
  const by = {};
  for (const s of samples) {
    if (s.t < since) continue;
    (by[s.kind] ??= { n: 0, errors: 0, ms: [] });
    by[s.kind].n += 1;
    if (!s.ok) by[s.kind].errors += 1;
    by[s.kind].ms.push(s.ms);
  }
  return Object.fromEntries(Object.entries(by).map(([k, v]) => [k, {
    n: v.n, errors: v.errors, p50: pct(v.ms, 0.5), p95: pct(v.ms, 0.95), p99: pct(v.ms, 0.99), max: pct(v.ms, 1),
  }]));
}

async function timed(kind, fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    const ok = !result?.error;
    record(kind, performance.now() - t0, ok);
    return result;
  } catch (error) {
    record(kind, performance.now() - t0, false);
    return { error };
  }
}

// ── Geometry: a slow wander around the meeting point ────────────────────────
function encodePolyline(points) {
  let out = '', lastLat = 0, lastLng = 0;
  const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return s + String.fromCharCode(v + 63); };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5), lng = Math.round(p.lng * 1e5);
    out += enc(lat - lastLat) + enc(lng - lastLng);
    lastLat = lat; lastLng = lng;
  }
  return out;
}
const BASE = { lat: Number(args.lat ?? -28.0716), lng: Number(args.lng ?? 153.4410) };
function step(p, bearing, metres) {
  const dLat = (metres * Math.cos(bearing)) / 111_320;
  const dLng = (metres * Math.sin(bearing)) / (111_320 * Math.cos((p.lat * Math.PI) / 180));
  return { lat: p.lat + dLat, lng: p.lng + dLng };
}

// ── One simulated phone ─────────────────────────────────────────────────────
class Phone {
  constructor(index, account) {
    this.index = index;
    this.account = account;
    this.client = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: true } });
    this.timers = [];
    this.path = [step(BASE, Math.random() * 2 * Math.PI, 30 + Math.random() * 120)];
    this.bearing = Math.random() * 2 * Math.PI;
    this.sentIndex = 0;
    this.seq = 0;
    this.gen = null;
    this.status = 'starting';
  }

  async start() {
    const { data, error } = await timed('sign_in', () => this.client.auth.signInWithPassword(this.account));
    if (error || !data?.user) throw new Error(`phone ${this.index}: sign-in failed`);
    this.user = data.user.id;

    const pets = await this.client.from('pets').select('id').eq('owner_id', this.user).eq('species', 'dog').limit(1);
    const petIds = (pets.data ?? []).map(p => p.id);

    const join = await timed('join_community_walk_v2', () => this.client.rpc('join_community_walk_v2', {
      p_walk_id: WALK, p_pet_ids: petIds, p_share_location: true, p_start: false, p_live_protocol: 2, p_request_broadcast: false,
    }));
    if (join.error) throw new Error(`phone ${this.index}: join failed — ${join.error.message}`);
    this.transport = join.data?.live_transport === 'broadcast' ? 'broadcast' : 'db';

    const begin = await timed('begin_live_session', () => this.client.rpc('begin_live_session', { p_walk_id: WALK, p_start_token: randomUUID() }));
    if (begin.error || begin.data?.status !== 'ok') throw new Error(`phone ${this.index}: no live session — ${begin.error?.message ?? begin.data?.status}`);
    this.gen = begin.data.gen;

    await this.openRoom();
    await this.readPositions();

    // A fix every 5 s at walking pace, with a gentle drift in direction.
    this.every(5_000, () => {
      this.bearing += (Math.random() - 0.5) * 0.6;
      this.path.push(step(this.path[this.path.length - 1], this.bearing, 5 * (1.1 + Math.random() * 0.5)));
    });
    if (this.transport === 'broadcast') {
      this.every(10_000, () => this.sendPos());
      this.every(60_000, () => this.checkpoint());
    } else {
      this.every(12_000, () => this.checkpoint());
    }
    this.every(60_000, () => this.readPositions());
    this.status = 'walking';
  }

  every(ms, fn) {
    // Phones are not in lockstep: random phase, then the fixed cadence.
    const t = setTimeout(() => { fn(); this.timers.push(setInterval(fn, ms)); }, Math.random() * ms);
    this.timers.push(t);
  }

  openRoom() {
    return new Promise(resolve => {
      const channel = this.client.channel(`walk:${WALK}`, {
        config: { private: true, broadcast: { self: false, ack: true }, presence: { key: this.user } },
      });
      for (const event of ['pos', 'snap', 'req', 'endhint']) channel.on('broadcast', { event }, () => { counters.received += 1; });
      channel.on('presence', { event: 'sync' }, () => { counters.presenceSyncs += 1; });
      for (const [table, event, column] of [
        ['community_live_locations', 'INSERT', 'walk_id'], ['community_live_locations', 'UPDATE', 'walk_id'],
        ['community_walk_attendance', '*', 'walk_id'], ['community_shared_media', '*', 'walk_id'], ['community_walks', 'UPDATE', 'id'],
      ]) channel.on('postgres_changes', { event, schema: 'public', table, filter: `${column}=eq.${WALK}` }, () => { counters.changes += 1; });
      const t0 = performance.now();
      let settled = false;
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          if (!settled) { settled = true; record('room_join', performance.now() - t0, true); counters.joined += 1; resolve(); }
          void channel.track({ role: 'walker' });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          counters.channelErrors += 1;
          if (!settled) { settled = true; record('room_join', performance.now() - t0, false); resolve(); }
        } else if (status === 'CLOSED') {
          counters.channelClosed += 1;
        }
      });
      this.channel = channel;
    });
  }

  async sendPos() {
    if (!this.channel || this.channel.state !== 'joined' || !this.client.realtime.isConnected()) { counters.posNotReady += 1; return; }
    const head = this.path[this.path.length - 1];
    const from = Math.max(this.sentIndex, this.path.length - 20);
    const pts = this.path.slice(from);
    this.seq += 1;
    const payload = {
      v: 2, u: this.user, gen: this.gen, s: this.seq, atS: null, fxAge: 1000,
      la: Math.round(head.lat * 1e6) / 1e6, lo: Math.round(head.lng * 1e6) / 1e6,
      obAge: 1000, oa: 8, pi: from, pts: encodePolyline(pts), rv: from + pts.length,
    };
    const t0 = performance.now();
    let result;
    try { result = await this.channel.send({ type: 'broadcast', event: 'pos', payload }); } catch { result = 'error'; }
    const ms = performance.now() - t0;
    if (result === 'ok') { counters.posOk += 1; record('broadcast_pos', ms, true); }
    else if (result === 'timed out') { counters.posTimeout += 1; record('broadcast_pos', ms, false); }
    else { counters.posError += 1; record('broadcast_pos', ms, false); }
    this.sentIndex = this.path.length;
  }

  async checkpoint() {
    const head = this.path[this.path.length - 1];
    this.seq += 1;
    const path = this.path.length > 160
      ? this.path.filter((_, i) => i % Math.ceil(this.path.length / 160) === 0).concat([head])
      : this.path;
    const res = await timed('publish_live_location', () => this.client.rpc('publish_live_location', {
      p_walk_id: WALK, p_gen: this.gen, p_seq: this.seq, p_lat: head.lat, p_lng: head.lng, p_accuracy: 8,
      p_fix_age_ms: 1000, p_obs_age_ms: 1000, p_sent_at: new Date().toISOString(),
      p_route_version: this.path.length, p_path: path.map(p => ({ lat: p.lat, lng: p.lng })),
    }));
    const status = res.data?.status;
    if (status && status !== 'ok' && status !== 'stale') { this.status = `stopped:${status}`; this.stopTimers(); }
  }

  readPositions() {
    return timed('live_walk_positions', () => this.client.rpc('live_walk_positions', { p_walk_id: WALK }));
  }

  stopTimers() {
    for (const t of this.timers) { clearTimeout(t); clearInterval(t); }
    this.timers = [];
  }

  async stop() {
    this.stopTimers();
    try {
      if (this.user) {
        const now = new Date().toISOString();
        await this.client.from('community_walk_attendance')
          .upsert({ walk_id: WALK, user_id: this.user, status: 'finished', finished_at: now, updated_at: now }, { onConflict: 'walk_id,user_id' });
      }
      if (this.channel) await this.client.removeChannel(this.channel);
      await this.client.auth.signOut();
    } catch { /* best effort */ }
  }
}

// ── Run ─────────────────────────────────────────────────────────────────────
const phones = [];
let aborted = null;
const started = Date.now();
const fmt = s => s ? `${s.n} req, p50 ${s.p50} ms, p95 ${s.p95} ms, ${s.errors} err` : '—';

async function guardWalk() {
  const probe = createClient(URL_, ANON, { auth: { persistSession: false } });
  const { error } = await probe.auth.signInWithPassword(accounts[0]);
  if (error) throw new Error('first account cannot sign in');
  const { data, error: e2 } = await probe.from('community_walks').select('title, state, live_transport').eq('id', WALK).maybeSingle();
  await probe.auth.signOut();
  if (e2 || !data) throw new Error('walk not visible to the first account (is it a member of the load-test meetup?)');
  if (!/^load test/i.test(data.title ?? '')) throw new Error(`walk title "${data.title}" does not start with "Load test" — refusing to load a real walk`);
  if (data.state !== 'active') throw new Error(`walk is ${data.state}; start it from the host phone first`);
  return data;
}

async function finish(reason) {
  if (finish.done) return;
  finish.done = true;
  clearInterval(ticker);
  console.log(`\nStopping (${reason}); marking ${phones.length} walkers finished…`);
  await Promise.allSettled(phones.map(p => p.stop()));
  const report = {
    walk: WALK, phones: phones.length, transport: phones[0]?.transport ?? null,
    minutes: Math.round((Date.now() - started) / 6000) / 10, aborted, counters, totals: summarise(0),
  };
  const out = `scripts/load/report-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.totals, null, 2));
  console.log(`Report: ${out}`);
  process.exit(aborted ? 1 : 0);
}

const ticker = setInterval(() => {
  const since = Date.now() - 60_000;
  const recent = summarise(since);
  const rpcs = Object.entries(recent).filter(([k]) => !['broadcast_pos', 'room_join', 'sign_in'].includes(k));
  const n = rpcs.reduce((a, [, v]) => a + v.n, 0);
  const errors = rpcs.reduce((a, [, v]) => a + v.errors, 0);
  const worstP95 = Math.max(0, ...rpcs.map(([, v]) => v.p95 ?? 0));
  const walking = phones.filter(p => p.status === 'walking').length;
  console.log(`[${Math.round((Date.now() - started) / 1000)}s] walking ${walking}/${PHONES} · ` +
    `publish ${fmt(recent.publish_live_location)} · read ${fmt(recent.live_walk_positions)} · ` +
    `pos ok ${counters.posOk} timeout ${counters.posTimeout} · received ${counters.received} · changes ${counters.changes}`);
  if (n >= 20 && (worstP95 > ABORT_P95_MS || errors / n > ABORT_ERROR_RATE)) {
    aborted = { at_s: Math.round((Date.now() - started) / 1000), worst_p95_ms: worstP95, error_rate: Math.round((errors / n) * 1000) / 1000 };
    void finish(`server degrading: p95 ${worstP95} ms, errors ${(errors / n * 100).toFixed(1)} %`);
  }
}, 15_000);

process.on('SIGINT', () => void finish('Ctrl-C'));

try {
  const walk = await guardWalk();
  console.log(`Walk "${walk.title}" (${walk.live_transport}). ${PHONES} phones over ${RAMP_S} s, ${MINUTES} min.`);
  for (let i = 0; i < PHONES; i += 1) {
    const phone = new Phone(i, accounts[i]);
    phones.push(phone);
    phone.start().catch(err => { phone.status = 'failed'; console.error(err.message); });
    await new Promise(r => setTimeout(r, (RAMP_S * 1000) / PHONES));
    if (finish.done) break;
  }
  setTimeout(() => void finish('time up'), MINUTES * 60_000);
} catch (err) {
  console.error(err.message);
  await finish('setup failed');
}

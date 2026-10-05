/**
 * Live Walk v2 — the wire format, and the gate everything from outside passes.
 *
 * Four Broadcast events on the private `walk:<id>` room, plus the database
 * rows (from live_walk_positions and from postgres_changes). Every one of them
 * arrives from another phone or a server we do not control the timing of, so
 * every parser here validates completely and returns `null` instead of
 * throwing: a malformed message is dropped, never allowed to break the map.
 *
 *   pos      position + up to 20 new route points (index-aligned)
 *   snap     a whole simplified route (geometry only)
 *   req      "I am missing route points; please send a snap"
 *   endhint  "the host just closed the walk" (a hint: the client re-checks)
 *
 * Identity (`u`) is asserted by the sender. Live Walk v1 trusts the group it
 * was invited into (plan decision 4); the room policy limits who can send at
 * all to members attending the walk.
 *
 * Times: no absolute sender clock crosses devices. `fxAge`/`obAge` are ages
 * measured on the sender, and `atS` is the sender's estimate of SERVER time
 * (lib/community/serverClock.ts), or null while it has none.
 */

import type { GeoPoint } from '../walk/geo';
import { decodePolyline, encodePolyline } from './livePolyline';

export const LIVE_PROTOCOL = 2;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_POS_BYTES = 1024;
export const MAX_DELTA_POINTS = 20;
export const MAX_ROUTE_POINTS = 200;
export const MAX_ROUTE_INDEX = 100_000;
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_SEQ = 2 ** 31;

export const LIVE_EVENTS = ['pos', 'snap', 'req', 'endhint'] as const;
export type LiveEvent = (typeof LIVE_EVENTS)[number];

// ── Wire payloads ────────────────────────────────────────────────────────────

export interface PosPayload {
  v: 2;
  u: string;
  gen: number;
  s: number;
  atS: number | null;
  fxAge: number;
  la: number;
  lo: number;
  obAge: number | null;
  oa: number | null;
  pi: number;
  pts: string;
  rv: number;
}

export interface SnapPayload {
  v: 2;
  u: string;
  gen: number;
  rv: number;
  poly: string;
}

export interface ReqPayload {
  v: 2;
  u: string;
  want: 'all' | string;
}

export interface EndHintPayload {
  v: 2;
  u: string;
}

// ── Parsed messages ─────────────────────────────────────────────────────────

export interface PosUpdate {
  kind: 'pos';
  user: string;
  gen: number;
  seq: number;
  /** Sender's estimate of server time when it sent, or null (uncalibrated). */
  atServer: number | null;
  fixAgeMs: number;
  lat: number;
  lng: number;
  obsAgeMs: number | null;
  obsAccuracy: number | null;
  /** Route index of `points[0]`. */
  pathIndex: number;
  points: GeoPoint[];
  /** Sender's full route length; `pathIndex + points.length`. */
  routeVersion: number;
}

export interface SnapUpdate {
  kind: 'snap';
  user: string;
  gen: number;
  routeVersion: number;
  points: GeoPoint[];
}

export interface CatchUpRequest {
  kind: 'req';
  user: string;
  want: 'all' | string;
}

export interface EndHint {
  kind: 'endhint';
  user: string;
}

export type LiveMessage = PosUpdate | SnapUpdate | CatchUpRequest | EndHint;

/** A position row, from live_walk_positions or postgres_changes. */
export interface LiveRow {
  user: string;
  lat: number;
  lng: number;
  accuracy: number | null;
  path: GeoPoint[];
  /** Server time of the write (ms). Always present. */
  heardAt: number;
  /** Server-derived fix time (ms); null for rows written by older builds. */
  fixAt: number | null;
  /** 0 for rows written by older builds (no ordering metadata). */
  gen: number;
  seq: number;
  /** null for rows written by older builds. */
  routeVersion: number | null;
}

export interface PositionsSnapshot {
  visible: boolean;
  serverNow: number;
  rows: LiveRow[];
  watermarks: Record<string, number>;
}

// ── Primitive checks ────────────────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isUserId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const isNum = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const isLat = (value: unknown): value is number => isNum(value, -90, 90);
const isLng = (value: unknown): value is number => isNum(value, -180, 180);
const isAge = (value: unknown): value is number => isNum(value, 0, MAX_AGE_MS);
const optional = <T>(value: unknown, check: (v: unknown) => v is T): value is T | null =>
  value === null || value === undefined || check(value);

export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function sizeOf(payload: unknown): number {
  try {
    return utf8Length(JSON.stringify(payload) ?? '');
  } catch {
    return Infinity;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTime(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function parsePoints(value: unknown, max: number): GeoPoint[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: GeoPoint[] = [];
  for (const item of value) {
    if (!isRecord(item) || !isLat(item.lat) || !isLng(item.lng)) return null;
    out.push({ lat: item.lat, lng: item.lng });
  }
  return out;
}

// ── Broadcast: parse ────────────────────────────────────────────────────────

/** A Broadcast message from the room, or null if it is anything but valid. */
export function parseLiveMessage(event: unknown, payload: unknown): LiveMessage | null {
  if (typeof event !== 'string' || !isRecord(payload) || payload.v !== LIVE_PROTOCOL) return null;
  if (!isUserId(payload.u)) return null;
  const size = sizeOf(payload);
  if (size > MAX_MESSAGE_BYTES) return null;

  switch (event) {
    case 'pos': {
      const p = payload;
      if (size > MAX_POS_BYTES) return null;
      if (!isInt(p.gen, 1, MAX_SEQ - 1) || !isInt(p.s, 1, MAX_SEQ - 1)) return null;
      if (!optional(p.atS, (v): v is number => isNum(v, 0, 8.64e15))) return null;
      if (!isAge(p.fxAge) || !optional(p.obAge, isAge)) return null;
      if (!isLat(p.la) || !isLng(p.lo)) return null;
      if (!optional(p.oa, (v): v is number => isNum(v, 0, 100_000))) return null;
      if (!isInt(p.pi, 0, MAX_ROUTE_INDEX) || !isInt(p.rv, 0, MAX_ROUTE_INDEX) || p.pi > p.rv) return null;
      if (p.rv - p.pi > MAX_DELTA_POINTS) return null;
      const points = decodePolyline(p.pts, MAX_DELTA_POINTS);
      if (!points || points.length !== p.rv - p.pi) return null;
      return {
        kind: 'pos',
        user: p.u as string,
        gen: p.gen,
        seq: p.s,
        atServer: (p.atS as number | null | undefined) ?? null,
        fixAgeMs: p.fxAge,
        lat: p.la,
        lng: p.lo,
        obsAgeMs: (p.obAge as number | null | undefined) ?? null,
        obsAccuracy: (p.oa as number | null | undefined) ?? null,
        pathIndex: p.pi,
        points,
        routeVersion: p.rv,
      };
    }
    case 'snap': {
      const p = payload;
      if (!isInt(p.gen, 1, MAX_SEQ - 1) || !isInt(p.rv, 0, MAX_ROUTE_INDEX)) return null;
      const points = decodePolyline(p.poly, MAX_ROUTE_POINTS);
      if (!points || points.length > p.rv) return null;
      return { kind: 'snap', user: p.u as string, gen: p.gen, routeVersion: p.rv, points };
    }
    case 'req':
      if (payload.want !== 'all' && !isUserId(payload.want)) return null;
      return { kind: 'req', user: payload.u as string, want: payload.want as string };
    case 'endhint':
      return { kind: 'endhint', user: payload.u as string };
    default:
      return null;
  }
}

// ── Broadcast: build ────────────────────────────────────────────────────────

export function buildPos(input: {
  user: string;
  gen: number;
  seq: number;
  atServer: number | null;
  fixAgeMs: number;
  lat: number;
  lng: number;
  obsAgeMs: number | null;
  obsAccuracy: number | null;
  pathIndex: number;
  points: readonly GeoPoint[];
}): PosPayload {
  const clampAge = (ms: number) => Math.min(MAX_AGE_MS, Math.max(0, Math.round(ms)));
  return {
    v: LIVE_PROTOCOL,
    u: input.user,
    gen: input.gen,
    s: input.seq,
    atS: input.atServer === null ? null : Math.round(input.atServer),
    fxAge: clampAge(input.fixAgeMs),
    // ~0.1 m: more digits are noise from the GPS and bytes on the wire.
    la: Math.round(input.lat * 1e6) / 1e6,
    lo: Math.round(input.lng * 1e6) / 1e6,
    obAge: input.obsAgeMs === null ? null : clampAge(input.obsAgeMs),
    oa: input.obsAccuracy === null ? null : Math.round(input.obsAccuracy * 10) / 10,
    pi: input.pathIndex,
    pts: encodePolyline(input.points),
    rv: input.pathIndex + input.points.length,
  };
}

export function buildSnap(input: { user: string; gen: number; routeVersion: number; points: readonly GeoPoint[] }): SnapPayload {
  return { v: LIVE_PROTOCOL, u: input.user, gen: input.gen, rv: input.routeVersion, poly: encodePolyline(input.points) };
}

export function buildReq(user: string, want: 'all' | string): ReqPayload {
  return { v: LIVE_PROTOCOL, u: user, want };
}

export function buildEndHint(user: string): EndHintPayload {
  return { v: LIVE_PROTOCOL, u: user };
}

// ── Database rows ───────────────────────────────────────────────────────────

/**
 * A community_live_locations row as live_walk_positions or postgres_changes
 * delivers it, or null. The same route bounds as Broadcast apply.
 */
export function parseLiveRow(value: unknown): LiveRow | null {
  if (!isRecord(value)) return null;
  const r = value;
  if (!isUserId(r.user_id) || !isLat(r.lat) || !isLng(r.lng)) return null;
  if (!optional(r.accuracy_m, (v): v is number => isNum(v, 0, 100_000))) return null;
  const path = parsePoints(r.path ?? [], MAX_ROUTE_POINTS);
  if (!path) return null;
  const heardAt = parseTime(r.heard_at);
  if (heardAt === null) return null;
  const fixAt = r.fix_at === null || r.fix_at === undefined ? null : parseTime(r.fix_at);
  if (r.fix_at !== null && r.fix_at !== undefined && fixAt === null) return null;

  const legacy = r.live_gen === null || r.live_gen === undefined;
  if (!legacy) {
    if (!isInt(r.live_gen, 1, MAX_SEQ - 1) || !isInt(r.seq, 1, MAX_SEQ - 1)) return null;
    if (!isInt(r.route_version, 0, MAX_ROUTE_INDEX)) return null;
    if (path.length > r.route_version) return null;
  }
  return {
    user: r.user_id,
    lat: r.lat,
    lng: r.lng,
    accuracy: (r.accuracy_m as number | null | undefined) ?? null,
    path,
    heardAt,
    fixAt,
    gen: legacy ? 0 : (r.live_gen as number),
    seq: legacy ? 0 : (r.seq as number),
    routeVersion: legacy ? null : (r.route_version as number),
  };
}

/** The live_walk_positions answer, or null if it is not one. Bad rows are dropped individually. */
export function parsePositions(value: unknown): PositionsSnapshot | null {
  if (!isRecord(value)) return null;
  const serverNow = parseTime(value.server_now);
  if (serverNow === null || !Array.isArray(value.rows) || !Array.isArray(value.watermarks)) return null;
  const rows = value.rows.map(parseLiveRow).filter((row): row is LiveRow => row !== null);
  const watermarks: Record<string, number> = {};
  for (const mark of value.watermarks) {
    if (isRecord(mark) && isUserId(mark.user_id) && isInt(mark.gen, 0, MAX_SEQ - 1)) {
      watermarks[mark.user_id] = Math.max(watermarks[mark.user_id] ?? 0, mark.gen);
    }
  }
  return { visible: value.status !== 'not_visible', serverNow, rows, watermarks };
}

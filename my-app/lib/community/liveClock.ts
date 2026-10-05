/**
 * Live Walk v2 — the one server-clock estimate this phone keeps.
 *
 * The rules are in serverClock.ts (pure). This holds the single instance, and
 * feeds it from every RPC answer that carries `server_now`: the publisher's
 * begin/publish calls and the live map's position reads all go through
 * `rpcWithClock`, so whichever is running keeps the estimate fresh for both.
 */

import { supabase } from '../supabase';
import type { ReconcileClock } from './liveReconciler';
import {
  addClockSample,
  clockEstimate,
  createServerClock,
  observeClock,
  type ServerClock,
} from './serverClock';

let clock: ServerClock = createServerClock();

const mono = (): number => globalThis.performance?.now?.() ?? Date.now();

function readServerNow(data: unknown): number | null {
  const value = (data as { server_now?: unknown } | null)?.server_now;
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** Record one answer's `server_now`, timed by the round trip that carried it. */
export function noteServerNow(data: unknown, sentMono: number): void {
  const serverNow = readServerNow(data);
  if (serverNow === null) return;
  clock = addClockSample(clock, { serverNow, sentMono, receivedMono: mono(), receivedWall: Date.now() });
}

/** supabase.rpc, plus a clock sample from the answer when it has one. */
export async function rpcWithClock<T = unknown>(
  fn: string,
  args: Record<string, unknown>,
): Promise<{ data: T | null; error: { message: string } | null }> {
  const sent = mono();
  const { data, error } = await supabase.rpc(fn, args);
  if (!error) noteServerNow(data, sent);
  return { data: (data ?? null) as T | null, error: error ? { message: error.message } : null };
}

/** The reconciler's view of time right now: local clock, epoch, offset (or null). */
export function reconcileClockNow(): ReconcileClock {
  clock = observeClock(clock, Date.now(), mono());
  const estimate = clockEstimate(clock, mono());
  return { wall: Date.now(), epoch: clock.epoch, offsetMs: estimate?.offsetMs ?? null };
}

/** This phone's best guess at the server's time now, or null without a calibration. */
export function serverNowEstimate(): number | null {
  const now = reconcileClockNow();
  return now.offsetMs === null ? null : now.wall + now.offsetMs;
}

/** Sign-out: the next account starts uncalibrated. */
export function resetLiveClock(): void {
  clock = createServerClock();
}

/**
 * Live Walk v2 — when a walking phone sends what (pure decisions).
 *
 * Two outlets share ONE sequence counter per (walk, user, gen):
 *
 *   Broadcast `pos` (only on a `broadcast` walk, only while the room is
 *   joined): about every 10 s while new route points exist, a 30 s heartbeat
 *   otherwise, never closer than 5 s. Up to 20 new points ride along; a
 *   larger backlog goes as a `snap` (at most one per 15 s) plus a `pos` with
 *   an empty delta. A catch-up request (`req`) is answered with a `snap`,
 *   coalesced: requests during the cooldown get exactly one snap when it ends.
 *
 *   The checkpoint RPC (publish_live_location): every 60 s while Broadcast is
 *   healthy, every 12 s for a `db` walk or when Broadcast is not working. One
 *   in flight, never closer than 10 s, backing off 12 → 24 → 48 → 60 s on
 *   failure.
 *
 * Because both draw from the same counter, receivers order everything with
 * (gen, seq) whichever way it came, and switching between them, however
 * often, can never freeze a dot behind a higher number from the other side.
 *
 * `superseded`, `walk_closed` and `not_sharing` stop the publisher for good:
 * only a deliberate start or a relaunch begins a new session.
 *
 * Times are monotonic milliseconds.
 */

import { MAX_DELTA_POINTS } from './liveProtocol';

export const POS_MIN_GAP_MS = 5_000;
export const POS_MOVING_GAP_MS = 10_000;
export const POS_HEARTBEAT_MS = 30_000;
export const SNAP_COOLDOWN_MS = 15_000;
export const CHECKPOINT_HEALTHY_MS = 60_000;
export const CHECKPOINT_FALLBACK_MS = 12_000;
export const RPC_MIN_GAP_MS = 10_000;
export const RPC_BACKOFF_MS = [12_000, 24_000, 48_000, 60_000] as const;

export type StopReason = 'superseded' | 'walk_closed' | 'not_sharing';
export type RpcResult = 'ok' | 'stale' | StopReason | 'failed';

export interface PublisherState {
  gen: number | null;
  /** Last sequence number used, by either outlet. */
  seq: number;
  /** Route length already covered by Broadcast (deltas or a snap). */
  sentRv: number;
  lastPosAt: number | null;
  lastSnapAt: number | null;
  snapPending: boolean;
  rpcInFlight: boolean;
  lastRpcAt: number | null;
  rpcFailures: number;
  rpcNotBefore: number;
  stopped: StopReason | null;
}

export interface PublisherInput {
  now: number;
  transport: 'db' | 'broadcast';
  /** Socket connected and the room joined, at this moment. */
  linkReady: boolean;
  /** Recent sends acknowledged. */
  linkHealthy: boolean;
  /** The sender's accepted route length. */
  routeLength: number;
}

export type PublishAction =
  /** Send route points [pathIndex, pathIndex + count) with the current position. */
  | { type: 'pos'; seq: number; pathIndex: number; count: number }
  | { type: 'snap' }
  | { type: 'rpc'; seq: number };

export function createPublisher(): PublisherState {
  return {
    gen: null,
    seq: 0,
    sentRv: 0,
    lastPosAt: null,
    lastSnapAt: null,
    snapPending: false,
    rpcInFlight: false,
    lastRpcAt: null,
    rpcFailures: 0,
    rpcNotBefore: 0,
    stopped: null,
  };
}

/** A new session generation: numbering restarts, receivers start the route afresh. */
export function startSession(_state: PublisherState, gen: number): PublisherState {
  return { ...createPublisher(), gen };
}

export function stopPublisher(state: PublisherState, reason: StopReason): PublisherState {
  return { ...state, stopped: reason, rpcInFlight: false, snapPending: false };
}

/** Someone asked for a catch-up (`req` for this walker or for everyone). */
export function requestSnap(state: PublisherState): PublisherState {
  return state.stopped || state.gen === null ? state : { ...state, snapPending: true };
}

export function planPublish(state: PublisherState, input: PublisherInput): { state: PublisherState; actions: PublishAction[] } {
  if (state.stopped || state.gen === null) return { state, actions: [] };
  const { now } = input;
  const actions: PublishAction[] = [];
  let next = { ...state };

  if (input.transport === 'broadcast' && input.linkReady) {
    const snapAllowed = next.lastSnapAt === null || now - next.lastSnapAt >= SNAP_COOLDOWN_MS;
    const backlog = input.routeLength - next.sentRv;
    let snapped = false;

    if (snapAllowed && (next.snapPending || backlog > MAX_DELTA_POINTS)) {
      actions.push({ type: 'snap' });
      next = { ...next, lastSnapAt: now, snapPending: false, sentRv: input.routeLength };
      snapped = true;
    }

    const sincePos = next.lastPosAt === null ? Infinity : now - next.lastPosAt;
    const hasNew = input.routeLength > next.sentRv;
    // After a snap, a pos follows straight away with an empty delta: it tells
    // receivers where the route stands, so a lost snap shows up as a gap.
    const due =
      snapped ||
      (sincePos >= POS_MIN_GAP_MS && ((hasNew && sincePos >= POS_MOVING_GAP_MS) || sincePos >= POS_HEARTBEAT_MS));
    if (due) {
      const count = Math.min(Math.max(0, input.routeLength - next.sentRv), MAX_DELTA_POINTS);
      const seq = next.seq + 1;
      actions.push({ type: 'pos', seq, pathIndex: next.sentRv, count });
      next = { ...next, seq, sentRv: next.sentRv + count, lastPosAt: now };
    }
  }

  const healthy = input.transport === 'broadcast' && input.linkReady && input.linkHealthy;
  const interval = Math.max(healthy ? CHECKPOINT_HEALTHY_MS : CHECKPOINT_FALLBACK_MS, RPC_MIN_GAP_MS);
  if (!next.rpcInFlight && now >= next.rpcNotBefore && (next.lastRpcAt === null || now - next.lastRpcAt >= interval)) {
    const seq = next.seq + 1;
    actions.push({ type: 'rpc', seq });
    next = { ...next, seq, rpcInFlight: true, lastRpcAt: now };
  }

  return { state: next, actions };
}

export function rpcSettled(state: PublisherState, result: RpcResult, now: number): PublisherState {
  switch (result) {
    case 'ok':
    case 'stale':
      return { ...state, rpcInFlight: false, rpcFailures: 0, rpcNotBefore: 0 };
    case 'failed': {
      const failures = state.rpcFailures + 1;
      const wait = RPC_BACKOFF_MS[Math.min(failures, RPC_BACKOFF_MS.length) - 1];
      return { ...state, rpcInFlight: false, rpcFailures: failures, rpcNotBefore: now + wait };
    }
    default:
      return stopPublisher(state, result);
  }
}

/**
 * Live Walk v2 — the walking phone's sender (plan Phase 3).
 *
 * One per publisher runtime: created when a meetup recording with location
 * sharing starts (or is restored after a relaunch), stopped when it ends.
 *
 *   1. SESSION. A fresh start token (in memory only, never persisted) asks
 *      begin_live_session for a generation. Retries reuse the token, so a lost
 *      answer cannot mint a second one; a relaunch makes a new token and so a
 *      new generation, which is what lets the sequence restart at 1 safely.
 *   2. CADENCE. Every trigger (a location batch, the foreground timer, the
 *      room joining, a catch-up request) asks the pure scheduler what is due:
 *      Broadcast `pos` / `snap` on a `broadcast` walk, and the checkpoint RPC
 *      on both transports, all from one sequence counter.
 *   3. STOP. `superseded`, `walk_closed` and `not_sharing` stop it for good.
 *
 * Nothing here decides anything about time or ordering on its own — that is
 * livePublishScheduler.ts — and nothing here touches React. Dependencies are
 * injected so the whole thing is tested without a network.
 */

import { simplifyRoute, type GeoPoint } from '../walk/geo';
import type { LinkConsumer, LinkHandle } from './liveLink';
import { buildPos, buildSnap, MAX_ROUTE_POINTS } from './liveProtocol';
import {
  createPublisher,
  planPublish,
  requestSnap,
  rpcSettled,
  startSession,
  stopPublisher,
  type PublisherState,
  type RpcResult,
  type StopReason,
} from './livePublishScheduler';

/** Points in a checkpoint's route snapshot: enough shape, small rows. */
export const CHECKPOINT_ROUTE_POINTS = 160;
const BEGIN_RETRY_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type LiveTransport = 'db' | 'broadcast';

/** What the recorder knows right now. */
export interface PublisherSample {
  /** The full, append-only accepted route (walkSession `path`). */
  path: readonly GeoPoint[];
  lat: number;
  lng: number;
  /** When the latest accepted fix was taken, on this phone's clock. */
  fixAtWall: number;
  /** The latest raw observation, which may be newer than the accepted fix. */
  obsAtWall: number | null;
  obsAccuracy: number | null;
}

export interface PublisherDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
  /** The walk's private room, as a walker. Only called on a `broadcast` walk. */
  acquireLink: (consumer: LinkConsumer) => LinkHandle;
  /** This phone's estimate of server time, or null while uncalibrated. */
  serverNow: () => number | null;
  wall: () => number;
  mono: () => number;
  newToken: () => string;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** Told once when publishing stops for a server reason. */
  onStopped?: (reason: StopReason) => void;
  /** The host says the walk just closed (a hint; the caller re-checks). */
  onEndHint?: () => void;
}

const clampAge = (ms: number) => Math.min(MAX_AGE_MS, Math.max(0, Math.round(ms)));

function toResult(status: unknown): RpcResult {
  return status === 'ok' || status === 'stale' || status === 'superseded' || status === 'walk_closed' || status === 'not_sharing'
    ? status
    : 'failed';
}

export class LivePublisher {
  private state: PublisherState = createPublisher();
  private readonly token: string;
  private sample: PublisherSample | null = null;
  private link: LinkHandle | null = null;
  private beginning = false;
  private beginFailures = 0;
  private beginTimer: unknown = null;
  private stoppedFor: StopReason | 'ended' | null = null;
  /** Field-health tallies for `summary()` — counts only, nothing identifying. */
  private readonly counts = {
    beginAttempts: 0,
    rpcOk: 0,
    rpcStale: 0,
    rpcFailed: 0,
    posSent: 0,
    snapSent: 0,
    transportSwitches: 0,
  };
  private readonly startedMono: number;

  constructor(
    private readonly deps: PublisherDeps,
    private readonly walkId: string,
    private readonly userId: string,
    private transport: LiveTransport,
  ) {
    this.token = deps.newToken();
    this.startedMono = deps.mono();
  }

  /** What this runtime did, for the one `live_walk_sender_summary` event. */
  summary(): Record<string, string | number | boolean | null> {
    return {
      transport: this.transport,
      got_session: this.state.gen !== null,
      stopped: this.stoppedFor ?? 'running',
      duration_s: Math.round((this.deps.mono() - this.startedMono) / 1000),
      begin_attempts: this.counts.beginAttempts,
      rpc_ok: this.counts.rpcOk,
      rpc_stale: this.counts.rpcStale,
      rpc_failed: this.counts.rpcFailed,
      pos_sent: this.counts.posSent,
      snap_sent: this.counts.snapSent,
      transport_switches: this.counts.transportSwitches,
      clock_known: this.deps.serverNow() !== null,
    };
  }

  /** The generation this runtime holds, once the server has issued it. */
  get generation(): number | null {
    return this.state.gen;
  }

  get stopped(): StopReason | 'ended' | null {
    return this.stoppedFor;
  }

  start(): void {
    if (this.stoppedFor) return;
    this.syncLink();
    void this.begin();
  }

  /** New recorder state: remember it and see what is due. */
  update(sample: PublisherSample): void {
    this.sample = sample;
    this.tick();
  }

  /** A trigger with nothing new to report (the foreground timer). */
  tick(): void {
    if (this.stoppedFor || this.state.gen === null || !this.sample) return;
    const sample = this.sample;
    const link = this.link;
    const plan = planPublish(this.state, {
      now: this.deps.mono(),
      transport: this.transport,
      linkReady: !!link && link.isReady(),
      linkHealthy: !!link && link.isHealthy(),
      routeLength: sample.path.length,
    });
    this.state = plan.state;
    const gen = this.state.gen as number;
    const wall = this.deps.wall();
    for (const action of plan.actions) {
      if (action.type === 'pos' && link) {
        this.counts.posSent += 1;
        void link.send('pos', buildPos({
          user: this.userId,
          gen,
          seq: action.seq,
          atServer: this.deps.serverNow(),
          fixAgeMs: wall - sample.fixAtWall,
          lat: sample.lat,
          lng: sample.lng,
          obsAgeMs: sample.obsAtWall === null ? null : wall - sample.obsAtWall,
          obsAccuracy: sample.obsAccuracy,
          pathIndex: action.pathIndex,
          points: sample.path.slice(action.pathIndex, action.pathIndex + action.count),
        }));
      } else if (action.type === 'snap' && link) {
        this.counts.snapSent += 1;
        void link.send('snap', buildSnap({
          user: this.userId,
          gen,
          routeVersion: sample.path.length,
          points: simplifyRoute([...sample.path], MAX_ROUTE_POINTS),
        }));
      } else if (action.type === 'rpc') {
        void this.checkpoint(gen, action.seq, sample, wall);
      }
    }
  }

  /** The emergency switch (or the server's choice at start) changed the transport. */
  setTransport(transport: LiveTransport): void {
    if (transport === this.transport) return;
    this.transport = transport;
    this.counts.transportSwitches += 1;
    this.syncLink();
    this.tick();
  }

  /** The recording ended. Nothing is sent after this. */
  stop(): void {
    this.finish('ended');
  }

  private finish(reason: StopReason | 'ended'): void {
    if (this.stoppedFor) return;
    this.stoppedFor = reason;
    if (reason !== 'ended') this.state = stopPublisher(this.state, reason);
    if (this.beginTimer !== null) this.deps.clearTimer(this.beginTimer);
    this.beginTimer = null;
    this.link?.release();
    this.link = null;
    if (reason !== 'ended') this.deps.onStopped?.(reason);
  }

  private syncLink(): void {
    if (this.stoppedFor) return;
    if (this.transport === 'broadcast' && !this.link) {
      this.link = this.deps.acquireLink({
        onStatus: status => { if (status === 'joined') this.tick(); },
        onMessage: message => {
          if (message.kind === 'req' && (message.want === 'all' || message.want === this.userId)) {
            this.state = requestSnap(this.state);
            this.tick();
          } else if (message.kind === 'endhint') {
            this.deps.onEndHint?.();
          }
        },
      });
    } else if (this.transport === 'db' && this.link) {
      this.link.release();
      this.link = null;
    }
  }

  private async begin(): Promise<void> {
    if (this.beginning || this.stoppedFor || this.state.gen !== null) return;
    this.beginning = true;
    this.counts.beginAttempts += 1;
    let status: unknown = null;
    let gen: unknown = null;
    try {
      const { data, error } = await this.deps.rpc('begin_live_session', {
        p_walk_id: this.walkId,
        p_start_token: this.token,
      });
      if (!error) {
        status = (data as { status?: unknown } | null)?.status;
        gen = (data as { gen?: unknown } | null)?.gen;
      }
    } catch {
      status = null;
    } finally {
      this.beginning = false;
    }
    if (this.stoppedFor) return;
    if (status === 'ok' && typeof gen === 'number' && Number.isInteger(gen) && gen >= 1) {
      this.beginFailures = 0;
      this.state = startSession(this.state, gen);
      this.tick();
      return;
    }
    if (status === 'superseded' || status === 'walk_closed' || status === 'not_sharing') {
      this.finish(status);
      return;
    }
    // No answer, or one we do not understand: ask again with the same token.
    const wait = BEGIN_RETRY_MS[Math.min(this.beginFailures, BEGIN_RETRY_MS.length - 1)];
    this.beginFailures += 1;
    this.beginTimer = this.deps.setTimer(() => {
      this.beginTimer = null;
      void this.begin();
    }, wait);
  }

  private async checkpoint(gen: number, seq: number, sample: PublisherSample, wall: number): Promise<void> {
    let result: RpcResult = 'failed';
    try {
      const { data, error } = await this.deps.rpc('publish_live_location', {
        p_walk_id: this.walkId,
        p_gen: gen,
        p_seq: seq,
        p_lat: sample.lat,
        p_lng: sample.lng,
        p_accuracy: sample.obsAccuracy,
        p_fix_age_ms: clampAge(wall - sample.fixAtWall),
        p_obs_age_ms: sample.obsAtWall === null ? null : clampAge(wall - sample.obsAtWall),
        p_sent_at: new Date(wall).toISOString(),
        p_route_version: sample.path.length,
        p_path: simplifyRoute([...sample.path], CHECKPOINT_ROUTE_POINTS).map(p => ({ lat: p.lat, lng: p.lng })),
      });
      result = error ? 'failed' : toResult((data as { status?: unknown } | null)?.status);
    } catch {
      result = 'failed';
    }
    if (result === 'ok') this.counts.rpcOk += 1;
    else if (result === 'stale') this.counts.rpcStale += 1;
    else if (result === 'failed') this.counts.rpcFailed += 1;
    if (this.stoppedFor || this.state.gen !== gen) return;
    this.state = rpcSettled(this.state, result, this.deps.mono());
    if (this.state.stopped) this.finish(this.state.stopped);
  }
}

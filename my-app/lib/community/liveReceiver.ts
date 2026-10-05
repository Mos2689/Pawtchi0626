/**
 * Live Walk v2 — the live map's receiver (plan Phase 4).
 *
 * One per visit to the live map. Every source goes through the one reducer in
 * liveReconciler.ts, and the screen gets back today's LiveParty list plus
 * `contact_at` / `age_known`:
 *
 *   - live_walk_positions, on start, on demand (foreground, reloads) and
 *     every 60 s — or every 15 s while a Broadcast walk's room is not joined;
 *   - postgres_changes rows, handed in by the screen's existing walk channel;
 *   - on a `broadcast` walk only: the private room's `pos` / `snap`, Presence,
 *     and catch-up requests for missing route;
 *   - attendance and the walk's state, which decide who may be shown at all.
 *
 * Dependencies are injected so the whole thing is tested without a network,
 * the same way as livePublisher.ts. Nothing here touches React.
 */

import { catchUpDue, type CatchUpTracker } from './liveCatchUp';
import type { LinkConsumer, LinkHandle, LinkStatus } from './liveLink';
import type { LiveTransport } from './livePublisher';
import { buildEndHint, buildReq, parseLiveRow, parsePositions, type LiveMessage } from './liveProtocol';
import {
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
  type LivePartyV2,
  type ReconcileClock,
  type ReconcilerState,
} from './liveReconciler';

/** The once-a-minute read that repairs anything the event streams dropped. */
export const RECEIVER_RECONCILE_MS = 60_000;
/** The slower update path while a Broadcast walk's room is unavailable. */
export const RECEIVER_FALLBACK_POLL_MS = 15_000;
/** How often the receiver looks at the clock: pruning, polling, catch-up. */
export const RECEIVER_TICK_MS = 5_000;
const FAILURE_BACKOFF_CAP_MS = 60_000;
/** Freshness labels move in 15 s steps; finer changes are not worth a render. */
const LABEL_BUCKET_MS = 15_000;

export interface ReceiverDeps {
  /** live_walk_positions through the clock-sampling RPC wrapper. */
  readPositions: () => Promise<{ data: unknown; error: { message: string } | null }>;
  /** The walk's `live_transport`, or null if it could not be read. */
  readTransport: () => Promise<LiveTransport | null>;
  /** The walk's private room, as a viewer. Only called on a `broadcast` walk. */
  acquireLink: (consumer: LinkConsumer) => LinkHandle;
  clock: () => ReconcileClock;
  /** Monotonic milliseconds. */
  mono: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** A new list for the screen (only when something visible changed). */
  onParties: (parties: LivePartyV2[]) => void;
  /** The host says the walk just closed — a hint; the screen reloads to check. */
  onEndHint?: () => void;
}

/** What makes two lists look the same on the map. */
function signature(parties: readonly LivePartyV2[]): string {
  return parties
    .map(p => {
      const age = p.age_known ? Math.floor(Date.parse(p.recorded_at) / LABEL_BUCKET_MS) : '-';
      const last = p.path[p.path.length - 1];
      return `${p.user_id},${p.lat},${p.lng},${p.path.length},${last?.lat ?? ''},${age}`;
    })
    .join('|');
}

export class LiveReceiver {
  private state: ReconcilerState;
  private transport: LiveTransport = 'db';
  private link: LinkHandle | null = null;
  private linkJoined = false;
  private tracker: CatchUpTracker = {};
  private reading = false;
  private readAgain = false;
  private lastReadAt: number | null = null;
  private readFailures = 0;
  private tickTimer: unknown = null;
  private lastSignature: string | null = null;
  private stopped = false;

  constructor(
    private readonly deps: ReceiverDeps,
    walkId: string,
    private readonly userId: string,
  ) {
    this.state = createReconciler(walkId);
  }

  start(): void {
    if (this.stopped) return;
    void this.refreshTransport();
    void this.refresh();
    this.scheduleTick();
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    if (this.tickTimer !== null) this.deps.clearTimer(this.tickTimer);
    this.tickTimer = null;
    this.link?.release();
    this.link = null;
  }

  /** One positions read now (single in flight; a call during one queues one more). */
  async refresh(): Promise<void> {
    if (this.stopped) return;
    if (this.reading) {
      this.readAgain = true;
      return;
    }
    this.reading = true;
    try {
      do {
        this.readAgain = false;
        this.lastReadAt = this.deps.mono();
        let ok = false;
        try {
          const { data, error } = await this.deps.readPositions();
          const snapshot = error ? null : parsePositions(data);
          if (snapshot && !this.stopped) {
            const clock = this.deps.clock();
            this.state = applyPositions(applyClock(this.state, clock), snapshot, clock);
            ok = true;
          }
        } catch {
          ok = false;
        }
        this.readFailures = ok ? 0 : this.readFailures + 1;
        if (this.stopped) return;
        this.emit();
      } while (this.readAgain && !this.stopped);
    } finally {
      this.reading = false;
    }
  }

  /** Re-read the walk's transport (foreground, reloads). */
  async refreshTransport(): Promise<void> {
    try {
      const transport = await this.deps.readTransport();
      if (transport) this.setTransport(transport);
    } catch {
      // Keep what is known; the next reload asks again.
    }
  }

  /** A community_live_locations row from postgres_changes (`payload.new`). */
  onRow(raw: unknown): void {
    if (this.stopped) return;
    const row = parseLiveRow(raw);
    if (!row) return;
    this.state = applyRow(this.state, row, this.deps.clock());
    this.emit();
  }

  /** Who is walking with sharing on, and whether the walk is still running. */
  setAttendance(sharing: readonly string[], walkActive: boolean): void {
    if (this.stopped) return;
    const before = this.state.sharing;
    this.state = applyAttendance(this.state, { sharing, walkActive });
    this.emit();
    // Rows for someone who only just started sharing were refused until now:
    // read again rather than wait for their next update.
    if (walkActive && sharing.some(user => !before || !before.has(user))) void this.refresh();
  }

  /** The walk's transport as the server has it (also the emergency switch). */
  setTransport(transport: LiveTransport): void {
    if (this.stopped || transport === this.transport) return;
    this.transport = transport;
    if (transport === 'broadcast' && !this.link) {
      this.link = this.deps.acquireLink(this.consumer);
      // A room someone else on this phone (the recorder) already joined will
      // not announce itself again.
      this.onStatus(this.link.status());
    } else if (transport === 'db' && this.link) {
      this.link.release();
      this.link = null;
      this.onStatus('closed');
    }
  }

  /** Host only, after a successful close: tell the room at once. */
  sendEndHint(): void {
    if (this.link?.isReady()) void this.link.send('endhint', buildEndHint(this.userId));
  }

  private readonly consumer: LinkConsumer = {
    onStatus: status => this.onStatus(status),
    onMessage: message => this.onMessage(message),
    onPresence: walkers => {
      if (this.stopped) return;
      this.state = applyPresence(this.state, walkers, this.deps.clock());
      this.emit();
    },
  };

  private onStatus(status: LinkStatus): void {
    if (this.stopped) return;
    const joined = status === 'joined';
    if (joined === this.linkJoined) return;
    this.linkJoined = joined;
    if (joined) {
      // Events missed while out of the room: one read and a fresh catch-up.
      this.tracker = {};
      void this.refresh();
    } else {
      this.state = applyLinkDown(this.state, this.deps.clock());
      this.emit();
    }
  }

  private onMessage(message: LiveMessage): void {
    if (this.stopped) return;
    if (message.kind === 'pos') this.state = applyPos(this.state, message, this.deps.clock());
    else if (message.kind === 'snap') this.state = applySnap(this.state, message);
    else if (message.kind === 'endhint') {
      this.deps.onEndHint?.();
      return;
    } else return;
    this.emit();
  }

  private scheduleTick(): void {
    if (this.stopped) return;
    this.tickTimer = this.deps.setTimer(() => {
      this.tickTimer = null;
      this.tick();
      this.scheduleTick();
    }, RECEIVER_TICK_MS);
  }

  /** Exposed for tests; otherwise driven by the receiver's own timer. */
  tick(): void {
    if (this.stopped) return;
    this.state = prune(this.state, this.deps.clock());
    this.emit();
    const fallback = this.transport === 'broadcast' && !this.linkJoined;
    const base = fallback ? RECEIVER_FALLBACK_POLL_MS : RECEIVER_RECONCILE_MS;
    const wait = Math.min(FAILURE_BACKOFF_CAP_MS, base * 2 ** Math.min(this.readFailures, 2));
    if (this.lastReadAt === null || this.deps.mono() - this.lastReadAt >= wait) void this.refresh();
  }

  private emit(): void {
    const parties = selectParties(this.state, this.deps.clock());
    const sig = signature(parties);
    if (sig !== this.lastSignature) {
      this.lastSignature = sig;
      this.deps.onParties(parties);
    }
    this.askForMissingRoute();
  }

  private askForMissingRoute(): void {
    const link = this.link;
    if (!link || !this.linkJoined || !link.isReady()) return;
    const { tracker, want } = catchUpDue(this.tracker, walkersBehind(this.state), this.deps.mono());
    this.tracker = tracker;
    if (want) void link.send('req', buildReq(this.userId, want));
  }
}

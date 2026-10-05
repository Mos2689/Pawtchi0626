/**
 * Live Walk v2 — the one connection to a walk's private room.
 *
 * `walk:<walkId>` carries Broadcast (pos / snap / req / endhint), Presence
 * (who is in the room, as a walker or a viewer) and the walk's database
 * changes. The live map and the walking phone's publisher both need it, often
 * at the same time, so it is ref-counted per (user, walk): the first acquire
 * opens it, the last release closes it.
 *
 * Lifecycle:
 *
 *   connecting ──SUBSCRIBED──▶ joined
 *        ▲                       │ CHANNEL_ERROR / TIMED_OUT / CLOSED
 *        │                       ▼
 *        └──── backoff ──── waiting      (2 → 4 → 8 → 16 → 30 s, ±20 %)
 *
 * Every attempt refreshes the token first (`realtime.setAuth()`), because a
 * private join is authorised by it. A refusal with the socket up (the room
 * policy said no) waits at least 30 s; a drop because the socket went away
 * starts at 2 s. Presence is tracked again on every join: it does not survive
 * one.
 *
 * Sending: the SDK silently falls back to an HTTP request when the socket or
 * the channel is not ready. That would turn every position into a request
 * against the database's front door, the very load this design removes, so
 * `send` checks readiness itself and answers `not_ready` instead.
 *
 * Health: sends are acknowledged (5 s). Two failures in a row mark the link
 * unhealthy until one succeeds; while unhealthy a tiny probe goes every 30 s.
 * An ack proves the server got it, not that anyone else did.
 *
 * Dependencies are injected so the state machine is tested without a socket.
 */

import { parseLiveMessage, type LiveEvent, type LiveMessage } from './liveProtocol';

export const LINK_BACKOFF_MS = [2_000, 4_000, 8_000, 16_000, 30_000] as const;
export const LINK_REFUSED_BACKOFF_MS = 30_000;
export const ACK_TIMEOUT_MS = 5_000;
export const UNHEALTHY_AFTER_FAILURES = 2;
export const PROBE_INTERVAL_MS = 30_000;
/**
 * The longest the room may go without being joined — while joining, or after
 * silently falling out of "joined" — before the channel is thrown away and a
 * fresh one opened. Field run 2026-10-05: after a few socket drops on iOS the
 * SDK left a channel in "joining" for ten minutes and never said another word.
 */
export const JOIN_WATCHDOG_MS = 20_000;
const WATCH_EVERY_MS = 5_000;

export type LinkStatus = 'connecting' | 'joined' | 'waiting' | 'closed';
export type LinkRole = 'walker' | 'viewer';
export type SendResult = 'ok' | 'not_ready' | 'failed';

export interface LiveChange {
  table: 'community_live_locations' | 'community_walk_attendance' | 'community_shared_media' | 'community_walks';
  eventType: string;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
}

export interface LinkConsumer {
  onStatus?(status: LinkStatus): void;
  onMessage?(message: LiveMessage): void;
  /** Everyone in the room as a walker, after every Presence sync. */
  onPresence?(walkers: string[]): void;
  onChange?(change: LiveChange): void;
  onHealth?(healthy: boolean): void;
}

export interface LinkHandle {
  status(): LinkStatus;
  /** Socket connected and the room joined, right now. */
  isReady(): boolean;
  isHealthy(): boolean;
  send(event: LiveEvent, payload: object): Promise<SendResult>;
  setRole(role: LinkRole): void;
  release(): void;
}

// The slice of the Supabase client this needs (so tests can stand in for it).
export interface ChannelLike {
  state: string;
  on(type: string, filter: Record<string, unknown>, callback: (payload: never) => void): ChannelLike;
  subscribe(callback: (status: string, err?: Error) => void): ChannelLike;
  send(args: { type: 'broadcast'; event: string; payload: unknown }, opts?: { timeout?: number }): Promise<string>;
  track(meta: Record<string, unknown>): Promise<string>;
  untrack(): Promise<string>;
  presenceState(): Record<string, Record<string, unknown>[]>;
}

export interface RealtimeClientLike {
  channel(
    topic: string,
    opts: { config: { private: boolean; broadcast: { self: boolean; ack: boolean }; presence: { key: string } } },
  ): ChannelLike;
  removeChannel(channel: ChannelLike): Promise<unknown>;
  realtime: { isConnected(): boolean; setAuth(token?: string | null): Promise<void> };
}

export interface LinkTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  random(): number;
}

const defaultTimers: LinkTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
  random: Math.random,
};

const WALK_TABLES: { table: LiveChange['table']; event: string; column: string }[] = [
  { table: 'community_live_locations', event: 'INSERT', column: 'walk_id' },
  { table: 'community_live_locations', event: 'UPDATE', column: 'walk_id' },
  { table: 'community_walk_attendance', event: '*', column: 'walk_id' },
  { table: 'community_shared_media', event: '*', column: 'walk_id' },
  { table: 'community_walks', event: 'UPDATE', column: 'id' },
];

const LIVE_EVENT_NAMES = ['pos', 'snap', 'req', 'endhint'] as const;

export class LiveLink {
  private consumers = new Map<number, { consumer: LinkConsumer; role: LinkRole }>();
  private nextId = 1;
  private channel: ChannelLike | null = null;
  private current: LinkStatus = 'connecting';
  private attempt = 0;
  private failures = 0;
  private ackFailures = 0;
  private healthy = true;
  private retryTimer: unknown = null;
  private probeTimer: unknown = null;
  private watchTimer: unknown = null;
  /** When the current channel was last seen not joined; null while it is. */
  private notJoinedSince: number | null = null;
  private trackedRole: LinkRole | null = null;

  constructor(
    private readonly client: RealtimeClientLike,
    readonly userId: string,
    readonly walkId: string,
    private readonly timers: LinkTimers = defaultTimers,
    private readonly onEmpty: () => void = () => {},
  ) {}

  acquire(consumer: LinkConsumer, role: LinkRole): LinkHandle {
    const id = this.nextId;
    this.nextId += 1;
    this.consumers.set(id, { consumer, role });
    if (this.consumers.size === 1 && this.current !== 'closed') this.connect();
    else this.retrack();
    let released = false;
    return {
      status: () => this.current,
      isReady: () => this.isReady(),
      isHealthy: () => this.healthy,
      send: (event, payload) => this.send(event, payload),
      setRole: next => {
        const entry = this.consumers.get(id);
        if (!entry || entry.role === next) return;
        entry.role = next;
        this.retrack();
      },
      release: () => {
        if (released) return;
        released = true;
        this.consumers.delete(id);
        if (this.consumers.size === 0) this.close();
        else this.retrack();
      },
    };
  }

  /** Closes the room for every consumer (sign-out). */
  close(): void {
    if (this.current === 'closed') return;
    this.setStatus('closed');
    this.attempt += 1;
    this.clearTimers();
    this.teardownChannel();
    this.consumers.clear();
    this.onEmpty();
  }

  isReady(): boolean {
    return this.current === 'joined' && this.channel?.state === 'joined' && this.client.realtime.isConnected();
  }

  private role(): LinkRole {
    for (const { role } of this.consumers.values()) if (role === 'walker') return 'walker';
    return 'viewer';
  }

  private emit<K extends keyof LinkConsumer>(key: K, ...args: Parameters<NonNullable<LinkConsumer[K]>>): void {
    for (const { consumer } of Array.from(this.consumers.values())) {
      try {
        (consumer[key] as ((...a: unknown[]) => void) | undefined)?.(...args);
      } catch {
        // One consumer's bug must not stop the others hearing the room.
      }
    }
  }

  private setStatus(status: LinkStatus): void {
    if (this.current === status) return;
    this.current = status;
    this.emit('onStatus', status);
  }

  private setHealthy(healthy: boolean): void {
    if (this.healthy === healthy) return;
    this.healthy = healthy;
    this.emit('onHealth', healthy);
    if (!healthy) this.scheduleProbe();
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    if (this.probeTimer !== null) this.timers.clearTimeout(this.probeTimer);
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer);
    this.retryTimer = null;
    this.probeTimer = null;
    this.watchTimer = null;
  }

  /**
   * Every few seconds while a channel exists: if it has not been joined for
   * JOIN_WATCHDOG_MS, start over. Elapsed time is counted in watch ticks, so a
   * phone whose timers were frozen while locked does not trip it on waking.
   */
  private watch(attempt: number): void {
    if (this.watchTimer !== null) this.timers.clearTimeout(this.watchTimer);
    this.watchTimer = this.timers.setTimeout(() => {
      this.watchTimer = null;
      if (attempt !== this.attempt || this.current === 'closed' || !this.channel) return;
      const joined = this.current === 'joined' && this.channel.state === 'joined';
      if (joined) {
        this.notJoinedSince = null;
      } else {
        this.notJoinedSince = (this.notJoinedSince ?? 0) + WATCH_EVERY_MS;
        if (this.notJoinedSince >= JOIN_WATCHDOG_MS) {
          this.notJoinedSince = null;
          this.retryLater(false);
          return;
        }
      }
      this.watch(attempt);
    }, WATCH_EVERY_MS);
  }

  private teardownChannel(): void {
    const channel = this.channel;
    this.channel = null;
    this.trackedRole = null;
    if (channel) void this.client.removeChannel(channel).catch(() => {});
  }

  private connect(): void {
    this.attempt += 1;
    const attempt = this.attempt;
    this.setStatus('connecting');
    // Refresh the token the private join is authorised by, then join. A
    // release or a newer attempt while this waits makes it stand down.
    void this.client.realtime
      .setAuth()
      .catch(() => {})
      .then(() => {
        if (attempt !== this.attempt || this.current === 'closed') return;
        this.join(attempt);
      });
  }

  private join(attempt: number): void {
    const channel = this.client.channel(`walk:${this.walkId}`, {
      config: { private: true, broadcast: { self: false, ack: true }, presence: { key: this.userId } },
    });
    this.channel = channel;

    for (const event of LIVE_EVENT_NAMES) {
      channel.on('broadcast', { event }, ((message: { payload?: unknown }) => {
        const parsed = parseLiveMessage(event, message?.payload);
        if (parsed && parsed.user !== this.userId) this.emit('onMessage', parsed);
      }) as (payload: never) => void);
    }
    channel.on('presence', { event: 'sync' }, (() => this.emitPresence(channel)) as (payload: never) => void);
    for (const { table, event, column } of WALK_TABLES) {
      channel.on(
        'postgres_changes',
        { event, schema: 'public', table, filter: `${column}=eq.${this.walkId}` },
        ((payload: { eventType?: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
          this.emit('onChange', { table, eventType: payload?.eventType ?? '', new: payload?.new ?? {}, old: payload?.old ?? {} });
        }) as (payload: never) => void,
      );
    }

    this.notJoinedSince = null;
    this.watch(attempt);
    channel.subscribe(status => {
      if (attempt !== this.attempt || this.current === 'closed') return;
      if (status === 'SUBSCRIBED') {
        this.failures = 0;
        this.trackedRole = null;
        this.setStatus('joined');
        this.retrack();
        return;
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // With the socket up, an error is the room refusing us; back off long.
        const refused = status === 'CHANNEL_ERROR' && this.client.realtime.isConnected();
        this.retryLater(refused);
      }
    });
  }

  private retryLater(refused: boolean): void {
    this.attempt += 1;
    this.teardownChannel();
    this.setStatus('waiting');
    const base = LINK_BACKOFF_MS[Math.min(this.failures, LINK_BACKOFF_MS.length - 1)];
    this.failures += 1;
    const jittered = base * (0.8 + 0.4 * this.timers.random());
    const delay = refused ? Math.max(LINK_REFUSED_BACKOFF_MS, jittered) : jittered;
    if (this.retryTimer !== null) this.timers.clearTimeout(this.retryTimer);
    this.retryTimer = this.timers.setTimeout(() => {
      this.retryTimer = null;
      if (this.current !== 'closed') this.connect();
    }, delay);
  }

  private emitPresence(channel: ChannelLike): void {
    if (channel !== this.channel) return;
    const walkers: string[] = [];
    for (const [key, metas] of Object.entries(channel.presenceState())) {
      if (Array.isArray(metas) && metas.some(meta => meta?.role === 'walker')) walkers.push(key);
    }
    this.emit('onPresence', walkers.sort());
  }

  private retrack(): void {
    const channel = this.channel;
    if (!channel || this.current !== 'joined') return;
    const role = this.role();
    if (role === this.trackedRole) return;
    this.trackedRole = role;
    void channel.track({ role }).catch(() => {
      if (this.trackedRole === role) this.trackedRole = null;
    });
  }

  private async send(event: string, payload: object): Promise<SendResult> {
    const channel = this.channel;
    if (!channel || !this.isReady()) return 'not_ready';
    let result: string;
    try {
      result = await channel.send({ type: 'broadcast', event, payload }, { timeout: ACK_TIMEOUT_MS });
    } catch {
      result = 'error';
    }
    if (channel !== this.channel) return 'failed';
    if (result === 'ok') {
      this.ackFailures = 0;
      this.setHealthy(true);
      return 'ok';
    }
    this.ackFailures += 1;
    if (this.ackFailures >= UNHEALTHY_AFTER_FAILURES) this.setHealthy(false);
    return 'failed';
  }

  private scheduleProbe(): void {
    if (this.probeTimer !== null) return;
    this.probeTimer = this.timers.setTimeout(() => {
      this.probeTimer = null;
      if (this.current === 'closed' || this.healthy) return;
      void this.send('probe', { v: 2, u: this.userId }).then(() => {
        if (!this.healthy) this.scheduleProbe();
      });
    }, PROBE_INTERVAL_MS);
  }
}

// ── Registry ────────────────────────────────────────────────────────────────

const links = new Map<string, LiveLink>();

export function acquireLiveLink(
  client: RealtimeClientLike,
  userId: string,
  walkId: string,
  consumer: LinkConsumer,
  role: LinkRole,
  timers?: LinkTimers,
): LinkHandle {
  const key = `${userId}:${walkId}`;
  let link = links.get(key);
  if (!link) {
    const created = new LiveLink(client, userId, walkId, timers, () => {
      if (links.get(key) === created) links.delete(key);
    });
    link = created;
    links.set(key, link);
  }
  return link.acquire(consumer, role);
}

/** Sign-out: every room closes, for every consumer. */
export function releaseAllLiveLinks(): void {
  for (const link of Array.from(links.values())) link.close();
  links.clear();
}

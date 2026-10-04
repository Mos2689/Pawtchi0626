import {
  ACK_TIMEOUT_MS,
  LINK_REFUSED_BACKOFF_MS,
  PROBE_INTERVAL_MS,
  acquireLiveLink,
  releaseAllLiveLinks,
  type ChannelLike,
  type LinkConsumer,
  type LinkTimers,
  type RealtimeClientLike,
} from './liveLink';
import { buildEndHint, buildReq } from './liveProtocol';

const ME = '11111111-1111-4111-8111-111111111111';
const ANA = '22222222-2222-4222-8222-222222222222';
const WALK = '33333333-3333-4333-8333-333333333333';
const WALK2 = '44444444-4444-4444-8444-444444444444';

class FakeChannel implements ChannelLike {
  state = 'closed';
  handlers: { type: string; filter: Record<string, unknown>; cb: (payload: never) => void }[] = [];
  subscribed: ((status: string, err?: Error) => void) | null = null;
  sent: { event: string; timeout?: number }[] = [];
  sendResult = 'ok';
  tracked: Record<string, unknown>[] = [];
  presence: Record<string, Record<string, unknown>[]> = {};
  constructor(readonly topic: string, readonly opts: unknown) {}
  on(type: string, filter: Record<string, unknown>, cb: (payload: never) => void) {
    this.handlers.push({ type, filter, cb });
    return this;
  }
  subscribe(cb: (status: string, err?: Error) => void) {
    this.subscribed = cb;
    this.state = 'joining';
    return this;
  }
  async send(args: { event: string }, opts?: { timeout?: number }) {
    this.sent.push({ event: args.event, timeout: opts?.timeout });
    return this.sendResult;
  }
  async track(meta: Record<string, unknown>) {
    this.tracked.push(meta);
    return 'ok';
  }
  async untrack() {
    return 'ok';
  }
  presenceState() {
    return this.presence;
  }
  join() {
    this.state = 'joined';
    this.subscribed?.('SUBSCRIBED');
  }
  fail(status: string) {
    this.state = 'errored';
    this.subscribed?.(status);
  }
  fire(type: string, match: (filter: Record<string, unknown>) => boolean, payload: unknown) {
    for (const h of this.handlers) if (h.type === type && match(h.filter)) (h.cb as (p: unknown) => void)(payload);
  }
}

class FakeClient implements RealtimeClientLike {
  channels: FakeChannel[] = [];
  removed: FakeChannel[] = [];
  connected = true;
  authCalls = 0;
  channel(topic: string, opts: unknown) {
    const channel = new FakeChannel(topic, opts);
    this.channels.push(channel);
    return channel;
  }
  async removeChannel(channel: ChannelLike) {
    this.removed.push(channel as FakeChannel);
    channel.state = 'closed';
  }
  realtime = {
    isConnected: () => this.connected,
    setAuth: async () => {
      this.authCalls += 1;
    },
  };
  get last() {
    return this.channels[this.channels.length - 1];
  }
}

class ManualTimers implements LinkTimers {
  now = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.queue.push({ at: this.now + ms, fn, id });
    return id;
  }
  clearTimeout(handle: unknown) {
    this.queue = this.queue.filter(t => t.id !== handle);
  }
  random() {
    return 0.5; // no jitter
  }
  async advance(ms: number) {
    const until = this.now + ms;
    for (;;) {
      this.queue.sort((a, b) => a.at - b.at);
      const next = this.queue[0];
      if (!next || next.at > until) break;
      this.queue.shift();
      this.now = next.at;
      next.fn();
      await flush();
    }
    this.now = until;
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup() {
  const client = new FakeClient();
  const timers = new ManualTimers();
  const events: string[] = [];
  const consumer: LinkConsumer = {
    onStatus: s => events.push(`status:${s}`),
    onHealth: h => events.push(`health:${h}`),
    onPresence: w => events.push(`presence:${w.join(',')}`),
  };
  return { client, timers, events, consumer };
}

afterEach(() => releaseAllLiveLinks());

describe('opening the room', () => {
  it('opens one private room per user and walk, after refreshing the token, shared by every consumer', async () => {
    const { client, timers, consumer } = setup();
    acquireLiveLink(client, ME, WALK, consumer, 'viewer', timers);
    acquireLiveLink(client, ME, WALK, {}, 'walker', timers);
    expect(client.channels).toHaveLength(0);
    await flush();
    expect(client.authCalls).toBe(1);
    expect(client.channels).toHaveLength(1);
    expect(client.last.topic).toBe(`walk:${WALK}`);
    expect(client.last.opts).toEqual({
      config: { private: true, broadcast: { self: false, ack: true }, presence: { key: ME } },
    });
  });

  it('binds the four live events, Presence, and the walk’s database changes', async () => {
    const { client, timers } = setup();
    acquireLiveLink(client, ME, WALK, {}, 'viewer', timers);
    await flush();
    const bindings = client.last.handlers.map(h => `${h.type}:${String(h.filter.event)}:${String(h.filter.table ?? '')}:${String(h.filter.filter ?? '')}`);
    expect(bindings).toEqual([
      'broadcast:pos::', 'broadcast:snap::', 'broadcast:req::', 'broadcast:endhint::',
      'presence:sync::',
      `postgres_changes:INSERT:community_live_locations:walk_id=eq.${WALK}`,
      `postgres_changes:UPDATE:community_live_locations:walk_id=eq.${WALK}`,
      `postgres_changes:*:community_walk_attendance:walk_id=eq.${WALK}`,
      `postgres_changes:*:community_shared_media:walk_id=eq.${WALK}`,
      `postgres_changes:UPDATE:community_walks:id=eq.${WALK}`,
    ]);
  });
});

describe('Presence', () => {
  it('tracks the strongest role among consumers, and follows role changes', async () => {
    const { client, timers } = setup();
    acquireLiveLink(client, ME, WALK, {}, 'viewer', timers);
    await flush();
    client.last.join();
    await flush();
    const walker = acquireLiveLink(client, ME, WALK, {}, 'walker', timers);
    walker.setRole('viewer');
    await flush();
    expect(client.last.tracked).toEqual([{ role: 'viewer' }, { role: 'walker' }, { role: 'viewer' }]);
  });

  it('tracks again on every rejoin', async () => {
    const { client, timers } = setup();
    acquireLiveLink(client, ME, WALK, {}, 'walker', timers);
    await flush();
    client.last.join();
    client.last.fail('CLOSED');
    await timers.advance(2_000);
    client.last.join();
    await flush();
    expect(client.channels).toHaveLength(2);
    expect(client.channels[1].tracked).toEqual([{ role: 'walker' }]);
  });

  it('reports walkers only', async () => {
    const { client, timers, events, consumer } = setup();
    acquireLiveLink(client, ME, WALK, consumer, 'viewer', timers);
    await flush();
    client.last.join();
    client.last.presence = { [ANA]: [{ role: 'walker' }], [ME]: [{ role: 'viewer' }] };
    client.last.fire('presence', f => f.event === 'sync', {});
    expect(events).toContain(`presence:${ANA}`);
  });
});

describe('reconnecting', () => {
  it('backs off 2, 4, 8, 16, then 30 s, and starts over after a join', async () => {
    const { client, timers } = setup();
    acquireLiveLink(client, ME, WALK, {}, 'viewer', timers);
    await flush();
    const createdAt: number[] = [timers.now];
    for (let i = 0; i < 6; i += 1) {
      client.last.fail('TIMED_OUT');
      const before = client.channels.length;
      while (client.channels.length === before) await timers.advance(500);
      createdAt.push(timers.now);
    }
    const gaps = createdAt.slice(1).map((t, i) => t - createdAt[i]);
    expect(gaps).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);

    client.last.join();
    client.last.fail('CLOSED');
    const before = client.channels.length;
    await timers.advance(2_000);
    expect(client.channels.length).toBe(before + 1);
  });

  it('waits at least 30 s when the room refuses a connected socket, 2 s when the socket dropped', async () => {
    const refused = setup();
    acquireLiveLink(refused.client, ME, WALK, {}, 'viewer', refused.timers);
    await flush();
    refused.client.last.fail('CHANNEL_ERROR');
    await refused.timers.advance(LINK_REFUSED_BACKOFF_MS - 1);
    expect(refused.client.channels).toHaveLength(1);
    await refused.timers.advance(1);
    expect(refused.client.channels).toHaveLength(2);

    releaseAllLiveLinks();
    const dropped = setup();
    acquireLiveLink(dropped.client, ME, WALK, {}, 'viewer', dropped.timers);
    await flush();
    dropped.client.connected = false;
    dropped.client.last.fail('CHANNEL_ERROR');
    await dropped.timers.advance(2_000);
    expect(dropped.client.channels).toHaveLength(2);
  });

  it('removes the old channel each time and reports the gap to consumers', async () => {
    const { client, timers, events, consumer } = setup();
    acquireLiveLink(client, ME, WALK, consumer, 'viewer', timers);
    await flush();
    client.last.join();
    const first = client.last;
    first.fail('CLOSED');
    expect(client.removed).toContain(first);
    expect(events).toEqual(['status:joined', 'status:waiting']);
    // A late callback from the abandoned channel changes nothing.
    first.subscribed?.('SUBSCRIBED');
    expect(events).toEqual(['status:joined', 'status:waiting']);
  });
});

describe('sending', () => {
  it('never hands the SDK a send it would turn into an HTTP request', async () => {
    const { client, timers } = setup();
    const link = acquireLiveLink(client, ME, WALK, {}, 'walker', timers);
    expect(await link.send('req', buildReq(ME, 'all'))).toBe('not_ready');
    await flush();
    expect(await link.send('req', buildReq(ME, 'all'))).toBe('not_ready');
    client.last.join();
    client.connected = false;
    expect(await link.send('req', buildReq(ME, 'all'))).toBe('not_ready');
    expect(client.last.sent).toEqual([]);
    client.connected = true;
    expect(await link.send('req', buildReq(ME, 'all'))).toBe('ok');
    expect(client.last.sent).toEqual([{ event: 'req', timeout: ACK_TIMEOUT_MS }]);
  });

  it('turns unhealthy after two unacknowledged sends, probes every 30 s, recovers on an ack', async () => {
    const { client, timers, events, consumer } = setup();
    const link = acquireLiveLink(client, ME, WALK, consumer, 'walker', timers);
    await flush();
    client.last.join();
    client.last.sendResult = 'timed out';
    expect(await link.send('req', buildReq(ME, 'all'))).toBe('failed');
    expect(link.isHealthy()).toBe(true);
    await link.send('req', buildReq(ME, 'all'));
    expect(link.isHealthy()).toBe(false);
    await timers.advance(PROBE_INTERVAL_MS);
    expect(client.last.sent.map(s => s.event)).toEqual(['req', 'req', 'probe']);
    client.last.sendResult = 'ok';
    await timers.advance(PROBE_INTERVAL_MS);
    expect(link.isHealthy()).toBe(true);
    expect(events.filter(e => e.startsWith('health'))).toEqual(['health:false', 'health:true']);
  });
});

describe('receiving', () => {
  it('passes on valid messages from others, never its own or malformed ones', async () => {
    const { client, timers } = setup();
    const received: string[] = [];
    acquireLiveLink(client, ME, WALK, { onMessage: m => received.push(`${m.kind}:${m.user}`) }, 'viewer', timers);
    await flush();
    client.last.join();
    const fire = (event: string, payload: unknown) => client.last.fire('broadcast', f => f.event === event, { payload });
    fire('endhint', buildEndHint(ANA));
    fire('endhint', buildEndHint(ME));
    fire('endhint', { v: 2, u: 'not-a-user' });
    fire('req', { v: 1, u: ANA, want: 'all' });
    expect(received).toEqual([`endhint:${ANA}`]);
  });

  it('passes on database changes with their table', async () => {
    const { client, timers } = setup();
    const changes: string[] = [];
    acquireLiveLink(client, ME, WALK, { onChange: c => changes.push(`${c.table}:${c.eventType}`) }, 'viewer', timers);
    await flush();
    client.last.fire('postgres_changes', f => f.table === 'community_walks', { eventType: 'UPDATE', new: { state: 'completed' }, old: {} });
    expect(changes).toEqual(['community_walks:UPDATE']);
  });

  it('keeps telling everyone when one consumer throws', async () => {
    const { client, timers } = setup();
    const heard: string[] = [];
    acquireLiveLink(client, ME, WALK, { onMessage: () => { throw new Error('boom'); } }, 'viewer', timers);
    acquireLiveLink(client, ME, WALK, { onMessage: m => heard.push(m.kind) }, 'viewer', timers);
    await flush();
    client.last.fire('broadcast', f => f.event === 'endhint', { payload: buildEndHint(ANA) });
    expect(heard).toEqual(['endhint']);
  });
});

describe('closing', () => {
  it('closes with the last release, and a join still pending stands down', async () => {
    const { client, timers } = setup();
    const quick = acquireLiveLink(client, ME, WALK, {}, 'viewer', timers);
    quick.release();
    await flush();
    expect(client.channels).toHaveLength(0);

    const a = acquireLiveLink(client, ME, WALK, {}, 'viewer', timers);
    const b = acquireLiveLink(client, ME, WALK, {}, 'walker', timers);
    await flush();
    a.release();
    expect(client.removed).toHaveLength(0);
    b.release();
    b.release();
    expect(client.removed).toHaveLength(1);
  });

  it('closes every room on sign-out, and cancels pending retries', async () => {
    const { client, timers, events, consumer } = setup();
    acquireLiveLink(client, ME, WALK, consumer, 'viewer', timers);
    acquireLiveLink(client, ME, WALK2, {}, 'viewer', timers);
    await flush();
    client.channels[0].fail('TIMED_OUT');
    releaseAllLiveLinks();
    expect(events).toContain('status:closed');
    await timers.advance(60_000);
    expect(client.channels).toHaveLength(2);
    expect(client.removed).toHaveLength(2);
  });
});

import { LivePublisher, type PublisherDeps, type PublisherSample } from './livePublisher';
import type { LinkConsumer, LinkHandle } from './liveLink';
import { parseLiveMessage } from './liveProtocol';

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const WALK = '33333333-3333-4333-8333-333333333333';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const pt = (i: number) => ({ lat: (-3387000 + i * 10) / 1e5, lng: 151.2 });

function setup(options: { transport?: 'db' | 'broadcast'; begin?: unknown[]; publish?: unknown } = {}) {
  let wall = 1_760_000_000_000;
  let mono = 0;
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const beginAnswers = [...(options.begin ?? [{ status: 'ok', gen: 4 }])];
  const timers: { fn: () => void; ms: number }[] = [];
  const sent: { event: string; payload: Record<string, unknown> }[] = [];
  const stops: string[] = [];
  let consumer: LinkConsumer | null = null;
  let released = 0;
  const link: LinkHandle = {
    status: () => 'joined',
    isReady: () => true,
    isHealthy: () => true,
    send: async (event, payload) => { sent.push({ event, payload: payload as Record<string, unknown> }); return 'ok'; },
    setRole: () => {},
    release: () => { released += 1; },
  };
  const deps: PublisherDeps = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      if (fn === 'begin_live_session') {
        const answer = beginAnswers.length > 1 ? beginAnswers.shift() : beginAnswers[0];
        return answer === 'error' ? { data: null, error: { message: 'Network request failed' } } : { data: answer, error: null };
      }
      return { data: options.publish ?? { status: 'ok' }, error: null };
    },
    acquireLink: c => { consumer = c; return link; },
    serverNow: () => wall + 300_000,
    wall: () => wall,
    mono: () => mono,
    newToken: () => 'token-1',
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimer: () => {},
    onStopped: reason => stops.push(reason),
  };
  const sample = (n: number, over: Partial<PublisherSample> = {}): PublisherSample => ({
    path: Array.from({ length: n }, (_, i) => pt(i)),
    lat: pt(n - 1).lat,
    lng: 151.2,
    fixAtWall: wall - 1_500,
    obsAtWall: wall - 500,
    obsAccuracy: 6,
    ...over,
  });
  const publisher = new LivePublisher(deps, WALK, ME, options.transport ?? 'db');
  return {
    publisher,
    calls,
    timers,
    sent,
    stops,
    sample,
    advance: (ms: number) => { wall += ms; mono += ms; },
    consumer: () => consumer,
    released: () => released,
  };
}

describe('starting a session', () => {
  it('asks for a generation with this runtime’s token, then checkpoints at once', async () => {
    const t = setup();
    t.publisher.update(t.sample(3));
    t.publisher.start();
    await flush();
    expect(t.calls[0]).toEqual({ fn: 'begin_live_session', args: { p_walk_id: WALK, p_start_token: 'token-1' } });
    expect(t.publisher.generation).toBe(4);
    await flush();
    const publish = t.calls.find(c => c.fn === 'publish_live_location');
    expect(publish?.args).toMatchObject({ p_walk_id: WALK, p_gen: 4, p_seq: 1, p_route_version: 3, p_fix_age_ms: 1500, p_obs_age_ms: 500 });
    expect(publish?.args.p_path).toEqual([pt(0), pt(1), pt(2)]);
  });

  it('retries a failed start with the SAME token, backing off', async () => {
    const t = setup({ begin: ['error', 'error', { status: 'ok', gen: 2 }] });
    t.publisher.start();
    await flush();
    expect(t.timers.map(x => x.ms)).toEqual([2_000]);
    t.timers[0].fn();
    await flush();
    expect(t.timers.map(x => x.ms)).toEqual([2_000, 4_000]);
    t.timers[1].fn();
    await flush();
    expect(t.publisher.generation).toBe(2);
    expect(new Set(t.calls.filter(c => c.fn === 'begin_live_session').map(c => c.args.p_start_token))).toEqual(new Set(['token-1']));
  });

  it.each(['superseded', 'walk_closed', 'not_sharing'])('stops for good when the start is answered %s', async status => {
    const t = setup({ begin: [{ status }] });
    t.publisher.start();
    await flush();
    expect(t.publisher.stopped).toBe(status);
    expect(t.stops).toEqual([status]);
    t.publisher.update(t.sample(5));
    expect(t.calls.filter(c => c.fn === 'publish_live_location')).toHaveLength(0);
  });

  it('publishes nothing before a generation exists', () => {
    const t = setup({ begin: ['error'] });
    t.publisher.update(t.sample(5));
    expect(t.calls).toHaveLength(0);
  });
});

describe('checkpoints', () => {
  it('every 12 s on a db walk, one at a time', async () => {
    const t = setup();
    t.publisher.update(t.sample(3));
    t.publisher.start();
    await flush(); await flush();
    t.advance(5_000);
    t.publisher.update(t.sample(4));
    expect(t.calls.filter(c => c.fn === 'publish_live_location')).toHaveLength(1);
    t.advance(7_000);
    t.publisher.tick();
    await flush();
    expect(t.calls.filter(c => c.fn === 'publish_live_location').map(c => c.args.p_seq)).toEqual([1, 2]);
  });

  it('stops when the server says the walk is over', async () => {
    const t = setup({ publish: { status: 'walk_closed' } });
    t.publisher.update(t.sample(2));
    t.publisher.start();
    await flush(); await flush();
    expect(t.publisher.stopped).toBe('walk_closed');
    expect(t.stops).toEqual(['walk_closed']);
  });

  it('sends ages, never this phone’s clock as a time to trust', async () => {
    const t = setup();
    t.publisher.update(t.sample(1, { fixAtWall: 0 }));
    t.publisher.start();
    await flush(); await flush();
    const args = t.calls.find(c => c.fn === 'publish_live_location')?.args;
    expect(args?.p_fix_age_ms).toBe(6 * 60 * 60 * 1000);
  });
});

describe('on a broadcast walk', () => {
  it('joins the room as a walker and sends positions with their route points', async () => {
    const t = setup({ transport: 'broadcast' });
    t.publisher.update(t.sample(3));
    t.publisher.start();
    await flush();
    const pos = t.sent.find(s => s.event === 'pos');
    const parsed = parseLiveMessage('pos', pos?.payload);
    expect(parsed).toMatchObject({ kind: 'pos', user: ME, gen: 4, seq: 1, pathIndex: 0, routeVersion: 3, atServer: expect.any(Number) });
    expect(parsed && parsed.kind === 'pos' ? parsed.points : []).toEqual([pt(0), pt(1), pt(2)]);
  });

  it('answers a catch-up request for this walker or for everyone, not for someone else', async () => {
    const t = setup({ transport: 'broadcast' });
    t.publisher.update(t.sample(3));
    t.publisher.start();
    await flush();
    t.consumer()?.onMessage?.({ kind: 'req', user: OTHER, want: OTHER });
    expect(t.sent.filter(s => s.event === 'snap')).toHaveLength(0);
    t.consumer()?.onMessage?.({ kind: 'req', user: OTHER, want: ME });
    expect(t.sent.filter(s => s.event === 'snap')).toHaveLength(1);
  });

  it('passes the host’s end hint on', async () => {
    const t = setup({ transport: 'broadcast' });
    const hint = jest.fn();
    (t.publisher as unknown as { deps: { onEndHint?: () => void } }).deps.onEndHint = hint;
    t.publisher.start();
    t.consumer()?.onMessage?.({ kind: 'endhint', user: OTHER });
    expect(hint).toHaveBeenCalled();
  });

  it('leaves the room when switched to db, and keeps checkpointing every 12 s', async () => {
    const t = setup({ transport: 'broadcast' });
    t.publisher.update(t.sample(3));
    t.publisher.start();
    await flush(); await flush();
    t.publisher.setTransport('db');
    expect(t.released()).toBe(1);
    t.advance(12_000);
    t.publisher.tick();
    await flush();
    expect(t.calls.filter(c => c.fn === 'publish_live_location')).toHaveLength(2);
  });

  it('leaves the room when the recording ends', async () => {
    const t = setup({ transport: 'broadcast' });
    t.publisher.start();
    t.publisher.stop();
    expect(t.released()).toBe(1);
    expect(t.stops).toEqual([]);
  });
});

describe('field-health summary', () => {
  it('counts what happened, and carries no coordinates or ids', async () => {
    const t = setup({ publish: { status: 'stale' } });
    t.publisher.update(t.sample(3));
    t.publisher.start();
    await flush(); await flush();
    t.publisher.stop();
    const summary = t.publisher.summary();
    expect(summary).toMatchObject({ transport: 'db', got_session: true, stopped: 'ended', begin_attempts: 1, rpc_stale: 1, rpc_ok: 0 });
    const text = JSON.stringify(summary);
    expect(text).not.toMatch(/-33\.|151\.|1111|3333/);
  });
});

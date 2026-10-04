import {
  CHECKPOINT_FALLBACK_MS,
  CHECKPOINT_HEALTHY_MS,
  createPublisher,
  planPublish,
  requestSnap,
  rpcSettled,
  startSession,
  type PublishAction,
  type PublisherInput,
  type PublisherState,
} from './livePublishScheduler';

const input = (now: number, over: Partial<PublisherInput> = {}): PublisherInput => ({
  now,
  transport: 'broadcast',
  linkReady: true,
  linkHealthy: true,
  routeLength: 0,
  ...over,
});

/** A started session whose first checkpoint has already been sent and answered. */
function started(now = 0, routeLength = 0): PublisherState {
  const first = planPublish(startSession(createPublisher(), 3), input(now, { routeLength }));
  return rpcSettled(first.state, 'ok', now);
}

const types = (actions: PublishAction[]) => actions.map(a => a.type);

describe('before and after a session', () => {
  it('does nothing until a generation is known', () => {
    expect(planPublish(createPublisher(), input(0)).actions).toEqual([]);
  });

  it('checkpoints at once when a session starts, and announces where it stands', () => {
    const { actions } = planPublish(startSession(createPublisher(), 3), input(0));
    expect(actions).toEqual([{ type: 'pos', seq: 1, pathIndex: 0, count: 0 }, { type: 'rpc', seq: 2 }]);
  });

  it.each(['superseded', 'walk_closed', 'not_sharing'] as const)('stops for good on %s', reason => {
    const stopped = rpcSettled(planPublish(startSession(createPublisher(), 3), input(0)).state, reason, 0);
    expect(stopped.stopped).toBe(reason);
    expect(planPublish(stopped, input(120_000, { routeLength: 50 })).actions).toEqual([]);
    expect(requestSnap(stopped).snapPending).toBe(false);
  });

  it('restarts numbering with a new generation', () => {
    const fresh = startSession({ ...started(), seq: 40, sentRv: 30 }, 4);
    expect([fresh.gen, fresh.seq, fresh.sentRv]).toEqual([4, 0, 0]);
  });
});

describe('Broadcast positions', () => {
  it('sends new points about every 10 s, never closer than 5 s', () => {
    const s = started(0, 0);
    expect(types(planPublish(s, input(4_000, { routeLength: 3 })).actions)).toEqual([]);
    const at10 = planPublish(s, input(10_000, { routeLength: 3 }));
    expect(at10.actions).toEqual([{ type: 'pos', seq: 3, pathIndex: 0, count: 3 }]);
    expect(at10.state.sentRv).toBe(3);
  });

  it('sends a heartbeat every 30 s without new points', () => {
    const s = started(0, 0);
    expect(planPublish(s, input(29_000)).actions).toEqual([]);
    expect(planPublish(s, input(30_000)).actions).toEqual([{ type: 'pos', seq: 3, pathIndex: 0, count: 0 }]);
  });

  it('sends at most 20 points, the rest next time', () => {
    const s = { ...started(0, 0), lastSnapAt: 0 };
    const first = planPublish(s, input(10_000, { routeLength: 30 }));
    expect(first.actions).toEqual([{ type: 'pos', seq: 3, pathIndex: 0, count: 20 }]);
    const second = planPublish(first.state, input(20_000, { routeLength: 30 }));
    expect(second.actions).toEqual([{ type: 'pos', seq: 4, pathIndex: 20, count: 10 }]);
  });

  it('turns a backlog over 20 into a snap and an empty-delta pos', () => {
    const s = started(0, 0);
    const { actions, state } = planPublish(s, input(10_000, { routeLength: 45 }));
    expect(actions).toEqual([{ type: 'snap' }, { type: 'pos', seq: 3, pathIndex: 45, count: 0 }]);
    expect(state.sentRv).toBe(45);
  });

  it('answers catch-up requests with one snap per 15 s, coalescing the rest', () => {
    let s = requestSnap(started(0, 10));
    let step = planPublish(s, input(1_000, { routeLength: 10 }));
    expect(types(step.actions)).toEqual(['snap', 'pos']);
    s = requestSnap(requestSnap(step.state));
    step = planPublish(s, input(6_000, { routeLength: 10 }));
    expect(types(step.actions)).not.toContain('snap');
    expect(step.state.snapPending).toBe(true);
    step = planPublish(step.state, input(16_000, { routeLength: 10 }));
    expect(types(step.actions).filter(t => t === 'snap')).toHaveLength(1);
    expect(step.state.snapPending).toBe(false);
  });

  it('never sends Broadcast on a db walk or while the room is not joined', () => {
    for (const over of [{ transport: 'db' as const }, { linkReady: false }]) {
      const { actions } = planPublish(requestSnap(started(0, 0)), input(60_000, { routeLength: 50, ...over }));
      expect(types(actions)).toEqual(['rpc']);
    }
  });
});

describe('checkpoints', () => {
  it('every 60 s while Broadcast is healthy', () => {
    const s = started(0, 0);
    expect(types(planPublish(s, input(CHECKPOINT_HEALTHY_MS - 1)).actions)).not.toContain('rpc');
    expect(types(planPublish(s, input(CHECKPOINT_HEALTHY_MS)).actions)).toContain('rpc');
  });

  it('every 12 s for a db walk, or when Broadcast is unhealthy', () => {
    const s = started(0, 0);
    expect(types(planPublish(s, input(CHECKPOINT_FALLBACK_MS, { transport: 'db' })).actions)).toEqual(['rpc']);
    expect(types(planPublish(s, input(CHECKPOINT_FALLBACK_MS, { linkHealthy: false })).actions)).toContain('rpc');
  });

  it('keeps one in flight', () => {
    const sent = planPublish(started(0, 0), input(12_000, { transport: 'db' }));
    expect(planPublish(sent.state, input(60_000, { transport: 'db' })).actions).toEqual([]);
  });

  it('backs off 12, 24, 48, then 60 s on failure', () => {
    let s = started(0, 0);
    let now = 12_000;
    const gaps: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      const sent = planPublish(s, input(now, { transport: 'db' }));
      expect(types(sent.actions)).toEqual(['rpc']);
      s = rpcSettled(sent.state, 'failed', now);
      gaps.push(s.rpcNotBefore - now);
      now = s.rpcNotBefore;
    }
    expect(gaps).toEqual([12_000, 24_000, 48_000, 60_000, 60_000]);
    expect(rpcSettled(s, 'ok', now).rpcNotBefore).toBe(0);
  });

  it('treats stale as fine', () => {
    const sent = planPublish(started(0, 0), input(12_000, { transport: 'db' }));
    expect(rpcSettled(sent.state, 'stale', 12_000)).toMatchObject({ rpcInFlight: false, stopped: null, rpcFailures: 0 });
  });
});

describe('one sequence for both outlets', () => {
  it('never repeats or goes backwards, however often the transport flips', () => {
    let s = started(0, 0);
    let route = 0;
    const seqs: number[] = [];
    // Deterministic pseudo-random walk through transports, link states and results.
    let seed = 7;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let now = 1_000; now < 3_600_000; now += 1_000) {
      route += rand() < 0.4 ? 1 : 0;
      const flip = rand();
      const { state, actions } = planPublish(s, input(now, {
        transport: flip < 0.5 ? 'broadcast' : 'db',
        linkReady: rand() < 0.8,
        linkHealthy: rand() < 0.8,
        routeLength: route,
      }));
      s = state;
      for (const a of actions) if (a.type !== 'snap') seqs.push(a.seq);
      if (s.rpcInFlight && rand() < 0.5) s = rpcSettled(s, rand() < 0.2 ? 'failed' : 'ok', now);
    }
    expect(seqs.length).toBeGreaterThan(100);
    for (let i = 1; i < seqs.length; i += 1) expect(seqs[i]).toBe(seqs[i - 1] + 1);
  });
});

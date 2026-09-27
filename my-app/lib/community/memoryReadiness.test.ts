import { MEMORY_SETTLE_GRACE_MS, memoryReadiness, memoryWaitingLine } from './memoryReadiness';

const ended = '2026-09-24T14:23:50Z';
const endedMs = Date.parse(ended);

const base = {
  attendance: [
    { user_id: 'host', status: 'finished' },
    { user_id: 'member', status: 'walking' },
    { user_id: 'maybe', status: 'coming' },
  ],
  walkState: 'completed',
  endedAt: ended,
};

describe('memoryReadiness', () => {
  it('waits while someone who walked has no route yet (the half-baked memory)', () => {
    const r = memoryReadiness({ ...base, traceUserIds: ['host'], now: endedMs + 5_000 });
    expect(r).toEqual({ ready: false, expected: 2, arrived: 1, deadline: endedMs + MEMORY_SETTLE_GRACE_MS });
  });

  it('opens the moment everyone who walked is in', () => {
    const r = memoryReadiness({ ...base, traceUserIds: ['host', 'member'], now: endedMs + 5_000 });
    expect(r.ready).toBe(true);
    expect(r.deadline).toBeNull();
  });

  it('never waits on people who only said they were coming', () => {
    const r = memoryReadiness({ ...base, traceUserIds: ['host', 'member'], now: endedMs });
    expect(r.expected).toBe(2);
  });

  it('gives up on a straggler after the grace period rather than hold everyone', () => {
    const r = memoryReadiness({ ...base, traceUserIds: ['host'], now: endedMs + MEMORY_SETTLE_GRACE_MS });
    expect(r.ready).toBe(true);
    expect(r.arrived).toBe(1);
  });

  it('opens an old memory at once', () => {
    const r = memoryReadiness({ ...base, traceUserIds: [], now: endedMs + 86_400_000 });
    expect(r.ready).toBe(true);
  });

  it('shows a walk that is still going as it stands', () => {
    const r = memoryReadiness({ ...base, walkState: 'active', endedAt: null, traceUserIds: ['host'], now: endedMs });
    expect(r.ready).toBe(true);
  });

  it('does not hold forever when the end time is missing', () => {
    const r = memoryReadiness({ ...base, endedAt: null, traceUserIds: ['host'], now: endedMs });
    expect(r.ready).toBe(true);
  });

  it('counts a route as proof of walking even if attendance lags', () => {
    const r = memoryReadiness({
      ...base,
      attendance: [{ user_id: 'host', status: 'coming' }],
      traceUserIds: ['host'],
      now: endedMs,
    });
    expect(r).toMatchObject({ ready: true, expected: 1, arrived: 1 });
  });
});

describe('memoryWaitingLine', () => {
  it('says how far along it is', () => {
    expect(memoryWaitingLine({ ready: false, expected: 2, arrived: 1, deadline: 0 }))
      .toBe('1 of 2 walks are in. It opens when everyone’s is.');
  });

  it('keeps it simple for one walker', () => {
    expect(memoryWaitingLine({ ready: false, expected: 1, arrived: 0, deadline: 0 })).toBe('Putting the walk together.');
  });
});

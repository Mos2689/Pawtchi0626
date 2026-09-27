/**
 * Finishing a walk must not wait on the network forever.
 *
 * `finalizeAndSyncWalk` queues the walk durably, then tries to flush. On a
 * network that never answers, the flush used to hold the Finish button
 * indefinitely. It now gives up after FINISH_FLUSH_MS, reports 'queued', and
 * leaves the walk safely in the queue for the flush to deliver later.
 */

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (k: string) => Promise.resolve(mockStore.has(k) ? mockStore.get(k)! : null),
  setItem: (k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  },
  removeItem: (k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  },
}));

// A server that never answers the session upsert — the black-holed request.
jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'owner-a' } } } }),
    },
    from: () => ({ upsert: () => new Promise(() => {}) }),
  },
}));

jest.mock('../analytics', () => ({ track: jest.fn() }));
jest.mock('../completeActivity', () => ({
  fireCompletionSideEffects: jest.fn(),
  persistActivityCompletion: jest.fn(),
}));
jest.mock('../walksign/walksignSync', () => ({ maybeEvaluateWalksign: jest.fn() }));
jest.mock('../pawPrintsSync', () => ({ evaluatePawPrints: jest.fn() }));
jest.mock('../walkStorySync', () => ({ setPendingWalkStory: jest.fn() }));
jest.mock('./weather', () => ({ fetchWalkWeather: jest.fn() }));

import { FINISH_FLUSH_MS, finalizeAndSyncWalk } from './walkSync';

const startedAt = Date.UTC(2026, 8, 26, 8, 0, 0);

function args() {
  return {
    walkSessionId: 'walk-1',
    petId: 'pet-1',
    ownerId: 'owner-a',
    summary: {
      startedAt,
      endedAt: startedAt + 600_000,
      durationS: 600,
      movingTimeS: 540,
      distanceM: 900,
      avgMovingSpeedKmh: 6,
      acceptedCount: 60,
      endReason: 'manual',
      path: [],
    },
    route: [{ lat: -33.86, lng: 151.2 }],
    verdict: { verdict: 'valid' },
    profile: {},
    labels: { startLabel: null, endLabel: null, farthestLabel: null, isLoop: false },
  } as any;
}

describe('finalizeAndSyncWalk deadline', () => {
  beforeEach(() => {
    mockStore.clear();
    jest.useFakeTimers();
  });
  afterEach(() => jest.useRealTimers());

  it('returns "queued" once the deadline passes, and keeps the walk safely queued', async () => {
    let settled: { outcome: string } | null = null;
    void finalizeAndSyncWalk(args()).then(result => { settled = result; });

    // Let the durable queue write and the stalled flush start.
    await jest.advanceTimersByTimeAsync(FINISH_FLUSH_MS - 1);
    expect(settled).toBeNull();

    await jest.advanceTimersByTimeAsync(2);
    expect(settled).toEqual({ outcome: 'queued', matchedActivityId: null });

    const queue = JSON.parse(mockStore.get('walk:sync_queue') ?? '[]');
    expect(queue.map((item: { walkSessionId: string }) => item.walkSessionId)).toEqual(['walk-1']);
  });
});

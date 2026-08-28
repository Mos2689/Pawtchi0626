/**
 * The offline queue is device-wide; the flush is not.
 *
 * A queued walk carries the owner_id and pet_id it was recorded under, so
 * flushing it while a different account is signed in writes one person's GPS
 * trace against another person's ids. These tests pin that a flush only ever
 * touches the signed-in owner's walks, and that everyone else's stay in the
 * queue untouched — still there, with their attempt budget intact, for when
 * their own owner signs back in.
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

/** Session ids the fake database was asked to upsert, in order. */
const upserted: string[] = [];
let sessionUserId: string | null = null;

jest.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: () =>
        Promise.resolve({
          data: { session: sessionUserId ? { user: { id: sessionUserId } } : null },
        }),
    },
    from: (table: string) => {
      if (table !== 'walk_sessions') throw new Error(`unexpected table ${table}`);
      return {
        upsert: (row: { id: string }) => {
          upserted.push(row.id);
          return Promise.resolve({ error: null });
        },
      };
    },
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

import { flushWalkQueue } from './walkSync';

const QUEUE_KEY = 'walk:sync_queue';
const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';

/**
 * A queued walk with the 'likely_vehicle' verdict: it saves its session row and
 * then stops at the verdict gate, which is the shortest path through the
 * pipeline that still proves the row was written for this owner.
 */
function queuedWalk(walkSessionId: string, ownerId: string) {
  const startedAt = Date.UTC(2026, 7, 19, 8, 0, 0);
  return {
    walkSessionId,
    petId: `pet-of-${ownerId}`,
    ownerId,
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
    verdict: { verdict: 'likely_vehicle' },
    profile: {},
    labels: { startLabel: null, endLabel: null, farthestLabel: null },
    steps: { sessionSaved: false, planResolved: false, sideEffectsFired: false },
    outcome: null,
    matchedActivityId: null,
    effectActivityId: null,
    attempts: 0,
    createdAt: startedAt,
  };
}

function writeQueue(items: unknown[]): void {
  mockStore.set(QUEUE_KEY, JSON.stringify(items));
}

function readQueue(): Array<{ walkSessionId: string; ownerId: string; attempts: number }> {
  return JSON.parse(mockStore.get(QUEUE_KEY) ?? '[]');
}

beforeEach(() => {
  mockStore.clear();
  upserted.length = 0;
  sessionUserId = null;
});

describe('flushWalkQueue', () => {
  it('processes only the given owner and leaves the other account queued', async () => {
    writeQueue([queuedWalk('walk-a', OWNER_A), queuedWalk('walk-b', OWNER_B)]);

    await flushWalkQueue(OWNER_A);

    expect(upserted).toEqual(['walk-a']);
    const left = readQueue();
    expect(left.map(i => i.walkSessionId)).toEqual(['walk-b']);
    // Not attempted, so not one attempt closer to being dropped.
    expect(left[0].attempts).toBe(0);
  });

  it('falls back to the signed-in account when no owner is given', async () => {
    sessionUserId = OWNER_B;
    writeQueue([queuedWalk('walk-a', OWNER_A), queuedWalk('walk-b', OWNER_B)]);

    await flushWalkQueue();

    expect(upserted).toEqual(['walk-b']);
    expect(readQueue().map(i => i.walkSessionId)).toEqual(['walk-a']);
  });

  it('flushes nothing with nobody signed in, and keeps the whole queue', async () => {
    writeQueue([queuedWalk('walk-a', OWNER_A), queuedWalk('walk-b', OWNER_B)]);

    await flushWalkQueue();

    expect(upserted).toEqual([]);
    expect(readQueue().map(i => i.walkSessionId)).toEqual(['walk-a', 'walk-b']);
  });
});

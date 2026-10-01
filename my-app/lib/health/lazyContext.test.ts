/**
 * The pet context's saved answer is restored only for the same user, the same
 * pet and the same local day — and never after the account has signed out.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  CONTEXT_DEFER_MS,
  clearContextSnapshot,
  deferContextFetch,
  flushContextSnapshotWrites,
  readContextSnapshot,
  saveContextSnapshot,
} from './lazyContext';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      __store: store,
    },
  };
});

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const want = { userId: 'u1', petId: 'pet1', date: '2026-10-02' };
const snapshot = {
  ...want,
  today: { todayCalories: 420, todayWater: 300 },
  trends: { weeklyDelta: -120, weightTrend: { latest: 9.1, previous: 9.3, direction: 'down' } },
};

beforeEach(async () => {
  clearContextSnapshot();
  await flushContextSnapshotWrites();
  store.clear();
});

describe('context snapshot', () => {
  it('comes back for the same user, pet and day', async () => {
    saveContextSnapshot(snapshot, 1_000);
    await flushContextSnapshotWrites();
    const restored = await readContextSnapshot(want);
    expect(restored?.today).toEqual(snapshot.today);
    expect(restored?.trends).toEqual(snapshot.trends);
    expect(restored?.savedAt).toBe(1_000);
  });

  it.each([
    ['another account', { ...want, userId: 'u2' }],
    ['another pet', { ...want, petId: 'pet2' }],
    ['another day — yesterday\'s totals are not today\'s', { ...want, date: '2026-10-03' }],
  ])('never for %s', async (_label, other) => {
    saveContextSnapshot(snapshot);
    await flushContextSnapshotWrites();
    expect(await readContextSnapshot(other)).toBeNull();
  });

  it('refuses anything that is not a snapshot', async () => {
    store.set('pet-context:snapshot:v1', '{"userId":"u1"}');
    expect(await readContextSnapshot(want)).toBeNull();
    store.set('pet-context:snapshot:v1', 'not json');
    expect(await readContextSnapshot(want)).toBeNull();
  });

  it('is gone after sign-out', async () => {
    saveContextSnapshot(snapshot);
    await flushContextSnapshotWrites();
    clearContextSnapshot();
    await flushContextSnapshotWrites();
    expect(await readContextSnapshot(want)).toBeNull();
  });

  it('a save already queued when the account signs out never lands', async () => {
    saveContextSnapshot(snapshot);
    clearContextSnapshot();
    await flushContextSnapshotWrites();
    expect(store.size).toBe(0);
  });

  it('the newest save wins', async () => {
    saveContextSnapshot({ ...snapshot, today: { todayCalories: 100 } });
    saveContextSnapshot({ ...snapshot, today: { todayCalories: 650 } });
    await flushContextSnapshotWrites();
    expect((await readContextSnapshot(want))?.today).toEqual({ todayCalories: 650 });
  });
});

describe('deferContextFetch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('runs after the launch burst, not before', () => {
    const run = jest.fn();
    deferContextFetch(run);
    jest.advanceTimersByTime(CONTEXT_DEFER_MS - 1);
    expect(run).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never runs once cancelled', () => {
    const run = jest.fn();
    deferContextFetch(run)();
    jest.advanceTimersByTime(CONTEXT_DEFER_MS * 2);
    expect(run).not.toHaveBeenCalled();
  });
});

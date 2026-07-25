/**
 * The core contract of the rebuilt tracker: the OS task is a PURE CONSUMER of
 * the durable `walk:active` record. No record → the task unregisters ITSELF on
 * the first delivery (a stale registration can't survive one callback); record
 * present → it appends points and never stops. Plus: start writes the record
 * before starting the OS task, and stop clears it before stopping. These are
 * the invariants that make the leak class structurally impossible.
 */

(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const mockStart = jest.fn((..._a: unknown[]) => Promise.resolve());
const mockStop = jest.fn((..._a: unknown[]) => Promise.resolve());
const mockHasStarted = jest.fn((..._a: unknown[]) => Promise.resolve(false));
const mockAsyncStore = new Map<string, string>();
const mockTask: { cb: ((body: unknown) => Promise<void>) | null } = { cb: null };

jest.mock('expo-location', () => ({
  startLocationUpdatesAsync: (...a: unknown[]) => mockStart(...a),
  stopLocationUpdatesAsync: (...a: unknown[]) => mockStop(...a),
  hasStartedLocationUpdatesAsync: (...a: unknown[]) => mockHasStarted(...a),
  hasServicesEnabledAsync: () => Promise.resolve(true),
  requestForegroundPermissionsAsync: () => Promise.resolve({ status: 'granted' }),
  Accuracy: { BestForNavigation: 4 },
  ActivityType: { Fitness: 3 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: (_name: string, cb: (body: unknown) => Promise<void>) => {
    mockTask.cb = cb;
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (k: string) => Promise.resolve(mockAsyncStore.has(k) ? mockAsyncStore.get(k) : null),
  setItem: (k: string, v: string) => {
    mockAsyncStore.set(k, v);
    return Promise.resolve();
  },
  removeItem: (k: string) => {
    mockAsyncStore.delete(k);
    return Promise.resolve();
  },
}));

jest.mock('../analytics', () => ({ track: jest.fn() }));

import {
  ActiveWalkDescriptor,
  readActiveWalk,
  readPoints,
  startWalk,
  stopWalk,
} from './walkTracker';

const ACTIVE_KEY = 'walk:active';

const descriptor: ActiveWalkDescriptor = {
  id: 'walk-1',
  petId: 'pet-1',
  petName: 'Bruno',
  ownerId: 'owner-1',
  startedAt: Date.now(),
  profile: {} as ActiveWalkDescriptor['profile'],
};

function delivery() {
  return {
    data: {
      locations: [
        { coords: { latitude: 1, longitude: 2, accuracy: 5 }, timestamp: Date.now() },
      ],
    },
    error: null,
  };
}

beforeEach(() => {
  mockAsyncStore.clear();
  mockStart.mockClear();
  mockStop.mockClear();
  mockHasStarted.mockReset();
  mockHasStarted.mockResolvedValue(false);
});

describe('walkTracker — self-healing OS task', () => {
  it('unregisters itself and drops the delivery when NO record exists', async () => {
    // No walk:active in storage — a stale registration the OS resumed.
    await mockTask.cb!(delivery());

    expect(mockStop).toHaveBeenCalledTimes(1); // self-stop
    expect(await readPoints()).toHaveLength(0); // dropped, not appended
  });

  it('appends points and does NOT stop when a record exists', async () => {
    mockAsyncStore.set(ACTIVE_KEY, JSON.stringify(descriptor));

    await mockTask.cb!(delivery());

    expect(mockStop).not.toHaveBeenCalled();
    expect(await readPoints()).toHaveLength(1);
  });

  it('favors the live walk when the record read fails (never self-stops on error)', async () => {
    // Simulate a storage read failure for the active key only.
    const asyncMock = jest.requireMock('@react-native-async-storage/async-storage') as {
      getItem: (k: string) => Promise<string | null>;
    };
    const original = asyncMock.getItem;
    asyncMock.getItem = (k: string) =>
      k === ACTIVE_KEY ? Promise.reject(new Error('boom')) : original(k);

    await mockTask.cb!(delivery());

    expect(mockStop).not.toHaveBeenCalled(); // did not kill a possibly-live walk
    asyncMock.getItem = original;
  });
});

describe('walkTracker — atomic start/stop', () => {
  it('startWalk writes the record BEFORE starting the OS task', async () => {
    await startWalk(descriptor);
    expect(await readActiveWalk()).toMatchObject({ id: 'walk-1' });
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it('stopWalk clears the record BEFORE stopping the OS task', async () => {
    mockAsyncStore.set(ACTIVE_KEY, JSON.stringify(descriptor));
    await stopWalk();
    expect(await readActiveWalk()).toBeNull();
    expect(mockStop).toHaveBeenCalled();
  });

  it('a finish right after a start still ends with no record and stop issued', async () => {
    await startWalk(descriptor);
    await stopWalk();
    expect(await readActiveWalk()).toBeNull();
    expect(mockStop).toHaveBeenCalled();
  });
});

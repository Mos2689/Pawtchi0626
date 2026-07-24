/**
 * The non-negotiable contract: ensureWalkTrackingStopped ALWAYS issues a real
 * stopLocationUpdatesAsync — it never lets a `hasStartedLocationUpdatesAsync`
 * read decide whether to stop. That native "is it running?" check can report
 * `false` while the CLLocationManager / Android foreground service is still
 * alive, and gating the stop on it is the exact mechanism behind the recurring
 * "location indicator stays lit until force-close" bug. These tests fail loudly
 * if that gate ever creeps back in.
 */

// The bundle uses the RN __DEV__ global (undefined under plain ts-jest/node).
(globalThis as { __DEV__?: boolean }).__DEV__ = false;

const mockStart = jest.fn((..._a: unknown[]) => Promise.resolve());
const mockStop = jest.fn((..._a: unknown[]) => Promise.resolve());
const mockHasStarted = jest.fn((..._a: unknown[]) => Promise.resolve(false));

jest.mock('expo-location', () => ({
  startLocationUpdatesAsync: (...a: unknown[]) => mockStart(...a),
  stopLocationUpdatesAsync: (...a: unknown[]) => mockStop(...a),
  hasStartedLocationUpdatesAsync: (...a: unknown[]) => mockHasStarted(...a),
  Accuracy: { BestForNavigation: 4 },
  ActivityType: { Fitness: 3 },
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(() => Promise.resolve(null)),
  setItem: jest.fn(() => Promise.resolve()),
  removeItem: jest.fn(() => Promise.resolve()),
}));

// walkTrace pulls in react-native (AppState) — mock it so this stays a pure
// node test and the tracer itself is exercised elsewhere.
jest.mock('./walkTrace', () => ({ walkTrace: jest.fn() }));

import { ensureWalkTrackingStopped } from './locationEngine';

afterEach(() => {
  mockStart.mockClear();
  mockStop.mockClear();
  mockHasStarted.mockReset();
  mockHasStarted.mockResolvedValue(false);
});

describe('ensureWalkTrackingStopped', () => {
  it('issues a real stop even when the OS reports "not started" (the lying read)', async () => {
    // The regression: hasStarted returns false while the service is actually
    // alive. The old gate returned early here and never stopped anything.
    mockHasStarted.mockResolvedValue(false);

    await ensureWalkTrackingStopped();

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('retries the stop until the OS finally agrees tracking is off', async () => {
    // Reports "still on" twice (stop resolved before teardown), then off.
    mockHasStarted
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await ensureWalkTrackingStopped();

    // One stop per iteration: two "still on" reads + the final clean pass.
    expect(mockStop).toHaveBeenCalledTimes(3);
  });

  it('still fires a stop when the has-started read throws (Expo Go / no module)', async () => {
    mockHasStarted.mockRejectedValue(new Error('native module missing'));

    await ensureWalkTrackingStopped();

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('is bounded — a service the OS never reports as off cannot spin forever', async () => {
    mockHasStarted.mockResolvedValue(true); // never turns off

    await ensureWalkTrackingStopped();

    // Bounded retry cap (8) — the loop exits instead of hanging the finish.
    expect(mockStop).toHaveBeenCalledTimes(8);
  });
});

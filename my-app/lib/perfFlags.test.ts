const fakeFlags: Record<string, boolean | undefined> = {};
let fakeDistinctId = 'user-1';
const fake = {
  ready: () => Promise.resolve(),
  isFeatureEnabled: jest.fn((key: string) => fakeFlags[key]),
  getDistinctId: () => fakeDistinctId,
  reloadFeatureFlagsAsync: jest.fn(async () => ({})),
};
const analyticsMock: { posthog: typeof fake | null } = { posthog: fake };

jest.mock('./analytics', () => analyticsMock);

import {
  isPerfFlagOn,
  PERF_FLAGS,
  resetPerfFlagsForTests,
  readFlagForUser,
  setPerfFlagOverride,
  whenPerfFlagsReady,
} from './perfFlags';

beforeEach(() => {
  for (const key of Object.keys(fakeFlags)) delete fakeFlags[key];
  fake.isFeatureEnabled.mockClear();
  fake.isFeatureEnabled.mockImplementation((key: string) => fakeFlags[key]);
  analyticsMock.posthog = fake;
  fakeDistinctId = 'user-1';
  fake.reloadFeatureFlagsAsync.mockClear();
  resetPerfFlagsForTests({ ready: true });
});

describe('isPerfFlagOn', () => {
  it('is off when PostHog has no value for the flag', () => {
    expect(isPerfFlagOn('walkInstantOpen')).toBe(false);
  });

  it('is on only when PostHog says exactly true', () => {
    fakeFlags[PERF_FLAGS.walkInstantOpen] = true;
    expect(isPerfFlagOn('walkInstantOpen')).toBe(true);
  });

  it('is off without a PostHog client at all (no API key)', () => {
    analyticsMock.posthog = null;
    fakeFlags[PERF_FLAGS.walkInstantOpen] = true;
    expect(isPerfFlagOn('walkInstantOpen')).toBe(false);
  });

  it('is off when the SDK throws', () => {
    fake.isFeatureEnabled.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(isPerfFlagOn('lazyPetContext')).toBe(false);
  });

  it('reads off before PostHog is ready, and does not remember that answer', () => {
    resetPerfFlagsForTests({ ready: false });
    fakeFlags[PERF_FLAGS.lazyPetContext] = true;
    expect(isPerfFlagOn('lazyPetContext')).toBe(false);
    expect(fake.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('keeps its first post-ready answer for the rest of the session', () => {
    fakeFlags[PERF_FLAGS.pushChangeDetection] = true;
    expect(isPerfFlagOn('pushChangeDetection')).toBe(true);
    fakeFlags[PERF_FLAGS.pushChangeDetection] = false;
    expect(isPerfFlagOn('pushChangeDetection')).toBe(true);
    expect(fake.isFeatureEnabled).toHaveBeenCalledTimes(1);
  });

  it('holds each flag independently', () => {
    fakeFlags[PERF_FLAGS.apiTiming] = true;
    expect(isPerfFlagOn('apiTiming')).toBe(true);
    expect(isPerfFlagOn('walkInstantOpen')).toBe(false);
  });

  it('lets an override win, and falls back when it is cleared', () => {
    setPerfFlagOverride('walkInstantOpen', true);
    expect(isPerfFlagOn('walkInstantOpen')).toBe(true);
    setPerfFlagOverride('walkInstantOpen', undefined);
    expect(isPerfFlagOn('walkInstantOpen')).toBe(false);
  });
});

describe('whenPerfFlagsReady', () => {
  it('resolves true at once when flags are already loaded', async () => {
    await expect(whenPerfFlagsReady(10)).resolves.toBe(true);
  });

  it('gives up and resolves false when flags never load', async () => {
    resetPerfFlagsForTests({ ready: false });
    await expect(whenPerfFlagsReady(10)).resolves.toBe(false);
  });

  it('resolves false at once without a PostHog client', async () => {
    resetPerfFlagsForTests({ ready: false });
    analyticsMock.posthog = null;
    await expect(whenPerfFlagsReady(60_000)).resolves.toBe(false);
  });
});

describe('readFlagForUser', () => {
  it('reloads flags for the signed-in user, then reads', async () => {
    fake.reloadFeatureFlagsAsync.mockImplementation(async () => {
      fakeFlags[PERF_FLAGS.announceConnect] = true;
      return {};
    });
    await expect(readFlagForUser('announceConnect', 'user-1', 1000)).resolves.toBe(true);
    expect(fake.reloadFeatureFlagsAsync).toHaveBeenCalledTimes(1);
  });

  it('waits until PostHog has identified this user', async () => {
    fakeDistinctId = 'anonymous';
    setTimeout(() => { fakeDistinctId = 'user-1'; }, 50);
    fakeFlags[PERF_FLAGS.announceConnect] = true;
    await expect(readFlagForUser('announceConnect', 'user-1', 2000)).resolves.toBe(true);
  });

  it('is off when PostHog never identifies this user in time', async () => {
    fakeDistinctId = 'anonymous';
    fakeFlags[PERF_FLAGS.announceConnect] = true;
    await expect(readFlagForUser('announceConnect', 'user-1', 100)).resolves.toBe(false);
  });

  it('does not change what isPerfFlagOn holds', async () => {
    expect(isPerfFlagOn('announceConnect')).toBe(false);
    fakeFlags[PERF_FLAGS.announceConnect] = true;
    await expect(readFlagForUser('announceConnect', 'user-1', 500)).resolves.toBe(true);
    expect(isPerfFlagOn('announceConnect')).toBe(false);
  });
});

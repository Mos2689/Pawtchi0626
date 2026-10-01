const fakeFlags: Record<string, boolean | undefined> = {};
const fake = {
  ready: () => Promise.resolve(),
  isFeatureEnabled: jest.fn((key: string) => fakeFlags[key]),
};
const analyticsMock: { posthog: typeof fake | null } = { posthog: fake };

jest.mock('./analytics', () => analyticsMock);

import { isPerfFlagOn, PERF_FLAGS, resetPerfFlagsForTests, setPerfFlagOverride } from './perfFlags';

beforeEach(() => {
  for (const key of Object.keys(fakeFlags)) delete fakeFlags[key];
  fake.isFeatureEnabled.mockClear();
  fake.isFeatureEnabled.mockImplementation((key: string) => fakeFlags[key]);
  analyticsMock.posthog = fake;
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

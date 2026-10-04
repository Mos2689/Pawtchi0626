import { AUTO_RETRY_DELAYS_MS, loadPhase, nextAutoRetryDelay } from './resilientLoad';

describe('nextAutoRetryDelay', () => {
  it('tries again after 3, 8 and 20 seconds, then waits for the owner', () => {
    expect([1, 2, 3].map(nextAutoRetryDelay)).toEqual([...AUTO_RETRY_DELAYS_MS]);
    expect(nextAutoRetryDelay(4)).toBeNull();
    expect(nextAutoRetryDelay(0)).toBeNull();
  });
});

describe('loadPhase', () => {
  it('never takes away what is on screen', () => {
    expect(loadPhase({ hasData: true, failed: true, inFlight: false })).toBe('stale');
    expect(loadPhase({ hasData: true, failed: true, inFlight: true })).toBe('stale');
    expect(loadPhase({ hasData: true, failed: false, inFlight: true })).toBe('ready');
  });

  it('only an empty screen whose last try failed is unavailable', () => {
    expect(loadPhase({ hasData: false, failed: true, inFlight: false })).toBe('unavailable');
    expect(loadPhase({ hasData: false, failed: true, inFlight: true })).toBe('loading');
    expect(loadPhase({ hasData: false, failed: false, inFlight: false })).toBe('loading');
  });
});

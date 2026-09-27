import { NO_LABELS, orFallback } from './finishDeadlines';

describe('orFallback', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('passes a timely answer through', async () => {
    await expect(orFallback(Promise.resolve('Bondi'), 1_000, 'none')).resolves.toBe('Bondi');
  });

  it('falls back when the work fails', async () => {
    await expect(orFallback(Promise.reject(new Error('offline')), 1_000, 'none')).resolves.toBe('none');
  });

  it('falls back when the work never answers — the hung Finish button', async () => {
    const never = new Promise<string>(() => {});
    const result = orFallback(never, 4_000, 'none');
    jest.advanceTimersByTime(4_000);
    await expect(result).resolves.toBe('none');
  });

  it('offers empty labels as the geocoding fallback', () => {
    expect(NO_LABELS).toEqual({ startLabel: null, endLabel: null, farthestLabel: null, isLoop: false });
  });
});

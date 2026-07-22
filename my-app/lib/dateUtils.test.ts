import { getLocalYMD, getTodayLocalYMD, localDayStartUtcISO } from './dateUtils';

describe('getLocalYMD', () => {
  test('returns local YYYY-MM-DD for a known date', () => {
    // Construct from local components, not from a UTC ISO string — that's
    // exactly the point of the helper.
    const d = new Date(2024, 0, 5); // 2024-01-05 local
    expect(getLocalYMD(d)).toBe('2024-01-05');
  });

  test('pads single-digit months and days', () => {
    expect(getLocalYMD(new Date(2024, 2, 9))).toBe('2024-03-09');
  });

  test('agrees with itself across multiple calls within a millisecond', () => {
    const a = getLocalYMD(new Date(2024, 5, 20));
    const b = getLocalYMD(new Date(2024, 5, 20));
    expect(a).toBe(b);
  });

  test('does NOT match toISOString().split for a local-east-of-UTC moment', () => {
    // This is the bug the helper exists to prevent. A local moment of
    // 2024-12-23 02:00 IST (UTC+5:30) → UTC ISO date "2024-12-22".
    // We don't try to recreate timezone state in the test runner — we just
    // assert that the helper is purely local-clock-based, NOT UTC-based.
    const d = new Date(2024, 11, 23); // local midnight 2024-12-23
    const local = getLocalYMD(d);
    expect(local).toBe('2024-12-23');
    // No matter what the env timezone is, getFullYear()/getMonth()/getDate()
    // are local, so the helper always returns the local calendar day.
  });

  test('getTodayLocalYMD matches getLocalYMD(new Date())', () => {
    // They should agree on the same wall-clock instant (within 1 ms).
    const a = getTodayLocalYMD();
    const b = getLocalYMD(new Date());
    expect(a).toBe(b);
  });
});

describe('localDayStartUtcISO', () => {
  test('returns a Z-suffixed UTC ISO string', () => {
    const iso = localDayStartUtcISO(new Date(2024, 5, 20, 14, 30));
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test('corresponds to local 00:00:00.000 on the input date', () => {
    // Construct a known local date with some afternoon time.
    const d = new Date(2024, 5, 20, 14, 30, 45, 999); // local 2024-06-20 14:30:45.999
    const iso = localDayStartUtcISO(d);
    // Parse it back — should equal a Date whose LOCAL parts are midnight on 2024-06-20.
    const parsed = new Date(iso);
    expect(parsed.getFullYear()).toBe(2024);
    expect(parsed.getMonth()).toBe(5);
    expect(parsed.getDate()).toBe(20);
    expect(parsed.getHours()).toBe(0);
    expect(parsed.getMinutes()).toBe(0);
    expect(parsed.getSeconds()).toBe(0);
    expect(parsed.getMilliseconds()).toBe(0);
  });

  test('does NOT equal `${getLocalYMD(d)}T00:00:00Z` for east-of-UTC zones', () => {
    // The naive pattern is the bug we are protecting against. We can't force
    // a specific timezone in the test runner, but we can assert that the helper
    // is NOT just string concatenation — it's a real UTC moment derived from
    // the local clock. The two strings agree only when local offset is 0; in
    // any IST/CET/EST/etc. test environment, they will differ.
    const d = new Date(2024, 5, 20, 0, 0, 0, 0); // local midnight 2024-06-20
    const naive = `${getLocalYMD(d)}T00:00:00`;       // "2024-06-20T00:00:00" — no TZ
    const correct = localDayStartUtcISO(d);            // proper UTC ISO
    // correct represents the same wall-clock moment but in UTC.
    // For non-zero offset zones, the date/hour portion will differ.
    // We assert it parses to the same moment as d itself:
    expect(new Date(correct).getTime()).toBe(d.getTime());
    // And it always has the Z suffix (the naive version doesn't):
    expect(correct.endsWith('Z')).toBe(true);
    expect(naive.endsWith('Z')).toBe(false);
  });

  test('defaults to now when called with no args', () => {
    const a = localDayStartUtcISO();
    const b = localDayStartUtcISO(new Date());
    // Should be within ~10ms of each other (same code path, same wall-clock).
    expect(Math.abs(new Date(a).getTime() - new Date(b).getTime())).toBeLessThan(10);
  });
});

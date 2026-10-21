import {
  galleryReachable,
  needsLatestFallback,
  railWalkState,
  walkDayLabel,
  walkFeedErrorCopy,
} from './recentWalksFallback';

// Local noon, so day arithmetic is never a timezone edge.
const NOW = new Date(2026, 9, 20, 12, 0, 0);
const at = (y: number, m: number, d: number, h = 9) => new Date(y, m, d, h).toISOString();
const fmt = (opts: Intl.DateTimeFormatOptions, d: Date) => new Intl.DateTimeFormat(undefined, opts).format(d);

describe('needsLatestFallback', () => {
  test('only an empty week reaches past it', () => {
    expect(needsLatestFallback(0)).toBe(true);
    expect(needsLatestFallback(1)).toBe(false);
  });
});

describe('railWalkState', () => {
  test('walks on screen always win, even after a failed refresh', () => {
    expect(railWalkState({ walkCount: 3, loading: false, status: 'error' })).toBe('walks');
    expect(railWalkState({ walkCount: 3, loading: true, status: 'idle' })).toBe('walks');
  });

  test('nothing yet and still working is loading, never empty', () => {
    expect(railWalkState({ walkCount: 0, loading: true, status: 'idle' })).toBe('loading');
    expect(railWalkState({ walkCount: 0, loading: true, status: 'error' })).toBe('loading');
  });

  test('"No walks yet" only after a successful answer found none', () => {
    expect(railWalkState({ walkCount: 0, loading: false, status: 'ready' })).toBe('empty');
  });

  test('a failed load with nothing to show is an error, not empty', () => {
    expect(railWalkState({ walkCount: 0, loading: false, status: 'error' })).toBe('error');
  });

  test('not loading but never answered stays loading', () => {
    expect(railWalkState({ walkCount: 0, loading: false, status: 'idle' })).toBe('loading');
  });
});

describe('galleryReachable', () => {
  test('one walk is enough; the archive must stay reachable', () => {
    expect(galleryReachable(0)).toBe(false);
    expect(galleryReachable(1)).toBe(true);
  });
});

describe('walkDayLabel', () => {
  test('today has no label (the Today card names it)', () => {
    expect(walkDayLabel(at(2026, 9, 20, 7), NOW)).toBeNull();
  });

  test('yesterday', () => {
    expect(walkDayLabel(at(2026, 9, 19), NOW)).toBe('Yesterday');
  });

  test('within the week: the weekday', () => {
    const d = new Date(2026, 9, 15, 9);
    expect(walkDayLabel(d.toISOString(), NOW)).toBe(fmt({ weekday: 'short' }, d));
  });

  test('older: day and month, like Jasper on 6 Oct', () => {
    const d = new Date(2026, 9, 6, 9);
    expect(walkDayLabel(d.toISOString(), NOW)).toBe(fmt({ day: 'numeric', month: 'short' }, d));
  });

  test('another year carries the year', () => {
    const d = new Date(2025, 11, 30, 9);
    expect(walkDayLabel(d.toISOString(), NOW)).toBe(fmt({ day: 'numeric', month: 'short', year: 'numeric' }, d));
  });

  test('an unparseable date has no label', () => {
    expect(walkDayLabel('not a date', NOW)).toBeNull();
  });
});

describe('walkFeedErrorCopy', () => {
  test('reassures, follows the copy spec', () => {
    for (const text of Object.values(walkFeedErrorCopy)) expect(text).not.toMatch(/!/);
    expect(walkFeedErrorCopy.body).toMatch(/safe/);
  });
});

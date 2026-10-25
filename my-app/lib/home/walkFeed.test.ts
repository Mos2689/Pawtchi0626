import {
  galleryReachable,
  hasMorePages,
  mergeWalkPages,
  nextPageCursor,
  railWalkState,
  WALK_PAGE_SIZE,
  walkFeedErrorCopy,
  walkFeedMoreCopy,
} from './walkFeed';

const walk = (id: string, iso: string) => ({ id, started_at: iso });

describe('hasMorePages', () => {
  test('a full page may have more before it; a short page is the end', () => {
    expect(hasMorePages(WALK_PAGE_SIZE)).toBe(true);
    expect(hasMorePages(WALK_PAGE_SIZE - 1)).toBe(false);
    expect(hasMorePages(0)).toBe(false);
  });
});

describe('nextPageCursor', () => {
  test('is the oldest walk held, whatever the order', () => {
    const walks = [
      walk('b', '2026-10-06T05:01:14.689Z'),
      walk('a', '2026-09-12T08:00:00.000Z'),
      walk('c', '2026-10-01T07:00:00.000Z'),
    ];
    expect(nextPageCursor(walks)).toBe('2026-09-12T08:00:00.000Z');
  });

  test('nothing held means no cursor', () => {
    expect(nextPageCursor([])).toBeNull();
  });

  test('ignores an unparseable date', () => {
    expect(nextPageCursor([walk('x', 'nope'), walk('y', '2026-10-01T00:00:00.000Z')])).toBe(
      '2026-10-01T00:00:00.000Z',
    );
  });
});

describe('mergeWalkPages', () => {
  test('appends an older page, newest first', () => {
    const first = [walk('3', '2026-10-06T00:00:00Z'), walk('2', '2026-10-05T00:00:00Z')];
    const next = [walk('1', '2026-09-20T00:00:00Z')];
    expect(mergeWalkPages(first, next).map(w => w.id)).toEqual(['3', '2', '1']);
  });

  test('one card per walk, even if a page repeats one', () => {
    const first = [walk('3', '2026-10-06T00:00:00Z'), walk('2', '2026-10-05T00:00:00Z')];
    const next = [walk('2', '2026-10-05T00:00:00Z'), walk('1', '2026-09-20T00:00:00Z')];
    expect(mergeWalkPages(first, next).map(w => w.id)).toEqual(['3', '2', '1']);
  });

  test('the copy already on screen wins', () => {
    const shown = { ...walk('2', '2026-10-05T00:00:00Z'), label: 'shown' };
    const again = { ...walk('2', '2026-10-05T00:00:00Z'), label: 'again' };
    expect(mergeWalkPages([shown], [again])[0].label).toBe('shown');
  });
});

describe('railWalkState', () => {
  test('walks on screen always win, even after a failed refresh', () => {
    expect(railWalkState({ walkCount: 3, loading: false, status: 'error' })).toBe('walks');
    expect(railWalkState({ walkCount: 3, loading: true, status: 'idle' })).toBe('walks');
  });

  test('nothing yet and still working is loading, never empty', () => {
    expect(railWalkState({ walkCount: 0, loading: true, status: 'idle' })).toBe('loading');
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

describe('copy', () => {
  test('follows the copy spec', () => {
    for (const text of [...Object.values(walkFeedErrorCopy), ...Object.values(walkFeedMoreCopy)]) {
      expect(text).not.toMatch(/!/);
    }
    expect(walkFeedErrorCopy.body).toMatch(/safe/);
  });
});

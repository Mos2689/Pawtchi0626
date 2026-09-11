/**
 * The arrival pill's show/hide rule.
 *
 * Small, but with one non-obvious property worth locking down: it is
 * identity-based, not count-based. The "read one, gain one" case below is
 * exactly what a count-watching implementation gets wrong, and it is the reason
 * this is not a two-line boolean.
 */

import { hasNewAnnouncement, isItemRead } from './announce';
import type { InboxItem } from './types';

function item(id: string, over: Partial<InboxItem> = {}): InboxItem {
  return {
    id,
    source: 'push',
    tone: 'info',
    title: 't',
    body: 'b',
    icon: 'i',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('isItemRead', () => {
  it('reads the local list', () => {
    expect(isItemRead(item('a'), new Set(['a']))).toBe(true);
    expect(isItemRead(item('a'), new Set())).toBe(false);
  });

  it('honours the server, so a read on another device carries over', () => {
    expect(isItemRead(item('a', { meta: { server_read: true } }), new Set())).toBe(true);
  });
});

describe('hasNewAnnouncement', () => {
  it('announces an unread item nobody has seen yet', () => {
    expect(hasNewAnnouncement([item('a')], [], [])).toBe(true);
  });

  it('says nothing when there is nothing unread', () => {
    expect(hasNewAnnouncement([], [], [])).toBe(false);
    expect(hasNewAnnouncement([item('a')], ['a'], [])).toBe(false);
  });

  it('goes quiet once the bell has been tapped', () => {
    expect(hasNewAnnouncement([item('a'), item('b')], [], ['a', 'b'])).toBe(false);
  });

  it('comes back for a genuinely new item and not for an old one', () => {
    expect(hasNewAnnouncement([item('a')], [], ['a'])).toBe(false);
    expect(hasNewAnnouncement([item('a'), item('b')], [], ['a'])).toBe(true);
  });

  it('does not re-announce items that were merely rebuilt or re-sorted', () => {
    // Derived items are rebuilt from scratch every cycle; stable ids are what
    // stop that looking like a fresh arrival every few seconds.
    expect(hasNewAnnouncement([item('b'), item('a')], [], ['a', 'b'])).toBe(false);
  });

  it('announces a new item even when the total count has not risen', () => {
    // The case a count comparison gets wrong: three unread, the owner reads
    // one, a new one lands. The count goes 3 → 2 → 3, never exceeding its
    // previous high, so a count-watching pill would stay silent about a real
    // arrival.
    expect(
      hasNewAnnouncement([item('a'), item('b'), item('c')], [], ['a', 'b', 'c']),
    ).toBe(false);

    expect(
      hasNewAnnouncement([item('a'), item('b'), item('d')], ['c'], ['a', 'b', 'c']),
    ).toBe(true);
  });

  it('does not announce an item the server already knows was read', () => {
    expect(hasNewAnnouncement([item('a', { meta: { server_read: true } })], [], [])).toBe(false);
  });

  it('ignores announced ids for items that are no longer in the feed', () => {
    // The list outlives the items it names; a stale entry must not suppress
    // anything current.
    expect(hasNewAnnouncement([item('new')], [], ['gone', 'also-gone'])).toBe(true);
  });
});

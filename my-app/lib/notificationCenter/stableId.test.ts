/**
 * Item identity is the load-bearing detail of the whole center: read state is
 * stored against these strings, so an id that shifts when the underlying data
 * shifts makes every item unread again on the next rebuild — and the badge
 * resurrects itself all day.
 */

import {
  PERSISTENT_SCOPE,
  dayScope,
  isStaleDayScoped,
  scopeOf,
  stableId,
} from './stableId';

describe('stableId', () => {
  it('is identical for identical rule and scope', () => {
    expect(stableId('nudge', 'meals_missing', '2026-08-18'))
      .toBe(stableId('nudge', 'meals_missing', '2026-08-18'));
  });

  it('separates the same rule across sources', () => {
    expect(stableId('nudge', 'weigh_in_due', PERSISTENT_SCOPE))
      .not.toBe(stableId('push', 'weigh_in_due', PERSISTENT_SCOPE));
  });

  it('separates the same rule across days', () => {
    expect(stableId('nudge', 'meals_missing', '2026-08-18'))
      .not.toBe(stableId('nudge', 'meals_missing', '2026-08-19'));
  });

  it('keeps the shape parseable when a caller passes a colon', () => {
    const id = stableId('push', 'vet:checkin', 'case:42');
    expect(id.split(':')).toHaveLength(3);
    expect(scopeOf(id)).toBe('case_42');
  });

  it('falls back rather than producing an empty segment', () => {
    expect(stableId('nudge', '  ', PERSISTENT_SCOPE)).toBe('nudge:unknown:persistent');
  });
});

describe('dayScope', () => {
  it('is the local calendar day, not UTC', () => {
    // 23:30 local on the 18th is the 19th in UTC for any positive offset. The
    // scope must follow the owner's day — a "log your meals" item read at
    // 11:30pm should not already belong to tomorrow.
    const lateLocalEvening = new Date(2026, 7, 18, 23, 30, 0);
    expect(dayScope(lateLocalEvening)).toBe('2026-08-18');
  });
});

describe('isStaleDayScoped', () => {
  const today = new Date(2026, 7, 18, 12, 0, 0);

  it('marks yesterday stale so the item can return', () => {
    expect(isStaleDayScoped(stableId('nudge', 'meals_missing', '2026-08-17'), today)).toBe(true);
  });

  it('leaves today alone', () => {
    expect(isStaleDayScoped(stableId('nudge', 'meals_missing', '2026-08-18'), today)).toBe(false);
  });

  it('never expires a persistent item', () => {
    // A clinical condition and a sent push are both facts, not statements about
    // today. Sweeping their read state would make a vet warning shout again
    // every morning.
    expect(isStaleDayScoped(stableId('banner', 'severe_obesity_vet', PERSISTENT_SCOPE), today)).toBe(false);
  });

  it('never expires an entity-scoped item', () => {
    expect(isStaleDayScoped(stableId('push', 'milestone_abc', 'row-9f2c'), today)).toBe(false);
  });

  it('ignores strings that are not ours', () => {
    expect(isStaleDayScoped('garbage', today)).toBe(false);
    expect(isStaleDayScoped('', today)).toBe(false);
  });
});

import type { Announcement } from './catalogue';
import { isEligible, pickAnnouncement, type AnnouncementContext } from './eligibility';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-20T09:00:00Z');

function entry(over: Partial<Announcement> = {}): Announcement {
  return {
    id: 'a',
    priority: 1,
    audience: 'everyone',
    maxShows: 3,
    minHoursBetween: 24,
    maxDismissals: 2,
    media: 'connect-loop',
    title: 'Title',
    body: 'Body',
    cta: { label: 'Go', route: '/x' },
    ...over,
  };
}

const ctx = (over: Partial<AnnouncementContext> = {}): AnnouncementContext => ({
  isDogOwner: true,
  isFlagOn: () => true,
  ...over,
});

const rec = (over: Partial<{ shows: number; dismissals: number; completed: boolean; lastShownAt: number | null }> = {}) => ({
  shows: 0,
  dismissals: 0,
  completed: false,
  lastShownAt: null,
  ...over,
});

describe('isEligible', () => {
  test('a never-seen entry shows', () => {
    expect(isEligible(entry(), undefined, ctx(), NOW)).toBe(true);
  });

  test('respects the start and end of the window', () => {
    expect(isEligible(entry({ startsAt: '2026-10-21T00:00:00Z' }), undefined, ctx(), NOW)).toBe(false);
    expect(isEligible(entry({ endsAt: '2026-10-19T00:00:00Z' }), undefined, ctx(), NOW)).toBe(false);
    expect(
      isEligible(entry({ startsAt: '2026-10-19T00:00:00Z', endsAt: '2026-10-21T00:00:00Z' }), undefined, ctx(), NOW),
    ).toBe(true);
  });

  test('a gate flag that is off hides it', () => {
    expect(isEligible(entry({ gateFlag: 'announceConnect' }), undefined, ctx({ isFlagOn: () => false }), NOW)).toBe(false);
  });

  test('the flag is not read for an entry that is already capped', () => {
    const isFlagOn = jest.fn(() => true);
    isEligible(entry({ gateFlag: 'announceConnect' }), rec({ shows: 3 }), ctx({ isFlagOn }), NOW);
    expect(isFlagOn).not.toHaveBeenCalled();
  });

  test('dog-owner announcements skip cat-only accounts', () => {
    expect(isEligible(entry({ audience: 'dog_owners' }), undefined, ctx({ isDogOwner: false }), NOW)).toBe(false);
    expect(isEligible(entry({ audience: 'everyone' }), undefined, ctx({ isDogOwner: false }), NOW)).toBe(true);
  });

  test('stops after the show cap', () => {
    expect(isEligible(entry(), rec({ shows: 2, lastShownAt: NOW - 48 * HOUR }), ctx(), NOW)).toBe(true);
    expect(isEligible(entry(), rec({ shows: 3, lastShownAt: NOW - 48 * HOUR }), ctx(), NOW)).toBe(false);
  });

  test('stops after two dismissals', () => {
    expect(isEligible(entry(), rec({ shows: 2, dismissals: 2, lastShownAt: NOW - 48 * HOUR }), ctx(), NOW)).toBe(false);
  });

  test('stops for good once the CTA was tapped', () => {
    expect(isEligible(entry(), rec({ shows: 1, completed: true, lastShownAt: NOW - 48 * HOUR }), ctx(), NOW)).toBe(false);
  });

  test('waits the minimum spacing between showings', () => {
    expect(isEligible(entry(), rec({ shows: 1, lastShownAt: NOW - 23 * HOUR }), ctx(), NOW)).toBe(false);
    expect(isEligible(entry(), rec({ shows: 1, lastShownAt: NOW - 24 * HOUR }), ctx(), NOW)).toBe(true);
  });
});

describe('pickAnnouncement', () => {
  test('returns null when nothing is eligible', () => {
    expect(pickAnnouncement([entry({ gateFlag: 'announceConnect' })], {}, ctx({ isFlagOn: () => false }), NOW)).toBeNull();
  });

  test('the highest priority eligible entry wins, and only one', () => {
    const low = entry({ id: 'low', priority: 1 });
    const high = entry({ id: 'high', priority: 5 });
    expect(pickAnnouncement([low, high], {}, ctx(), NOW)?.id).toBe('high');
  });

  test('falls through to the next entry when the top one is capped', () => {
    const low = entry({ id: 'low', priority: 1 });
    const high = entry({ id: 'high', priority: 5 });
    expect(pickAnnouncement([low, high], { high: rec({ completed: true }) }, ctx(), NOW)?.id).toBe('low');
  });
});

/**
 * `primeOuting` invents a walk screen out of what the trail list already knows,
 * so the walk opens with its title and meeting point showing instead of blank.
 *
 * Everything it invents is missing the part that matters: there is no roster,
 * because the server has not been asked about this walk at all.
 *
 * ── The regression this pins ───────────────────────────────────────────────
 *
 * It used to write that stand-in with `writeSnapshot`, which marks a value as
 * FETCHED. The walk screen skips its load inside the freshness window, so it
 * skipped the very fetch that would have filled the roster in — and then
 * rendered the empty stand-in as though it were the answer.
 *
 * What a host saw: "Who's walking" empty, no dog selected, and "Start the walk"
 * greyed out on every planned walk in every trail. A screen that looked loaded
 * and was not, which is the worst of the three states a screen can be in.
 *
 * `writeOptimistic` is the distinction — paintable, never fresh — and it exists
 * because `rememberNewPack` hit this same trap first. Two writers have now made
 * the same mistake, so this is the test that says it out loud.
 */

// The module reaches for the Supabase client at import time. Nothing under test
// here touches the network — these are pure cache writes.
jest.mock('./supabase', () => ({ supabase: {} }));

import {
  cacheKey,
  clearCommunityCache,
  isFresh,
  readSnapshot,
  writeSnapshot,
} from './communityCache';
import { primeOuting, type CommunityPack, type CommunityWalk } from './communityWalks';
import { resetPerfFlagsForTests, setPerfFlagOverride } from './perfFlags';

const pack: CommunityPack = {
  id: 'p1',
  name: 'Monday trail',
  owner_id: 'owner-1',
  created_at: '2026-09-22T08:00:00Z',
  updated_at: '2026-09-22T08:00:00Z',
};

const walk = (id: string, title = 'Thursday test walk'): CommunityWalk => ({
  id,
  pack_id: 'p1',
  organizer_id: 'owner-1',
  title,
  scheduled_for: '2026-09-24T12:10:00Z',
  meeting_label: 'Candolim',
  meeting_lat: null,
  meeting_lng: null,
  note: null,
  state: 'planned',
  started_at: null,
  ended_at: null,
  created_at: '2026-09-22T08:00:00Z',
  updated_at: '2026-09-22T08:00:00Z',
});

beforeEach(() => clearCommunityCache());

describe('primeOuting', () => {
  it('paints the plan straight away', () => {
    primeOuting(walk('w1'), pack);
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    expect(snapshot?.walk.title).toBe('Thursday test walk');
    expect(snapshot?.walk.meeting_label).toBe('Candolim');
  });

  it('never marks the empty stand-in as fresh', () => {
    primeOuting(walk('w1'), pack);
    // THE regression. Fresh here means the walk screen skips its load, and the
    // roster it was about to fetch never arrives.
    expect(isFresh(cacheKey.outing('w1'))).toBe(false);
  });

  it('flags itself as partial, so nothing mistakes it for a roster', () => {
    primeOuting(walk('w1'), pack);
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    expect(snapshot?.partial).toBe(true);
    expect(snapshot?.attendance).toEqual([]);
  });

  it('does not downgrade a real answer to a partial one', () => {
    writeSnapshot(cacheKey.outing('w1'), {
      walk: walk('w1', 'Old title'),
      pack,
      attendance: [{ user_id: 'u2', status: 'coming' }],
      notAsked: [],
    });
    primeOuting(walk('w1', 'Renamed walk'), pack);
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    // The roster survives, and the newer title from the trail list wins.
    expect(snapshot?.attendance).toHaveLength(1);
    expect(snapshot?.partial).toBeFalsy();
    expect(snapshot?.walk.title).toBe('Renamed walk');
  });

  it('keeps a real answer fresh when it re-primes it', () => {
    writeSnapshot(cacheKey.outing('w1'), {
      walk: walk('w1'),
      pack,
      attendance: [{ user_id: 'u2', status: 'coming' }],
      notAsked: [],
    });
    primeOuting(walk('w1', 'Renamed walk'), pack);
    // A fetched roster stays fetched: re-priming must not cost a round trip.
    expect(isFresh(cacheKey.outing('w1'))).toBe(true);
  });

  it('does not make a stale answer look fresh again', () => {
    const then = Date.now() - 60_000;
    writeSnapshot(
      cacheKey.outing('w1'),
      { walk: walk('w1'), pack, attendance: [{ user_id: 'u2', status: 'coming' }], notAsked: [] },
      then,
    );
    primeOuting(walk('w1', 'Renamed walk'), pack);
    // Opening the trail and a walk in turn re-primes every time. If that reset
    // the window, a roster could sit stale for as long as somebody kept
    // wandering between the two screens — looking current the whole while.
    expect(isFresh(cacheKey.outing('w1'))).toBe(false);
  });
});

/**
 * perf-walk-instant-open: when the meetup read carries a walk's answers, the
 * prime is the whole walk screen (lib/community/outingDoc.ts), not a plan with
 * nobody in it. Written optimistic — the walk screen still refetches — and
 * never allowed to override a server answer from the last few seconds.
 */
describe('primeOuting with the meetup roster (perf-walk-instant-open)', () => {
  const members = [
    {
      pack_id: 'p1', user_id: 'owner-1', role: 'owner' as const, joined_at: '2026-09-01T00:00:00Z', notifications_muted: false,
      person: { id: 'owner-1', username: 'host', full_name: 'Host', avatar_url: null },
      dogs: [{ id: 'd1', owner_id: 'owner-1', name: 'Sma', image_url: null }],
    },
    {
      pack_id: 'p1', user_id: 'u2', role: 'member' as const, joined_at: '2026-09-02T00:00:00Z', notifications_muted: false,
      person: { id: 'u2', username: 'ana', full_name: 'Ana', avatar_url: null },
      dogs: [{ id: 'd2', owner_id: 'u2', name: 'Olive', image_url: null }],
    },
  ];
  const row = (user_id: string, status: string) => ({
    row: {
      walk_id: 'w1', user_id, status, share_location: false, checked_in_at: null,
      joined_at: null, finished_at: null, updated_at: '2026-09-22T09:00:00Z',
    },
    pet_ids: [],
  });

  afterEach(() => resetPerfFlagsForTests());

  it('paints the whole roster when the flag is on', () => {
    setPerfFlagOverride('walkInstantOpen', true);
    primeOuting(walk('w1'), pack, { members, attendance: [row('owner-1', 'coming')] });
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    expect(snapshot?.partial).toBeFalsy();
    expect(snapshot?.attendance.map((r: any) => r.user_id)).toEqual(['owner-1']);
    expect(snapshot?.notAsked.map((r: any) => r.user_id)).toEqual(['u2']);
    // Still a stand-in as far as freshness goes: the walk screen refetches.
    expect(isFresh(cacheKey.outing('w1'))).toBe(false);
  });

  it('ignores the roster when the flag is off — build 98 exactly', () => {
    setPerfFlagOverride('walkInstantOpen', false);
    primeOuting(walk('w1'), pack, { members, attendance: [row('owner-1', 'coming')] });
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    expect(snapshot?.partial).toBe(true);
    expect(snapshot?.attendance).toEqual([]);
  });

  it('falls back to the partial prime when the roster cannot be reproduced', () => {
    setPerfFlagOverride('walkInstantOpen', true);
    primeOuting(walk('w1'), pack, { members, attendance: [row('not-a-member', 'coming')] });
    expect(readSnapshot<any>(cacheKey.outing('w1'))?.partial).toBe(true);
  });

  it('a server answer from moments ago still wins', () => {
    setPerfFlagOverride('walkInstantOpen', true);
    writeSnapshot(cacheKey.outing('w1'), {
      walk: walk('w1'),
      pack,
      attendance: [{ user_id: 'u2', status: 'walking' }],
      notAsked: [],
    });
    primeOuting(walk('w1', 'Renamed walk'), pack, { members, attendance: [] });
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    expect(snapshot?.attendance).toEqual([{ user_id: 'u2', status: 'walking' }]);
    expect(snapshot?.walk.title).toBe('Renamed walk');
    expect(isFresh(cacheKey.outing('w1'))).toBe(true);
  });

  it('replaces an older complete answer with the newer meetup read', () => {
    setPerfFlagOverride('walkInstantOpen', true);
    writeSnapshot(
      cacheKey.outing('w1'),
      { walk: walk('w1'), pack, attendance: [], notAsked: [] },
      Date.now() - 60_000,
    );
    primeOuting(walk('w1'), pack, { members, attendance: [row('u2', 'coming')] });
    const snapshot = readSnapshot<any>(cacheKey.outing('w1'));
    expect(snapshot?.attendance.map((r: any) => r.status)).toEqual(['coming']);
    expect(isFresh(cacheKey.outing('w1'))).toBe(false);
  });
});

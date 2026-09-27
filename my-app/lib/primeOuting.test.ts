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

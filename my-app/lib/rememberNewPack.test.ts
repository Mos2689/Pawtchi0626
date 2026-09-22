/**
 * `rememberNewPack` puts a trail on Home's list before the server has been
 * asked about it, which makes every claim it invents a claim the host will
 * read. The rules worth pinning down are the ones that would be wrong rather
 * than merely early: who is in it, who owns it, and that it cannot appear twice.
 */

// The module reaches for the Supabase client at import time. Nothing under test
// here touches the network — this is a pure cache write.
jest.mock('./supabase', () => ({ supabase: {} }));

import { cacheKey, clearCommunityCache, readSnapshot, writeSnapshot } from './communityCache';
import { rememberNewPack, type CommunityPack, type CommunityWalk } from './communityWalks';

const pack = (id: string, name = 'Morning crew'): CommunityPack => ({
  id,
  name,
  owner_id: 'owner-1',
  created_at: '2026-09-19T08:00:00Z',
  updated_at: '2026-09-19T08:00:00Z',
});

const walk = (id: string): CommunityWalk => ({
  id,
  pack_id: 'p1',
  organizer_id: 'owner-1',
  title: 'Morning crew',
  scheduled_for: null,
  meeting_label: 'By the gates',
  meeting_lat: null,
  meeting_lng: null,
  note: null,
  state: 'planned',
  started_at: null,
  ended_at: null,
  created_at: '2026-09-19T08:00:00Z',
  updated_at: '2026-09-19T08:00:00Z',
});

const cached = () => readSnapshot<CommunityPack[]>(cacheKey.packs()) ?? [];

beforeEach(() => clearCommunityCache());

describe('rememberNewPack', () => {
  it('puts the new trail first, where the host is looking', () => {
    writeSnapshot(cacheKey.packs(), [pack('old')]);
    rememberNewPack(pack('new'), walk('w1'));
    expect(cached().map(row => row.id)).toEqual(['new', 'old']);
  });

  it('works when there is no cached list at all', () => {
    rememberNewPack(pack('first'), walk('w1'));
    expect(cached().map(row => row.id)).toEqual(['first']);
  });

  it('states only what is certain about a brand-new trail', () => {
    rememberNewPack(pack('new'), walk('w1'));
    const entry = cached()[0];
    // One member, because nobody has been invited yet — let alone accepted.
    expect(entry.memberCount).toBe(1);
    expect(entry.role).toBe('owner');
    // No photo can exist: nobody has walked it.
    expect(entry.coverPath).toBeNull();
    expect(entry.nextWalk?.id).toBe('w1');
  });

  it('carries the trail through even when its first walk failed', () => {
    // The trail is real; only the walk is missing. The card says "Plan the
    // first walk", which is true and actionable.
    rememberNewPack(pack('new'), null);
    expect(cached()[0].nextWalk).toBeNull();
    expect(cached()).toHaveLength(1);
  });

  it('never lists the same trail twice', () => {
    rememberNewPack(pack('new'), null);
    rememberNewPack(pack('new'), walk('w1'));
    expect(cached()).toHaveLength(1);
    // The later call wins — it knows strictly more.
    expect(cached()[0].nextWalk?.id).toBe('w1');
  });

  it('does not disturb trails already on the list', () => {
    writeSnapshot(cacheKey.packs(), [pack('a', 'Park regulars'), pack('b', 'Beach lot')]);
    rememberNewPack(pack('c'), null);
    expect(cached().map(row => row.name)).toEqual(['Morning crew', 'Park regulars', 'Beach lot']);
  });
});

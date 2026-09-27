/**
 * Who runs a trail.
 *
 * `isTrailHost` is small enough to look not worth testing, which is exactly
 * why it is: it is an AUTHORISATION predicate, it decides what five surfaces
 * show, and the two ways it could be wrong — saying yes to a stranger, or
 * saying yes when nobody is signed in — are both silent. The database refuses
 * the action either way (20260922020000_trail_host_authority), so a bug here
 * does not leak data; it offers somebody a button that then fails, which is
 * its own kind of broken.
 */

// The module reaches for the Supabase client at import time. Nothing here
// touches the network — this is a pure comparison.
jest.mock('./supabase', () => ({ supabase: {} }));

import { isTrailHost, type CommunityPack } from './communityWalks';

const pack = (ownerId: string): Pick<CommunityPack, 'owner_id'> => ({ owner_id: ownerId });

describe('isTrailHost', () => {
  it('is true for the trail owner', () => {
    expect(isTrailHost(pack('owner-1'), 'owner-1')).toBe(true);
  });

  it('is false for a member who is not the owner', () => {
    expect(isTrailHost(pack('owner-1'), 'member-2')).toBe(false);
  });

  it('is false when nobody is signed in', () => {
    // The case that matters most: `undefined === undefined` is true, so a
    // naive comparison would hand host powers to a signed-out session reading
    // a pack whose owner_id had also failed to load.
    expect(isTrailHost(pack('owner-1'), null)).toBe(false);
    expect(isTrailHost(pack('owner-1'), undefined)).toBe(false);
    expect(isTrailHost(pack('owner-1'), '')).toBe(false);
  });

  it('is false when the pack has not loaded yet', () => {
    // Screens read this during the first paint, before the snapshot arrives.
    // Defaulting to "host" for a moment would flash controls at a member.
    expect(isTrailHost(null, 'owner-1')).toBe(false);
    expect(isTrailHost(undefined, 'owner-1')).toBe(false);
  });

  it('is false when neither is known', () => {
    expect(isTrailHost(null, null)).toBe(false);
    expect(isTrailHost(undefined, undefined)).toBe(false);
  });

  it('does not treat a blank owner as a wildcard', () => {
    expect(isTrailHost(pack(''), '')).toBe(false);
  });

  it('compares exactly — no case folding, no trimming', () => {
    // These are UUIDs from the same column on both sides, so anything other
    // than an exact match would be papering over a bug elsewhere.
    expect(isTrailHost(pack('Owner-1'), 'owner-1')).toBe(false);
    expect(isTrailHost(pack(' owner-1'), 'owner-1')).toBe(false);
  });
});

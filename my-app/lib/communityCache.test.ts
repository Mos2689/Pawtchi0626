/**
 * The cache's one rule that can fail silently: how long a snapshot may be
 * shown. Everything else here is a Map — if writing and reading broke, a screen
 * would be blank and someone would notice in a second. An entry that outlives
 * its welcome looks exactly like a correct one, which is the failure worth a
 * test.
 */

import {
  MAX_SNAPSHOT_AGE_MS,
  cacheKey,
  clearCommunityCache,
  readSnapshot,
  writeSnapshot,
} from './communityCache';

const T0 = 1_700_000_000_000;

beforeEach(() => clearCommunityCache());

describe('readSnapshot', () => {
  it('returns what was written', () => {
    writeSnapshot('pack:a', { name: 'Morning crew' }, T0);
    expect(readSnapshot<{ name: string }>('pack:a', T0)).toEqual({ name: 'Morning crew' });
  });

  it('returns null for a key never written', () => {
    expect(readSnapshot('pack:missing', T0)).toBeNull();
  });

  it('still serves an entry on the last millisecond of its life', () => {
    writeSnapshot('pack:a', 1, T0);
    expect(readSnapshot('pack:a', T0 + MAX_SNAPSHOT_AGE_MS)).toBe(1);
  });

  it('refuses an entry one millisecond past it', () => {
    writeSnapshot('pack:a', 1, T0);
    expect(readSnapshot('pack:a', T0 + MAX_SNAPSHOT_AGE_MS + 1)).toBeNull();
  });

  it('drops an expired entry rather than re-checking it forever', () => {
    writeSnapshot('pack:a', 1, T0);
    readSnapshot('pack:a', T0 + MAX_SNAPSHOT_AGE_MS + 1);
    // Reading again with a timestamp that WOULD have been valid must still miss:
    // the entry is gone, not merely hidden. Otherwise a clock that jumps
    // backwards — a timezone change, an NTP correction — could resurrect it.
    expect(readSnapshot('pack:a', T0)).toBeNull();
  });

  it('replaces wholesale rather than merging', () => {
    writeSnapshot('pack:a', { name: 'Old', members: 4 }, T0);
    writeSnapshot('pack:a', { name: 'New' }, T0);
    expect(readSnapshot('pack:a', T0)).toEqual({ name: 'New' });
  });

  it('refreshes the age on rewrite', () => {
    writeSnapshot('pack:a', 1, T0);
    writeSnapshot('pack:a', 2, T0 + MAX_SNAPSHOT_AGE_MS);
    expect(readSnapshot('pack:a', T0 + MAX_SNAPSHOT_AGE_MS + 1)).toBe(2);
  });
});

describe('clearCommunityCache', () => {
  it('leaves nothing for the next account to read', () => {
    writeSnapshot(cacheKey.packs(), [{ id: 'p1' }], T0);
    writeSnapshot(cacheKey.pack('p1'), { pack: { id: 'p1' } }, T0);
    writeSnapshot(cacheKey.outing('w1'), { walk: { id: 'w1' } }, T0);
    clearCommunityCache();
    expect(readSnapshot(cacheKey.packs(), T0)).toBeNull();
    expect(readSnapshot(cacheKey.pack('p1'), T0)).toBeNull();
    expect(readSnapshot(cacheKey.outing('w1'), T0)).toBeNull();
  });
});

describe('cacheKey', () => {
  it('keeps a pack and a walk of the same id apart', () => {
    expect(cacheKey.pack('x')).not.toBe(cacheKey.outing('x'));
  });

  it('gives different packs different keys', () => {
    expect(cacheKey.pack('a')).not.toBe(cacheKey.pack('b'));
  });
});

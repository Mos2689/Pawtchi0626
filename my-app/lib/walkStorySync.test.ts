/**
 * The pending-story marker points at a walk_sessions row. Whose row matters:
 * a marker left behind by one account must be invisible to the next one on the
 * same device, and marking a story seen must never quiet someone else's ring.
 */

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (k: string) => Promise.resolve(mockStore.has(k) ? mockStore.get(k)! : null),
  setItem: (k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  },
  removeItem: (k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  },
}));

import {
  clearPendingWalkStory,
  isStoryFresh,
  markWalkStorySeen,
  pendingWalkStoryKey,
  readPendingWalkStory,
  setPendingWalkStory,
  type PendingWalkStory,
} from './walkStorySync';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';

beforeEach(() => {
  mockStore.clear();
});

describe('the pending story marker', () => {
  it('is readable only by the owner who recorded the walk', async () => {
    await setPendingWalkStory('walk-1', 'pet-1', OWNER_A);

    const mine = await readPendingWalkStory(OWNER_A);
    expect(mine?.walkSessionId).toBe('walk-1');
    expect(mine?.seen).toBe(false);
    await expect(readPendingWalkStory(OWNER_B)).resolves.toBeNull();
  });

  it('is not written, or read, without an account', async () => {
    await setPendingWalkStory('walk-1', 'pet-1', null);

    expect([...mockStore.keys()]).toEqual([]);
    await expect(readPendingWalkStory(null)).resolves.toBeNull();
  });

  it('supersedes the previous walk for that owner only', async () => {
    await setPendingWalkStory('walk-1', 'pet-1', OWNER_A);
    await setPendingWalkStory('walk-2', 'pet-1', OWNER_A);
    await setPendingWalkStory('walk-3', 'pet-9', OWNER_B);

    await expect(readPendingWalkStory(OWNER_A)).resolves.toMatchObject({
      walkSessionId: 'walk-2',
    });
    await expect(readPendingWalkStory(OWNER_B)).resolves.toMatchObject({
      walkSessionId: 'walk-3',
    });
  });

  it('marks seen for one account without touching the other', async () => {
    await setPendingWalkStory('walk-1', 'pet-1', OWNER_A);
    await setPendingWalkStory('walk-2', 'pet-9', OWNER_B);

    await markWalkStorySeen(OWNER_A);

    await expect(readPendingWalkStory(OWNER_A)).resolves.toMatchObject({ seen: true });
    await expect(readPendingWalkStory(OWNER_B)).resolves.toMatchObject({ seen: false });
  });

  it('clears only when the discarded walk is the one pending, and only for that owner', async () => {
    await setPendingWalkStory('walk-1', 'pet-1', OWNER_A);
    await setPendingWalkStory('walk-1', 'pet-9', OWNER_B);

    await clearPendingWalkStory('walk-other', OWNER_A);
    expect(mockStore.has(pendingWalkStoryKey(OWNER_A))).toBe(true);

    await clearPendingWalkStory('walk-1', OWNER_A);
    expect(mockStore.has(pendingWalkStoryKey(OWNER_A))).toBe(false);
    expect(mockStore.has(pendingWalkStoryKey(OWNER_B))).toBe(true);
  });
});

describe('isStoryFresh', () => {
  const marker = (over: Partial<PendingWalkStory> = {}): PendingWalkStory => ({
    walkSessionId: 'walk-1',
    petId: 'pet-1',
    generatedAt: new Date().toISOString(),
    seen: false,
    ...over,
  });

  it('is fresh for an unseen story generated today', () => {
    expect(isStoryFresh(marker())).toBe(true);
  });

  it('is not fresh once seen, missing, dated before today, or unparseable', () => {
    // Two days back rather than one: 24 h before a local midnight can land on
    // the same calendar day across a DST boundary.
    const earlier = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    expect(isStoryFresh(marker({ seen: true }))).toBe(false);
    expect(isStoryFresh(null)).toBe(false);
    expect(isStoryFresh(marker({ generatedAt: earlier }))).toBe(false);
    expect(isStoryFresh(marker({ generatedAt: 'not-a-date' }))).toBe(false);
  });
});

/**
 * The cache's one rule that can fail silently: how long a snapshot may be
 * shown. Everything else here is a Map — if writing and reading broke, a screen
 * would be blank and someone would notice in a second. An entry that outlives
 * its welcome looks exactly like a correct one, which is the failure worth a
 * test.
 */

import {
  FRESH_SNAPSHOT_MS,
  TOGETHER_READ_TIMEOUT_MS,
  MAX_SNAPSHOT_AGE_MS,
  beginWrite,
  cacheKey,
  clearCommunityCache,
  commitSnapshot,
  invalidate,
  isFresh,
  isInFlight,
  readSnapshot,
  share,
  writeOptimistic,
  writeSnapshot,
} from './communityCache';
import { withTimeout } from './withTimeout';

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

/**
 * The refetch window and the in-flight share.
 *
 * Both exist to stop the same thing — Together asking a question it already
 * has the answer to — and both fail invisibly. A broken freshness check just
 * makes more requests; a broken share makes two answers race and lets the
 * slower network win. Neither shows up as an error.
 */
describe('isFresh', () => {
  it('is false for a key never written', () => {
    expect(isFresh('packs', T0)).toBe(false);
  });

  it('is true immediately after a write', () => {
    writeSnapshot(cacheKey.packs(), [1], T0);
    expect(isFresh(cacheKey.packs(), T0)).toBe(true);
  });

  it('holds for the whole window and not a millisecond longer', () => {
    writeSnapshot(cacheKey.packs(), [1], T0);
    expect(isFresh(cacheKey.packs(), T0 + FRESH_SNAPSHOT_MS)).toBe(true);
    expect(isFresh(cacheKey.packs(), T0 + FRESH_SNAPSHOT_MS + 1)).toBe(false);
  });

  it('is a shorter window than the one a snapshot may be PAINTED for', () => {
    // The two answer different questions and must not be collapsed: five
    // minutes is how long a stale frame may be shown, twenty seconds is how
    // long asking again is pointless. If these ever met, a screen would either
    // refetch constantly or paint something very old without correcting it.
    expect(FRESH_SNAPSHOT_MS).toBeLessThan(MAX_SNAPSHOT_AGE_MS);
  });

  it('stops being fresh once the cache is cleared', () => {
    writeSnapshot(cacheKey.packs(), [1], T0);
    clearCommunityCache();
    expect(isFresh(cacheKey.packs(), T0)).toBe(false);
  });
});

describe('share', () => {
  it('runs the work once for overlapping callers', async () => {
    let runs = 0;
    const run = () => { runs += 1; return new Promise<number>(r => setTimeout(() => r(7), 10)); };

    const [a, b, c] = await Promise.all([
      share('k', run), share('k', run), share('k', run),
    ]);

    expect(runs).toBe(1);
    // All three get the same answer, not merely an answer each.
    expect([a, b, c]).toEqual([7, 7, 7]);
  });

  it('lets a later caller start fresh once the first has settled', async () => {
    let runs = 0;
    const run = async () => { runs += 1; return runs; };

    expect(await share('k', run)).toBe(1);
    expect(await share('k', run)).toBe(2);
  });

  it('does not wedge the key when the work fails', async () => {
    // The failure mode this guards: a rejected promise left in the map means
    // every later caller re-receives the same rejection for ever, and the
    // screen can never recover without a restart.
    await expect(share('k', () => Promise.reject(new Error('offline')))).rejects.toThrow('offline');
    expect(isInFlight('k')).toBe(false);
    await expect(share('k', () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('shares the rejection with everyone waiting on it', async () => {
    const run = () => new Promise((_, reject) => setTimeout(() => reject(new Error('offline')), 5));
    const both = Promise.all([
      share('k', run).catch(e => (e as Error).message),
      share('k', run).catch(e => (e as Error).message),
    ]);
    expect(await both).toEqual(['offline', 'offline']);
  });

  it('reports what is in the air', async () => {
    expect(isInFlight('k')).toBe(false);
    const pending = share('k', () => new Promise<void>(r => setTimeout(r, 5)));
    expect(isInFlight('k')).toBe(true);
    await pending;
    expect(isInFlight('k')).toBe(false);
  });

  it('is forgotten on sign-out', async () => {
    // A request started under the previous account must not resolve into a
    // cache the next account will read.
    const pending = share('k', () => new Promise<void>(r => setTimeout(r, 5)));
    clearCommunityCache();
    expect(isInFlight('k')).toBe(false);
    await pending;
  });

  it('keys are independent', async () => {
    let a = 0; let b = 0;
    await Promise.all([
      share('one', async () => { a += 1; }),
      share('two', async () => { b += 1; }),
    ]);
    expect([a, b]).toEqual([1, 1]);
  });
});

describe('writeOptimistic', () => {
  it('is paintable, exactly like a real answer', () => {
    writeOptimistic(cacheKey.packs(), ['made up'], T0);
    expect(readSnapshot(cacheKey.packs(), T0)).toEqual(['made up']);
  });

  it('is NEVER fresh, so the refetch it stands in for still happens', () => {
    // The regression this exists to prevent: `rememberNewPack` writes an
    // optimistic row so a host sees the trail they just made. If that write
    // counted as fresh it would suppress the refetch that replaces it, and the
    // host would keep an invented row — no dogs, member count of one — until
    // the window expired.
    writeOptimistic(cacheKey.packs(), ['made up'], T0);
    expect(isFresh(cacheKey.packs(), T0)).toBe(false);
  });

  it('ages out on the same clock as a real answer', () => {
    writeOptimistic(cacheKey.packs(), ['made up'], T0);
    expect(readSnapshot(cacheKey.packs(), T0 + MAX_SNAPSHOT_AGE_MS)).toEqual(['made up']);
    expect(readSnapshot(cacheKey.packs(), T0 + MAX_SNAPSHOT_AGE_MS + 1)).toBeNull();
  });

  it('a real answer landing afterwards makes the key fresh again', () => {
    writeOptimistic(cacheKey.packs(), ['made up'], T0);
    writeSnapshot(cacheKey.packs(), ['real'], T0 + 100);
    expect(isFresh(cacheKey.packs(), T0 + 100)).toBe(true);
    expect(readSnapshot(cacheKey.packs(), T0 + 100)).toEqual(['real']);
  });
});

/**
 * `invalidate` is what makes the freshness gates safe.
 *
 * The screens skip their refetch inside the window, which is only correct while
 * nothing has changed in it. Every mutation another screen displays has to say
 * so — and it has to say so WITHOUT blanking the screen on the way back, which
 * is the distinction these tests pin.
 */
describe('invalidate', () => {
  it('keeps the value paintable', () => {
    writeSnapshot('packs', ['a trail'], T0);
    invalidate('packs');
    // Going back to a screen that empties and refills is the blank frame this
    // whole cache exists to avoid. The old answer stays until a new one lands.
    expect(readSnapshot('packs', T0 + 1_000)).toEqual(['a trail']);
  });

  it('makes it stale, so the refetch actually runs', () => {
    writeSnapshot('packs', ['a trail'], T0);
    expect(isFresh('packs', T0 + 1_000)).toBe(true);
    invalidate('packs');
    // Invite somebody, press back within the window: without this the person
    // just invited is missing from the roster they were added to.
    expect(isFresh('packs', T0 + 1_000)).toBe(false);
  });

  it('does not resurrect a key it was never given', () => {
    invalidate('packs');
    expect(readSnapshot('packs', T0)).toBeNull();
  });

  it('still ages out normally afterwards', () => {
    writeSnapshot('packs', ['a trail'], T0);
    invalidate('packs');
    // Invalidating must not make an entry immortal by moving `at`.
    expect(readSnapshot('packs', T0 + MAX_SNAPSHOT_AGE_MS + 1)).toBeNull();
  });

  it('leaves a re-fetched key fresh again', () => {
    writeSnapshot('packs', ['old'], T0);
    invalidate('packs');
    writeSnapshot('packs', ['new'], T0 + 2_000);
    expect(isFresh('packs', T0 + 3_000)).toBe(true);
    expect(readSnapshot('packs', T0 + 3_000)).toEqual(['new']);
  });
});

/**
 * A stalled request must never hold the Together list for the rest of a session.
 *
 * `share()` releases its in-flight key only when the stored promise settles.
 * Nothing in the stack times a Supabase read out on its own — `lib/supabase.ts`
 * sets no fetch timeout — so a request on a connection that died mid-flight can
 * stay pending indefinitely. Every later Together focus was then handed that
 * same dead promise: the list kept painting from its snapshot and simply never
 * updated again until the app was killed.
 *
 * The fix is placement, and these tests pin the placement. The timeout has to
 * wrap the runner INSIDE `share()`, so the promise `share()` stores is the one
 * that settles.
 */
describe('share() with a stalled request', () => {
  const never = () => new Promise<never>(() => {});

  afterEach(() => { jest.useRealTimers(); });

  it('holds the key for good when nothing bounds the runner', () => {
    jest.useFakeTimers();
    share('packs', never);
    // Well past any sensible timeout, and still held: this is the wedge.
    jest.advanceTimersByTime(TOGETHER_READ_TIMEOUT_MS * 10);
    expect(isInFlight('packs')).toBe(true);
  });

  it('releases the key once a timeout inside the runner fires', async () => {
    jest.useFakeTimers();
    const pending = share('packs', () => withTimeout(never(), TOGETHER_READ_TIMEOUT_MS, 'listPacks'));
    expect(isInFlight('packs')).toBe(true);

    jest.advanceTimersByTime(TOGETHER_READ_TIMEOUT_MS);

    await expect(pending).rejects.toThrow(/Timed out after 12000ms: listPacks/);
    expect(isInFlight('packs')).toBe(false);
  });

  it('lets the next focus start a real request once released', async () => {
    jest.useFakeTimers();
    const stalled = share('packs', () => withTimeout(never(), TOGETHER_READ_TIMEOUT_MS));
    jest.advanceTimersByTime(TOGETHER_READ_TIMEOUT_MS);
    await expect(stalled).rejects.toThrow();

    // The whole point: recovery without restarting the app. A new runner is
    // actually invoked, rather than the caller being handed the dead promise.
    const fresh = jest.fn(async () => ['a trail']);
    await expect(share('packs', fresh)).resolves.toEqual(['a trail']);
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it('does not cut short a request that answers in time', async () => {
    jest.useFakeTimers();
    let answer!: (value: string[]) => void;
    const slow = new Promise<string[]>(resolve => { answer = resolve; });
    const pending = share('packs', () => withTimeout(slow, TOGETHER_READ_TIMEOUT_MS));

    jest.advanceTimersByTime(TOGETHER_READ_TIMEOUT_MS - 1);
    answer(['a trail']);

    await expect(pending).resolves.toEqual(['a trail']);
    expect(isInFlight('packs')).toBe(false);
  });
});

describe('write ownership (late answers cannot overwrite newer ones)', () => {
  it('refuses an older request that lands after a newer one — the timeout race', () => {
    const slow = beginWrite('packs');
    const fast = beginWrite('packs');
    expect(commitSnapshot(fast, ['new'], T0)).toBe(true);
    expect(commitSnapshot(slow, ['old'], T0)).toBe(false);
    expect(readSnapshot('packs', T0)).toEqual(['new']);
  });

  it('refuses anything asked before a sign-out cleared the cache', () => {
    const previousAccount = beginWrite('packs');
    clearCommunityCache();
    expect(commitSnapshot(previousAccount, ['their meetups'], T0)).toBe(false);
    expect(readSnapshot('packs', T0)).toBeNull();
  });

  it('lets a direct write win over a request still in flight', () => {
    const inFlight = beginWrite('pack:a');
    writeSnapshot('pack:a', 'written directly', T0);
    expect(commitSnapshot(inFlight, 'late', T0)).toBe(false);
    expect(readSnapshot('pack:a', T0)).toBe('written directly');
  });

  it('keeps keys independent', () => {
    const packs = beginWrite('packs');
    writeSnapshot('pack:a', 1, T0);
    expect(commitSnapshot(packs, ['still fine'], T0)).toBe(true);
  });

  it('commits in order when answers arrive in order, and marks them fresh', () => {
    const first = beginWrite('packs');
    const second = beginWrite('packs');
    expect(commitSnapshot(first, ['a'], T0)).toBe(true);
    expect(commitSnapshot(second, ['b'], T0)).toBe(true);
    expect(readSnapshot('packs', T0)).toEqual(['b']);
    expect(isFresh('packs', T0)).toBe(true);
  });
});

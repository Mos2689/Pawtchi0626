/**
 * The press-in read is claimed once, and only while it is young.
 *
 * Once matters more than it looks: the walk screen reloads straight after
 * every write, and a reload handed this read — which started before the
 * write — would put the old roster back on screen.
 */

import type { OutingSnapshot } from '../communityWalks';
import {
  PREFETCH_CLAIM_WINDOW_MS,
  claimPrefetchedOuting,
  clearOutingPrefetches,
  prefetchOuting,
} from './outingPrefetch';

const T0 = 1_760_000_000_000;
const snapshot = { walk: { id: 'w1' } } as unknown as OutingSnapshot;

beforeEach(() => clearOutingPrefetches());

describe('prefetchOuting / claimPrefetchedOuting', () => {
  it('hands the press-in read to the first load, and only to it', async () => {
    const load = jest.fn(async () => snapshot);
    prefetchOuting('w1', load, T0);
    const claimed = claimPrefetchedOuting('w1', T0 + 300);
    expect(claimed).not.toBeNull();
    await expect(claimed).resolves.toBe(snapshot);
    expect(claimPrefetchedOuting('w1', T0 + 400)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never claims for a walk nobody pressed', () => {
    prefetchOuting('w1', jest.fn(async () => snapshot), T0);
    expect(claimPrefetchedOuting('w2', T0)).toBeNull();
  });

  it('refuses a read that has gone stale — an abandoned press, visited later', () => {
    prefetchOuting('w1', jest.fn(async () => snapshot), T0);
    expect(claimPrefetchedOuting('w1', T0 + PREFETCH_CLAIM_WINDOW_MS + 1)).toBeNull();
  });

  it('a second press inside the window does not ask twice', () => {
    const load = jest.fn(async () => snapshot);
    prefetchOuting('w1', load, T0);
    prefetchOuting('w1', load, T0 + 1_000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a press after the window asks again', () => {
    const load = jest.fn(async () => snapshot);
    prefetchOuting('w1', load, T0);
    prefetchOuting('w1', load, T0 + PREFETCH_CLAIM_WINDOW_MS + 1);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a failed read reaches the claimer, and nobody else', async () => {
    prefetchOuting('w1', () => Promise.reject(new Error('offline')), T0);
    await Promise.resolve();
    await expect(claimPrefetchedOuting('w1', T0 + 100)).rejects.toThrow('offline');
  });

  it('a loader that throws leaves nothing to claim', () => {
    prefetchOuting('w1', () => { throw new Error('boom'); }, T0);
    expect(claimPrefetchedOuting('w1', T0)).toBeNull();
  });

  it('forgets everything on sign-out', () => {
    prefetchOuting('w1', jest.fn(async () => snapshot), T0);
    clearOutingPrefetches();
    expect(claimPrefetchedOuting('w1', T0)).toBeNull();
  });
});

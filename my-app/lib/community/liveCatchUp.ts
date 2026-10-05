/**
 * Live Walk v2 — when a receiver asks for a missing stretch of route.
 *
 * A walker is "behind" when they have announced more route than this phone
 * holds (liveReconciler.walkersBehind). The first `req` goes at once; while
 * still behind, it is repeated after 10 s, doubling to at most 60 s, and given
 * up after 5 attempts: the once-a-minute database read repairs the route from
 * the checkpoint anyway, so nothing is left permanently broken by a sender
 * that never answers. Catching up clears the walker's record.
 *
 * Several walkers behind at once ask with one `req` for everyone (`all`).
 * Times are monotonic milliseconds.
 */

export const CATCH_UP_FIRST_RETRY_MS = 10_000;
export const CATCH_UP_MAX_RETRY_MS = 60_000;
export const CATCH_UP_MAX_ATTEMPTS = 5;

export type CatchUpTracker = Readonly<Record<string, { attempts: number; nextAt: number }>>;

export function catchUpDue(
  tracker: CatchUpTracker,
  behind: readonly string[],
  now: number,
): { tracker: CatchUpTracker; want: 'all' | string | null } {
  const next: Record<string, { attempts: number; nextAt: number }> = {};
  const asking: string[] = [];
  for (const user of behind) {
    const entry = tracker[user];
    if (!entry) {
      asking.push(user);
      next[user] = { attempts: 1, nextAt: now + CATCH_UP_FIRST_RETRY_MS };
    } else if (entry.attempts < CATCH_UP_MAX_ATTEMPTS && now >= entry.nextAt) {
      asking.push(user);
      const wait = Math.min(CATCH_UP_MAX_RETRY_MS, CATCH_UP_FIRST_RETRY_MS * 2 ** entry.attempts);
      next[user] = { attempts: entry.attempts + 1, nextAt: now + wait };
    } else {
      next[user] = entry;
    }
  }
  const want = asking.length === 0 ? null : asking.length === 1 ? asking[0] : 'all';
  return { tracker: next, want };
}

/**
 * The Trails cold-start cache.
 *
 * Same trade as lib/activity/todayCache.ts: a screen whose content cannot be
 * drawn until several round trips land is a screen that opens empty. The last
 * answer is painted first and corrected behind.
 *
 * ── Why a Trail can be shown stale, briefly ─────────────────────────────────
 *
 * Because the alternative is worse, and because the staleness is bounded by a
 * refresh that is already in flight when the cached frame appears. Going back
 * from Invite to the trail you just left, to be shown a blank page while the
 * app re-derives what it displayed four seconds ago, reads as a bug in a way
 * that a four-second-old member count never does.
 *
 * ── Three deliberate limits ─────────────────────────────────────────────────
 *
 *   In memory only. Unlike the Activity cache this is not persisted: a Trail's
 *   whole point is the next date, and a plan restored from disk after a week in
 *   the background would be presented as current. A process restart should show
 *   a real answer or nothing.
 *
 *   Aged out. Past MAX_AGE_MS an entry is refused rather than painted. This is
 *   not about correctness — the refresh corrects it either way — but about how
 *   long a wrong frame may sit there if the network is slow to say otherwise.
 *
 *   Replaced wholesale, never merged. A half-cached screen would be a third
 *   state to reason about. The network is the authority the moment it answers.
 *
 * Cleared on sign-out through `clearAllUserState()`, with the rest of the
 * previous account's memory. A pack list belonging to someone else is exactly
 * the kind of leak that function exists to close.
 */

const MAX_AGE_MS = 5 * 60_000;

interface Entry {
  at: number;
  value: unknown;
}

const entries = new Map<string, Entry>();

/** Cache keys. Functions rather than strings so a typo cannot silently miss. */
export const cacheKey = {
  packs: () => 'packs',
  pack: (packId: string) => `pack:${packId}`,
  outing: (walkId: string) => `outing:${walkId}`,
};

/**
 * The last known answer for a key, or null if there isn't a usable one.
 *
 * Exported separately from the age check so screens can call this during render
 * — it must stay synchronous and allocation-free, because it runs in a
 * `useState` initialiser on the first frame of every community screen.
 */
export function readSnapshot<T>(key: string, now: number = Date.now()): T | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (now - entry.at > MAX_AGE_MS) {
    entries.delete(key);
    return null;
  }
  return entry.value as T;
}

export function writeSnapshot<T>(key: string, value: T, now: number = Date.now()): void {
  entries.set(key, { at: now, value });
}

export function clearCommunityCache(): void {
  entries.clear();
}

/** Only for tests that need to assert ageing without waiting five minutes. */
export const MAX_SNAPSHOT_AGE_MS = MAX_AGE_MS;

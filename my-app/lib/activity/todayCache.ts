/**
 * The Activity tab's cold-start cache.
 *
 * Same trade as hooks/useHomeMapCenter.ts and hooks/useRecentWalks.ts: the
 * screen's four queries all have to land before the timeline can draw anything,
 * so opening the tab meant watching an empty page for a round trip. The last
 * answer is painted first and corrected behind.
 *
 * Two deliberate limits:
 *
 *   Today only. Activities are keyed by calendar day and the plan for a day is
 *   not evidence about any other, so a snapshot is refused outright once the
 *   date has rolled over — showing yesterday's walks as today's plan would be
 *   worse than showing nothing. It also bounds storage to one entry per pet
 *   rather than one per pet per day the owner happens to browse.
 *
 *   No merging. The cache is replaced wholesale, never reconciled row by row.
 *   The network is the authority the moment it answers; this is only ever a
 *   head start, and a half-cached list would be a third state to reason about.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY_PREFIX = 'activity:today:';

/**
 * Rows kept per list.
 *
 * A generated day is well under this; the cap exists so a pathological account
 * (a duplicated plan, a heavy logging day) cannot grow an entry big enough that
 * reading it costs more than the query it was meant to pre-empt.
 */
const MAX_ROWS = 40;

export interface ActivityDaySnapshot {
  /** The local calendar day these rows belong to. */
  ymd: string;
  activities: any[];
  foodScans: any[];
  dailyLog: any | null;
}

function cacheKey(petId: string): string {
  return KEY_PREFIX + petId;
}

/**
 * Whether a parsed entry may be shown as `todayYmd`.
 *
 * Exported for its own test: this is the guard that stops a stale plan from
 * being presented as the current day's, and it is the one rule here whose
 * failure would be silent and wrong rather than merely slow.
 */
export function isUsableSnapshot(value: unknown, todayYmd: string): value is ActivityDaySnapshot {
  if (!value || typeof value !== 'object') return false;
  const snap = value as Partial<ActivityDaySnapshot>;
  if (typeof snap.ymd !== 'string' || snap.ymd !== todayYmd) return false;
  return Array.isArray(snap.activities) && Array.isArray(snap.foodScans);
}

/** Read the cached day. Never throws; a malformed or stale entry is a miss. */
export async function readActivityDay(
  petId: string,
  todayYmd: string,
): Promise<ActivityDaySnapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(petId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUsableSnapshot(parsed, todayYmd) ? parsed : null;
  } catch {
    return null;
  }
}

export async function writeActivityDay(
  petId: string,
  snapshot: ActivityDaySnapshot,
): Promise<void> {
  try {
    await AsyncStorage.setItem(
      cacheKey(petId),
      JSON.stringify({
        ymd: snapshot.ymd,
        activities: snapshot.activities.slice(0, MAX_ROWS),
        foodScans: snapshot.foodScans.slice(0, MAX_ROWS),
        dailyLog: snapshot.dailyLog ?? null,
      }),
    );
  } catch {
    // A failed write only costs one slow open.
  }
}

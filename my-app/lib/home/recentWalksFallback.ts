/**
 * What Home's walk rail may claim, and when it reaches past the week.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Home's rail and the canopy's route lines were built from the last 7 days
 * only. A dog with a quiet week — Jasper had 26 walks and none since 6 Oct —
 * got "No walks yet · Jasper's map fills in as you walk", no lines on the map,
 * and (because the gallery button needs two cards) no way to reach the
 * archive. Owners read that, reasonably, as their walks being wiped.
 *
 * The rules here:
 *   1. An empty week falls back to the dog's latest walks, of any date.
 *   2. "No walks yet" is said only after a successful answer that found none
 *      at all. A failed or timed-out load says so and offers a retry; it is
 *      never evidence that the walks do not exist.
 *   3. Walks shown from outside the week carry their day, so a fortnight-old
 *      walk is not read as this week's beside the Today card.
 *
 * Pure, so every rule is covered by recentWalksFallback.test.ts.
 */

import { getLocalYMD } from '../dateUtils';
import { dateFormat } from '../dateFormats';

/** Which walks the feed holds: this week's, or the latest from any date. */
export type RecentWalksScope = 'week' | 'latest';

/** How the last load ended. `idle` = nothing has answered yet. */
export type RecentWalksStatus = 'idle' | 'ready' | 'error';

/** How many walks the fallback shows. Enough to browse; the gallery has the rest. */
export const LATEST_WALKS_LIMIT = 10;

/** The week came back empty: ask for the latest walks instead. */
export function needsLatestFallback(weekCount: number): boolean {
  return weekCount === 0;
}

export type RailWalkState = 'walks' | 'loading' | 'error' | 'empty';

/**
 * What the walk rail renders.
 *
 * Walks on screen always win: a failed refresh never takes away what a
 * previous answer (or the disk cache) already showed. Without walks, only a
 * successful answer may say there are none.
 */
export function railWalkState(input: {
  walkCount: number;
  loading: boolean;
  status: RecentWalksStatus;
}): RailWalkState {
  if (input.walkCount > 0) return 'walks';
  if (input.loading) return 'loading';
  if (input.status === 'ready') return 'empty';
  if (input.status === 'error') return 'error';
  return 'loading';
}

/**
 * The gallery is the archive: reachable whenever the dog has a walk at all.
 * It used to need two walks THIS WEEK, which hid it exactly when the rail was
 * empty and it was the only way left to the past.
 */
export function galleryReachable(walkCount: number): boolean {
  return walkCount > 0;
}

/**
 * A walk card's day, for walks shown from outside this week: "Yesterday",
 * "Mon" within the last 6 days, then "6 Oct" (with the year once it is
 * not this one). Null for today, which the Today card already names.
 */
export function walkDayLabel(startedAt: string, now: Date = new Date()): string | null {
  const when = new Date(startedAt);
  if (!Number.isFinite(when.getTime())) return null;
  const today = getLocalYMD(now);
  const day = getLocalYMD(when);
  if (day === today) return null;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day === getLocalYMD(yesterday)) return 'Yesterday';

  const weekAgo = new Date(now);
  weekAgo.setHours(0, 0, 0, 0);
  weekAgo.setDate(weekAgo.getDate() - 6);
  if (when >= weekAgo) return dateFormat({ weekday: 'short' }).format(when);

  const sameYear = when.getFullYear() === now.getFullYear();
  return dateFormat(
    sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' },
  ).format(when);
}

/** The rail card for a load that failed with nothing to show. */
export const walkFeedErrorCopy = {
  title: "Couldn't load walks",
  body: 'Your walks are safe. Check your connection and try again.',
  action: 'Try again',
} as const;

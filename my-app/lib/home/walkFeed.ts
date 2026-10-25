/**
 * Home's walk feed — which walks the rail holds, and what it may claim.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * The rail shows the dog's walks newest first, ten at a time, with a "Show
 * more" card that loads the ten before them, all the way back. There is no
 * date window and no special case for older walks: every card is built and
 * drawn exactly the same way, whether the walk was this morning or in March.
 *
 * Why this replaced the two earlier rules:
 *   - "The last 7 days" (to 1.0.26) told a dog with a quiet week "No walks yet"
 *     and hid the gallery button, which owners read as their walks being wiped.
 *   - "The week, or the latest 10 if the week is empty" (1.0.27) hid all
 *     history again as soon as one walk landed this week, and dated older cards
 *     differently from new ones.
 *
 * "No walks yet" is said only after a successful answer found none; a failed
 * load says so and offers a retry, and never takes away walks already shown.
 *
 * Pure, so every rule is covered by walkFeed.test.ts.
 */

/** Walks per page: the first load, and each "Show more". */
export const WALK_PAGE_SIZE = 10;

/** How the first page's last load ended. `idle` = nothing has answered yet. */
export type WalkFeedStatus = 'idle' | 'ready' | 'error';

/** The minimum a walk needs for paging: its id and when it started. */
export interface PagedWalk {
  id: string;
  started_at: string;
}

/** A full page means there may be more before it; a short one means the end. */
export function hasMorePages(pageLength: number, pageSize: number = WALK_PAGE_SIZE): boolean {
  return pageLength >= pageSize;
}

/**
 * Where the next page starts: strictly before the oldest walk held. Null when
 * nothing is held. Keyset rather than offset, so a walk finishing while the
 * owner pages back can never shift a page and repeat or skip a card.
 */
export function nextPageCursor(walks: readonly PagedWalk[]): string | null {
  let oldest: string | null = null;
  let oldestMs = Infinity;
  for (const w of walks) {
    const ms = Date.parse(w.started_at);
    if (Number.isFinite(ms) && ms < oldestMs) {
      oldestMs = ms;
      oldest = w.started_at;
    }
  }
  return oldest;
}

/**
 * Add a page to the walks already held: one card per walk (the copy already on
 * screen wins), newest first.
 */
export function mergeWalkPages<T extends PagedWalk>(existing: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(existing.map(w => w.id));
  const merged = [...existing];
  for (const w of page) {
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    merged.push(w);
  }
  return merged.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
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
  status: WalkFeedStatus;
}): RailWalkState {
  if (input.walkCount > 0) return 'walks';
  if (input.loading) return 'loading';
  if (input.status === 'ready') return 'empty';
  if (input.status === 'error') return 'error';
  return 'loading';
}

/**
 * The gallery is the archive: reachable whenever the dog has a walk at all.
 */
export function galleryReachable(walkCount: number): boolean {
  return walkCount > 0;
}

/** The rail card for a first load that failed with nothing to show. */
export const walkFeedErrorCopy = {
  title: "Couldn't load walks",
  body: 'Your walks are safe. Check your connection and try again.',
  action: 'Try again',
} as const;

/** The card at the end of the rail that loads the walks before these. */
export const walkFeedMoreCopy = {
  title: 'Earlier walks',
  body: 'See the walks before these.',
  action: 'Show more',
  loading: 'Loading earlier walks',
  errorTitle: "Couldn't load more",
  errorAction: 'Try again',
} as const;

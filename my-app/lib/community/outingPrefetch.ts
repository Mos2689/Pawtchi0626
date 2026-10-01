/**
 * The walk screen's read, started on press-in at the meetup screen.
 *
 * Opening a walk used to wait for the push transition to finish, for the new
 * screen to focus, and only then ask the server — so the request and the
 * animation ran one after the other. Starting the read as the finger lands
 * lets them overlap (perf Train 2, behind perf-walk-instant-open).
 *
 * ── Why this is not `share()` ───────────────────────────────────────────────
 *
 * The walk screen's `load` also runs straight after a write (answering,
 * inviting). Joining an in-flight request there would hand it an answer that
 * started BEFORE the write, and the change would vanish until the next focus —
 * the same reason the meetup screen's load does not share. So a prefetch is
 * claimed exactly once, by the walk screen's first load, and only while it is
 * young; every later load asks the server itself.
 */

import type { OutingSnapshot } from '../communityWalks';

/**
 * How long a prefetched read may stand in for the screen's own.
 *
 * Long enough to cover a press, a slow transition and the first focus; short
 * enough that an abandoned press (a scroll that began on the button) can never
 * be claimed by a visit much later.
 */
export const PREFETCH_CLAIM_WINDOW_MS = 5_000;

const held = new Map<string, { at: number; promise: Promise<OutingSnapshot> }>();

/** Start the read for a walk about to open. A second press inside the window is a no-op. */
export function prefetchOuting(
  walkId: string,
  load: (walkId: string) => Promise<OutingSnapshot>,
  now: number = Date.now(),
): void {
  for (const [id, entry] of held) {
    if (now - entry.at > PREFETCH_CLAIM_WINDOW_MS) held.delete(id);
  }
  if (held.has(walkId)) return;
  let promise: Promise<OutingSnapshot>;
  try {
    promise = load(walkId);
  } catch {
    return;
  }
  // Nobody may ever claim it, and an unclaimed rejection must stay quiet. The
  // claimer still sees the rejection on the promise it is handed.
  promise.catch(() => {});
  held.set(walkId, { at: now, promise });
}

/**
 * The prefetched read for this walk, if one is young enough — handed out once.
 * Null means "ask the server yourself".
 */
export function claimPrefetchedOuting(
  walkId: string,
  now: number = Date.now(),
): Promise<OutingSnapshot> | null {
  const entry = held.get(walkId);
  if (!entry) return null;
  held.delete(walkId);
  return now - entry.at <= PREFETCH_CLAIM_WINDOW_MS ? entry.promise : null;
}

/** Dropped on sign-out with the rest of the previous account's state. */
export function clearOutingPrefetches(): void {
  held.clear();
}

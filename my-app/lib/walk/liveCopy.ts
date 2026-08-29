/**
 * liveCopy — the status line for an in-progress walk, in one place.
 *
 * These three strings are rendered in two places that must never drift: the
 * live walk screen (`app/walk.tsx`) and the iOS Live Activity on the Lock
 * Screen. The Live Activity resolves its line HERE, in TypeScript, and ships
 * the finished string to Swift — so no user-facing copy is ever duplicated
 * into the widget target, and a wording change stays a one-file change.
 */

export const WALK_STATUS_COPY = {
  /** No accepted fix yet — the walk exists but has no shape. */
  acquiring: 'Finding GPS — hold on a moment',
  /** The session machine has auto-paused: a real, minutes-long sniff stop. */
  sniffing: 'Paused with the sniffs — resumes on the next step',
  /** The ordinary case, and the reassurance that matters most: it self-ends. */
  walking: 'Tracking — ends on its own at home',
  /** The Live Activity's last frame, after the walk is over. Deliberately
   *  claims nothing about saving — the sync may still be queued offline. */
  finished: 'Walk finished',
} as const;

export type WalkStatusKey = keyof typeof WALK_STATUS_COPY;

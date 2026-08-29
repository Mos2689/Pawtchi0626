/**
 * liveCopy — every word the walk Live Activity can say, in one place.
 *
 * The Lock Screen card resolves its strings HERE, in TypeScript, and ships
 * finished text to Swift. The widget target authors no copy of its own, so a
 * wording change stays a one-file change and never needs a Swift edit — and the
 * live walk screen (`app/walk.tsx`) shares the status line, so the two surfaces
 * cannot describe the same walk differently.
 *
 * Two places where this deviates from the design handoff, both deliberate:
 *
 *   • The starting card's sub-line is "Finding GPS — hold on a moment", not the
 *     handoff's "Tracking starts when you move". Tracking has already started by
 *     then; what we are actually waiting for is a usable fix. The handoff line
 *     would tell the owner to start walking to make something happen, which is
 *     both untrue and the wrong instruction.
 *
 *   • The finished eyebrow only says SAVED when the walk really is saved. A walk
 *     finished offline sits in the sync queue, and the card must not promise a
 *     server write that has not happened. See `finishedEyebrow`.
 */

/** The live status line, shared with the walk screen's own status row. */
export const WALK_STATUS_COPY = {
  /** No accepted fix yet — the walk exists but has no shape. */
  acquiring: 'Finding GPS — hold on a moment',
  /** The session machine has auto-paused: a real, minutes-long sniff stop. */
  sniffing: 'Paused with the sniffs — resumes on the next step',
  /** The ordinary case, and the reassurance that matters most: it self-ends. */
  walking: 'Tracking — ends on its own at home',
  /** The Live Activity's last frame, when nothing stronger can be claimed. */
  finished: 'Walk finished',
} as const;

export type WalkStatusKey = keyof typeof WALK_STATUS_COPY;

/** The small uppercase label beside the live pulse. */
export const LIVE_EYEBROW = {
  starting: 'STARTING',
  walking: 'WALKING',
  /** Pawtchi's own addition to the handoff's three states: a dog nose-down is
   *  the thing this app notices that a step counter does not, and the card is
   *  the one surface where saying so costs nothing. */
  sniffing: 'SNIFFING',
} as const;

/** The geofence pill. Always true of a tracked walk — auto-stop is armed from
 *  the first fix — so it is a statement of fact, not a prediction. */
export const ENDS_AT_HOME = 'Ends at home';

/** Replaces the stats shelf when GPS has dropped out mid-walk. */
export const WAITING_FOR_SIGNAL = 'Waiting for signal';

/** The finished card's call to action. */
export const SEE_THE_MAP = 'See the map';

/** "Momo's walk" — the starting card's title. */
export function startingTitle(petName: string): string {
  return `${petName}'s walk`;
}

/**
 * "18 min together" — the finished card's title.
 *
 * Minutes, never seconds: this is a keepsake line, and "18 min" is how someone
 * would describe the walk out loud. Rounds up from zero so a genuinely short
 * walk still reads as time spent rather than "0 min".
 */
export function finishedTitle(durationMs: number): string {
  const minutes = Math.max(1, Math.round(durationMs / 60_000));
  return `${minutes} min together`;
}

/**
 * "HOME · WALK SAVED", but only when it is true.
 *
 * `saved` comes from the sync outcome. A walk finished with no signal is real
 * and complete, and it will sync later — but the card cannot say a row exists
 * on the server when it does not. The honest variant costs one word.
 */
export function finishedEyebrow(saved: boolean): string {
  return saved ? 'HOME · WALK SAVED' : 'HOME · WALK FINISHED';
}

/** "1.4 km · 6 sniffs".
 *
 *  The handoff's third clause, "1 new street", is deliberately absent: that
 *  count is a server-side column (`walk_sessions.new_street_count`, read by the
 *  notify-dispatch function) and does not exist on the device at the moment a
 *  walk ends — least of all for a walk finished offline. */
export function finishedSummary(distanceKm: number, sniffCount: number): string {
  return `${distanceKm.toFixed(1)} km · ${sniffCount} ${sniffCount === 1 ? 'sniff' : 'sniffs'}`;
}

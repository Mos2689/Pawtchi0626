/**
 * How a screen behaves when its data will not load — decided once, here.
 *
 * ── What used to happen (4 Oct 2026) ────────────────────────────────────────
 *
 * A failed refresh replaced the screen's state with a red technical message
 * and stopped. With nothing cached, the walk screen showed an empty card and
 * "This walk could not open" until the person left and came back; with a
 * roster on screen, one failed refresh could still leave "Join the walk"
 * greyed out for good.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 *
 *   1. What is on screen stays on screen. A failed refresh never takes data
 *      away, and never disables an action that data already supports.
 *   2. The screen tries again on its own — after 3, 8 and 20 seconds, then
 *      whenever the app returns to the foreground or the screen regains focus.
 *      Nobody should have to leave and come back.
 *   3. Only with nothing to show does a failure take the screen, and then as a
 *      calm card with "Try again", never as an empty shell.
 */

export const AUTO_RETRY_DELAYS_MS: readonly number[] = [3_000, 8_000, 20_000];

/**
 * The wait before the next automatic try, after this many failures in a row.
 * Null once the schedule is spent: from then on the screen waits for focus or
 * the app returning to the foreground, rather than polling a server that is
 * clearly struggling.
 */
export function nextAutoRetryDelay(consecutiveFailures: number): number | null {
  if (consecutiveFailures < 1) return null;
  return AUTO_RETRY_DELAYS_MS[consecutiveFailures - 1] ?? null;
}

export type LoadPhase =
  /** Nothing to show yet, and an answer is coming. */
  | 'loading'
  /** Showing current data. */
  | 'ready'
  /** Showing data from before; the latest refresh failed and will be retried. */
  | 'stale'
  /** Nothing to show, and the last try failed. */
  | 'unavailable';

export function loadPhase(state: { hasData: boolean; failed: boolean; inFlight: boolean }): LoadPhase {
  if (state.hasData) return state.failed ? 'stale' : 'ready';
  if (state.inFlight || !state.failed) return 'loading';
  return 'unavailable';
}

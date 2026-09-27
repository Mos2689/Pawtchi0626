/**
 * What each Together call actually costs, on a real device and a real network.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every number behind the read-path rewrite was measured server-side, with
 * EXPLAIN against production. That half is precise and it is also only half:
 * it says nothing about the round trips between a phone in Goa and a database
 * in Tokyo, which is where most of the waiting actually happened. A query that
 * runs in 5 ms three times in a row still costs three times the latency.
 *
 * So this logs the thing the server cannot see — wall-clock per call, and how
 * many network round trips went into it — and it logs it where the person
 * looking at the screen is.
 *
 * ── Deliberately __DEV__ only ──────────────────────────────────────────────
 *
 * No analytics, no telemetry, no breadcrumb. Timings are not interesting
 * enough to justify a new stream of data about what somebody is doing and
 * when, and `support-diagnostics-privacy-boundary` is explicit that analytics
 * props on this path carry things that must not be attached casually. In a
 * production build the wrapper compiles down to calling the function.
 */

/** A count of network round trips, for calls that make more than one. */
export interface PerfHops {
  hops: number;
}

const enabled = typeof __DEV__ !== 'undefined' && __DEV__;

/**
 * Time one data-layer call.
 *
 * Returns the function's own result untouched, and never changes its failure:
 * a rejection is re-thrown after being logged, so instrumentation can never be
 * the reason something behaves differently with the timer on.
 */
export async function timed<T>(
  label: string,
  hops: number,
  run: () => Promise<T>,
): Promise<T> {
  if (!enabled) return run();
  const started = Date.now();
  try {
    const result = await run();
    log(label, hops, Date.now() - started, 'ok');
    return result;
  } catch (cause) {
    // Logged before re-throwing: a call that failed after 4 s is exactly the
    // one worth seeing, and it is the one a success-only timer hides.
    log(label, hops, Date.now() - started, 'failed');
    throw cause;
  }
}

/** Noted when a call returns without touching the network at all. */
export function skipped(label: string, reason: 'fresh' | 'in-flight'): void {
  if (!enabled) return;
  // eslint-disable-next-line no-console
  console.log(`[together] ${label.padEnd(22)} — skipped (${reason})`);
}

function log(label: string, hops: number, ms: number, outcome: string): void {
  // eslint-disable-next-line no-console
  console.log(
    `[together] ${label.padEnd(22)} ${String(ms).padStart(5)}ms  ${hops} hop${hops === 1 ? '' : 's'}  ${outcome}`,
  );
}

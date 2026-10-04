/**
 * One automatic retry with backoff for idempotent operations.
 *
 * Use sparingly: the edge functions already retry their upstream calls, so
 * client-side retry is for reads and idempotent writes where a transient
 * network blip is the dominant failure (e.g. fetching the active pet on
 * boot). Never wrap non-idempotent writes — a double insert is worse than
 * a visible retry button.
 */

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: {
    delayMs?: number;
    /**
     * Retry only failures this accepts. A refusal ("this walk has finished")
     * is an answer, and asking again only delays it; pass `isTransientError`
     * from lib/appError.ts to retry dropped connections and busy servers only.
     */
    retryIf?: (error: unknown) => boolean;
  },
): Promise<T> {
  try {
    return await fn();
  } catch (firstErr) {
    if (opts?.retryIf && !opts.retryIf(firstErr)) throw firstErr;
    await new Promise((r) => setTimeout(r, opts?.delayMs ?? 1200));
    try {
      return await fn();
    } catch {
      // The first error is the honest one — the second is usually the same
      // failure again, or noise from a widening outage.
      throw firstErr;
    }
  }
}

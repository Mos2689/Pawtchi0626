/**
 * Race a promise against a timer. If the timer fires first, the returned
 * promise rejects with a timeout Error so `catch` / `finally` blocks execute
 * normally and the caller can clean up loading states.
 *
 * The underlying promise is NOT cancelled — it continues in the background.
 * For Supabase edge-function calls, this is fine: the server finishes on its
 * own and the client simply discards the late result.
 *
 * @example
 * const { data, error } = await withTimeout(
 *   supabase.functions.invoke('gemini-proxy', { body }),
 *   45_000,
 *   'gemini-proxy',
 * );
 */
export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label?: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out after ${ms}ms${label ? `: ${label}` : ''}`)),
      ms,
    );
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/**
 * Local-day-of-the-month helpers.
 *
 * The `daily_logs` table (and anything keyed by "the user's calendar day")
 * uses *local* dates, not UTC. Writing UTC dates here is a silent bug — the
 * row exists, but the home tab's query for the local day misses it, and the
 * meal appears to vanish from the dashboard.
 *
 * This was the root cause of the "logged meal doesn't show on home" bug:
 * `meal.tsx` was writing `daily_logs.log_date` using
 * `new Date().toISOString().split('T')[0]` (UTC) while
 * `usePetContextStore.refreshToday` was querying with a local YMD. For users
 * east of UTC logging between local midnight and ~UTC midnight (≈ 5.5 hours
 * in IST), the dates disagreed and the meal silently disappeared from the
 * dashboard even though the insert succeeded.
 *
 * Always use `getLocalYMD` when constructing a `log_date`-style key.
 * Never use `toISOString().split('T')[0]` for that purpose.
 */

export function getLocalYMD(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Convenience: today's local YMD. */
export function getTodayLocalYMD(): string {
  return getLocalYMD(new Date());
}

/**
 * UTC ISO string for the start of the user's local calendar day.
 *
 * Use this whenever you need to filter a `timestamptz` column by "today" (or
 * "the start of this calendar day in the owner's timezone"). Postgres
 * interprets a bare `'YYYY-MM-DDTHH:MM:SS'` string without a TZ suffix as
 * UTC, so the naive pattern `gte('created_at', \`${getLocalYMD(now)}T00:00:00\`)`
 * silently misses every row whose `created_at` falls in the user's first
 * few local hours of the day east of UTC (e.g. an IST user logging at 02:30
 * local has `created_at` ≈ `<yesterday>T21:00:00Z`, which is BEFORE
 * `<today>T00:00:00Z` even though it's clearly "today" to the user).
 *
 * `setHours(0,0,0,0)` operates on the local clock, and `toISOString()` always
 * emits UTC. The result is the exact UTC instant of local midnight, which
 * Postgres can compare against `timestamptz` correctly.
 */
export function localDayStartUtcISO(d: Date = new Date()): string {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/**
 * Date and time formatters, built once instead of once per render.
 *
 * ── Why this file exists ───────────────────────────────────────────────────
 *
 * `new Intl.DateTimeFormat(...)` is not a cheap constructor. Each one resolves
 * a locale against ICU data and builds a formatter, and on Hermes that shows
 * up in a render path the way an allocation never does. The Together surfaces
 * were constructing sixteen of them inside render — one per trail row, per
 * card, per walk header, on every single re-render of a screen that re-renders
 * while a map is being panned.
 *
 * The formatters themselves are immutable and reusable. Building them once and
 * keeping them is the whole fix; there is no behaviour change, because the
 * arguments were identical every time.
 *
 * ── Locale ─────────────────────────────────────────────────────────────────
 *
 * Every call site passed `undefined` for the locale, meaning "the device's".
 * That is preserved. It also means the cache is correct for the life of the
 * process: a locale change restarts the app on both platforms, so a formatter
 * cannot outlive the locale it was built for.
 */

const cache = new Map<string, Intl.DateTimeFormat>();

/**
 * A formatter for these options, reused across every call with the same shape.
 *
 * Keyed on the options rather than on a name so call sites stay readable at
 * the point of use — `dateFormat({ weekday: 'short' })` says what it produces,
 * where `SHORT_WEEKDAY` would send you here to find out.
 */
export function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  // Object key order is insertion order in practice, and every call site is a
  // literal, so this is stable. A collision would only ever reuse an identical
  // formatter anyway.
  const key = JSON.stringify(options);
  const existing = cache.get(key);
  if (existing) return existing;
  const made = new Intl.DateTimeFormat(undefined, options);
  cache.set(key, made);
  return made;
}

/** `formatDate(iso, { weekday: 'short' })`, with the invalid case handled. */
export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions,
  fallback = '',
): string {
  if (value === null || value === undefined) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  // An unparseable date formats as "Invalid Date" rather than throwing, which
  // is the worst of both: it renders, and it renders nonsense.
  if (Number.isNaN(date.getTime())) return fallback;
  return dateFormat(options).format(date);
}

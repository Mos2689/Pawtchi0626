/**
 * homeTrace — a development-only stopwatch for Home's startup.
 *
 * Home is assembled from a dozen independent sources (a cached coordinate, a
 * walk feed, a basemap, weather, spots) and the only honest way to know which
 * one is holding up the first useful frame is to time them on a real device.
 * Intuition is not evidence, and neither is a fast simulator.
 *
 * ── Cost in production: zero ──
 * `HOME_TRACE_ENABLED` folds to `false` in a release build, so every `homeMark`
 * call site is a single constant check that Metro's dead-code elimination
 * removes along with the `__DEV__` branch. Nothing is imported that a release
 * bundle would otherwise not carry, and nothing is ever logged.
 *
 * ── How to use it ──
 * Flip the constant below to `true`, reload, and cold-start Home. One table is
 * printed once the run settles (or after GIVE_UP_MS, so a mark that never
 * arrives still reports rather than swallowing the whole trace). Compare three
 * cold starts before and after a change; a single run is noise.
 *
 * Kept in the tree rather than deleted after the audit: the marks ARE the
 * measurement, and re-deriving where to put them is most of the work.
 */

/**
 * The switch. Deliberately `&& false` rather than plain `__DEV__`: a trace that
 * printed on every developer's every reload would become background noise and
 * be ignored, which is the same as not having it.
 */
export const HOME_TRACE_ENABLED: boolean =
  typeof __DEV__ !== 'undefined' && __DEV__ && false;

/**
 * The moments worth timing, in the order they are expected to land.
 *
 * Each one is a fact about the screen rather than about a function: "the map is
 * showing tiles", not "the map component rendered". A mark that cannot be
 * described that way does not belong here.
 */
export const HOME_MARKS = [
  /** HomeScreen's first render. Everything below is measured from here. */
  'mount',
  /** A coordinate exists, so the camera has somewhere to point. */
  'map_camera',
  /** The basemap is mounted and drawing — the skeleton is gone. */
  'map_ready',
  /** useHomeMapCenter has finished its resolve pass, one way or another. */
  'location_resolved',
  /** The walk feed painted from disk. The head start, not the answer. */
  'walks_cached',
  /** The walk feed's query answered. */
  'walks_resolved',
  /** Current conditions arrived for the Today card. */
  'weather_resolved',
  /** The Nearby segment settled (only ever marked if it is opened). */
  'spots_resolved',
] as const;

export type HomeMark = (typeof HOME_MARKS)[number];

export interface HomeTraceEntry {
  mark: HomeMark;
  /** Milliseconds since `mount`. `mount` itself is always 0. */
  atMs: number;
}

/**
 * Report once the run has gone quiet, so a slow mark is included rather than
 * racing the table. Long enough to cover a cold Overpass call.
 */
const SETTLE_MS = 1500;

/** Never withhold a trace because one mark never arrived. */
const GIVE_UP_MS = 20_000;

export interface HomeTrace {
  /** Record a moment. The first mark of a run establishes t=0. */
  mark: (name: HomeMark) => void;
  /** Everything recorded so far, in arrival order. */
  entries: () => HomeTraceEntry[];
  /** Forget the run. The next mark starts a new one. */
  reset: () => void;
}

/**
 * The trace as a plain object over an injected clock.
 *
 * Separated from the singleton below so the ordering and de-duplication rules
 * can be tested without a timer, a device, or a global.
 */
export function createHomeTrace(now: () => number = Date.now): HomeTrace {
  let startedAt: number | null = null;
  const seen = new Map<HomeMark, HomeTraceEntry>();

  return {
    mark(name) {
      // First mark wins the origin, whichever it is. In practice that is
      // `mount`, but a trace started by a late reload should still be readable
      // rather than reporting negative offsets.
      if (startedAt === null) startedAt = now();
      // First occurrence only. Several of these fire on every re-render of the
      // component that owns them, and the interesting number is when the fact
      // first became true — not the last time something re-rendered.
      if (seen.has(name)) return;
      seen.set(name, { mark: name, atMs: Math.max(0, now() - startedAt) });
    },
    entries() {
      return Array.from(seen.values());
    },
    reset() {
      startedAt = null;
      seen.clear();
    },
  };
}

/**
 * The table. Ordered by HOME_MARKS rather than by arrival so two runs line up
 * column-for-column and can be read side by side.
 */
export function formatHomeTrace(entries: readonly HomeTraceEntry[]): string {
  if (entries.length === 0) return '[homeTrace] nothing recorded';

  const byMark = new Map(entries.map(e => [e.mark, e]));
  const width = Math.max(...HOME_MARKS.map(m => m.length));

  const rows = HOME_MARKS.map(mark => {
    const entry = byMark.get(mark);
    // A mark that never arrived is a finding, not a gap — say so rather than
    // omitting the row and letting it be missed.
    const value = entry ? `${entry.atMs} ms` : '—';
    return `  ${mark.padEnd(width)}  ${value}`;
  });

  return ['[homeTrace] Home startup', ...rows].join('\n');
}

// ── The singleton the screen actually calls ────────────────────────────────

const trace = createHomeTrace();
let settleTimer: ReturnType<typeof setTimeout> | null = null;
let giveUpTimer: ReturnType<typeof setTimeout> | null = null;
let reported = false;

function flush(): void {
  if (reported) return;
  reported = true;
  if (settleTimer) clearTimeout(settleTimer);
  if (giveUpTimer) clearTimeout(giveUpTimer);
  settleTimer = null;
  giveUpTimer = null;
  // eslint-disable-next-line no-console
  console.log(formatHomeTrace(trace.entries()));
}

/**
 * Record a Home startup moment. A no-op unless the switch above is on, so call
 * sites need no guard of their own.
 */
export function homeMark(name: HomeMark): void {
  if (!HOME_TRACE_ENABLED || reported) return;

  trace.mark(name);

  // Re-arm the quiet period on every mark: the run is over when the marks stop
  // arriving, which is not something any single mark can announce.
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(flush, SETTLE_MS);
  if (!giveUpTimer) giveUpTimer = setTimeout(flush, GIVE_UP_MS);
}

/**
 * Start a fresh run. Called when Home mounts, so a second visit in the same
 * session measures that visit rather than appending to the first.
 */
export function homeTraceReset(): void {
  if (!HOME_TRACE_ENABLED) return;
  if (settleTimer) clearTimeout(settleTimer);
  if (giveUpTimer) clearTimeout(giveUpTimer);
  settleTimer = null;
  giveUpTimer = null;
  reported = false;
  trace.reset();
}

// A short, in-memory trail of what the app just did, attached to support
// requests so a bug report is actionable without a back-and-forth.
//
// "The scan spun forever" is nearly impossible to act on. The same sentence
// with `food_scan_started → app_error(timeout) → food_scan_started →
// app_error(timeout)` underneath it is a fixed bug. That trail is the single
// highest-value thing we can attach, and it costs the owner nothing to provide.
//
// lib/analytics.ts already exports addAnalyticsSink() as a composable
// extension point, so this needs no new dependency, no patching of track(),
// and no changes at any call site.
//
// ── The privacy boundary, which is the whole design of this file ────────────
//
// We record event NAMES and a tiny allowlist of taxonomy fields. We never
// record analytics PROPS.
//
// This is not caution for its own sake. app/privacy.tsx §2 states plainly that
// analytics events "deliberately include pet attributes such as breed, species,
// weight, body condition score and individual allergens". Passing props through
// would quietly turn a support form into a channel carrying an animal's medical
// history into an inbox — with no disclosure, and no way for the owner to see
// it happening.
//
// The one exception is `app_error`, where `kind` and `context` are taxonomy
// enums and `technical` is documented at lib/appError.ts as containing "no user
// data by construction — it's error taxonomy only". Those are exactly the
// fields that make the trail diagnostic, and they are safe by construction
// rather than by our own inspection.
//
// Nothing here is persisted. The buffer lives in memory for the session and
// dies with it — there is no file, no AsyncStorage key, and nothing to leak
// from a device at rest.

import { addAnalyticsSink, type AnalyticsEvent, type AnalyticsProps } from '../analytics';

/**
 * How many steps back we keep. Twenty-five covers the meaningful run-up to a
 * failure — a screen opened, a scan started, a couple of retries — without
 * bloating the JSONB blob or turning the trail into something to read rather
 * than scan.
 */
export const BREADCRUMB_LIMIT = 25;

export interface Breadcrumb {
  /** Milliseconds since epoch. Rendered relative to submit time by the team. */
  t: number;
  /** The analytics event name, or `app_error:<kind>` for failures. */
  e: string;
  /**
   * Set only for `app_error`. Both are closed taxonomies from lib/appError.ts,
   * never free text and never user data.
   */
  ctx?: string;
}

const buffer: Breadcrumb[] = [];

/**
 * The one place a raw analytics event is allowed to become a breadcrumb.
 *
 * Note the shape: `props` is read for exactly two keys on exactly one event,
 * and both are string-coerced and length-capped. Everything else about `props`
 * is discarded before it can reach the buffer. Any change to this function is a
 * privacy change — see lib/support/breadcrumbs.test.ts, which asserts that an
 * event carrying pet attributes yields a name-only crumb.
 */
function toBreadcrumb(event: AnalyticsEvent, props: AnalyticsProps): Breadcrumb {
  if (event === 'app_error') {
    const kind = typeof props.kind === 'string' ? props.kind : 'unknown';
    const context = typeof props.context === 'string' ? props.context : undefined;
    return {
      t: Date.now(),
      e: `app_error:${kind.slice(0, 32)}`,
      ...(context ? { ctx: context.slice(0, 32) } : {}),
    };
  }
  return { t: Date.now(), e: event };
}

function push(crumb: Breadcrumb): void {
  buffer.push(crumb);
  if (buffer.length > BREADCRUMB_LIMIT) {
    buffer.splice(0, buffer.length - BREADCRUMB_LIMIT);
  }
}

let installed = false;

/**
 * Start recording. Called once from the root layout, alongside the other
 * analytics wiring.
 *
 * Idempotent: a double call under Fast Refresh would otherwise register a
 * second sink and write every event to the buffer twice.
 */
export function installBreadcrumbs(): void {
  if (installed) return;
  installed = true;
  addAnalyticsSink((event, props) => {
    push(toBreadcrumb(event, props));
  });
}

/** The trail, oldest first. Returns a copy — callers must not mutate the buffer. */
export function getBreadcrumbs(): Breadcrumb[] {
  return buffer.slice();
}

/**
 * Test seam: empties the buffer. Not called in app code.
 *
 * Deliberately does NOT reset `installed`. There is no way to unregister an
 * analytics sink, so clearing the flag would let a second sink be registered
 * while the first stayed live — every event would then be recorded twice, and
 * the flag would be lying about the real state. Leaving it set keeps the seam
 * honest, and means the idempotency guard is tested as it actually behaves.
 */
export function __resetBreadcrumbs(): void {
  buffer.length = 0;
}

/** Test seam: record a crumb without going through the analytics sink. */
export function __recordForTest(event: AnalyticsEvent, props: AnalyticsProps = {}): void {
  push(toBreadcrumb(event, props));
}

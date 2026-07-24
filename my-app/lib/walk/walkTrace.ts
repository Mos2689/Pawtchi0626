/**
 * walkTrace — one structured, greppable timeline of the walk lifecycle.
 *
 * Why this exists: the "location indicator stays lit after finish" bug can only
 * be reproduced on a real iOS build (TestFlight), so the fix has to be proven
 * with on-device EVIDENCE, not a theory. Every lifecycle beat emits ONE flat
 * record carrying enough state to reconstruct the exact order of events —
 * critically the NATIVE `hasStartedLocationUpdatesAsync` reading at that beat.
 * That single field is the discriminator:
 *   - hasStarted=false after finish while the indicator is still lit
 *     ⇒ the OS task IS unregistered; the lingering indicator is a native
 *       expo-location artifact (no JS stop can fix it).
 *   - hasStarted=true after finish
 *     ⇒ our stop isn't taking, or a start raced it — a JS/lifecycle bug.
 *
 * Delivery: dev → console.log tagged [walkTrace]; prod → a slim PostHog
 * breadcrumb (event 'walk_trace') kept permanently for monitoring. Tracing must
 * NEVER throw into the lifecycle, and never blocks it.
 *
 * Fields must stay FLAT primitives — AnalyticsProps allows only
 * string|number|boolean|null|undefined.
 */

import { AppState } from 'react-native';
import { track } from '../analytics';
import type { AnalyticsProps } from '../analytics';

export interface WalkTraceFields {
  walkSessionId?: string | null;
  phase?: string;
  prevPhase?: string;
  trackingDesired?: boolean;
  /** Native OS reading at this beat, when queried (null = not queried here). */
  hasStarted?: boolean | null;
  reason?: string;
  detail?: string;
}

/**
 * Emit one lifecycle breadcrumb. `event` is a short lifecycle verb, e.g.
 * 'end_begin', 'end_after_stop', 'recover_resume', 'reconcile_forced_stop'.
 */
export function walkTrace(event: string, fields: WalkTraceFields = {}): void {
  const record: AnalyticsProps = {
    trace: event,
    at: Date.now(),
    appState: AppState.currentState,
    walkSessionId: fields.walkSessionId ?? undefined,
    phase: fields.phase,
    prevPhase: fields.prevPhase,
    trackingDesired: fields.trackingDesired,
    hasStarted: fields.hasStarted ?? undefined,
    reason: fields.reason,
    detail: fields.detail,
  };

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    // eslint-disable-next-line no-console
    console.log('[walkTrace]', JSON.stringify(record));
  }

  try {
    track('walk_trace', record);
  } catch {
    // Instrumentation must never affect the walk lifecycle.
  }
}

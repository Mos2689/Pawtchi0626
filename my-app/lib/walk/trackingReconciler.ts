/**
 * trackingReconciler — the ONE authority that enforces the invariant:
 *
 *     trackingDesired === false  ⇒  the OS location service is OFF.
 *
 * Why this exists (and why it was rewritten): stopping tracking used to be a
 * mix of imperative calls (only ran if endWalk completed) and a phase-transition
 * subscription plus a separate AppState "janitor". Those keyed on `phase`, which
 * is a UI-ish value that can sit at a non-active state while the OS task is still
 * registered — with no transition to react to. Every time a new lifecycle path
 * appeared (a slow finalize, a backgrounded finish, a recovery resume), the leak
 * came back. This version keys on the single persisted source of truth
 * (`trackingDesired`, owned by useWalkStore) and enforces it on EVERY lever that
 * can reveal a leak:
 *
 *   1. Source of truth flips to false        → stop immediately.
 *   2. App returns to the foreground         → reconcile (covers a finish that
 *                                              happened while backgrounded).
 *   3. A bounded periodic tick while running → if the OS is tracking while
 *                                              nothing wants it, force stop. A
 *                                              leak cannot outlive one interval,
 *                                              whatever caused it.
 *
 * Because it reacts to state, not to any one button handler, no completion path
 * can forget to stop. The stops inside endWalk / hardStopTracking stay as defense
 * in depth; this is the backstop that no longer depends on remembering to call.
 *
 * Mounted once from the app root (app/_layout.tsx). Idempotent.
 */

import { ensureWalkTrackingStopped, isTracking as isTrackingDefault } from './locationEngine';
import { walkTrace } from './walkTrace';

/** Default periodic reconcile cadence — one cheap `hasStarted` syscall. */
const DEFAULT_INTERVAL_MS = 10_000;

/** Minimal state the reconciler reads. */
interface ReconcilerState {
  trackingDesired: boolean;
}

/** Minimal store shape — lets tests inject a fake store. */
interface TrackingStore {
  subscribe: (
    listener: (state: ReconcilerState, prev: ReconcilerState) => void,
  ) => () => void;
  getState: () => ReconcilerState;
}

/** Minimal AppState shape — lets tests inject a fake. */
interface AppStateLike {
  addEventListener: (
    type: 'change',
    handler: (state: string) => void,
  ) => { remove: () => void };
}

let teardown: (() => void) | null = null;

export interface ReconcilerDeps {
  store?: TrackingStore;
  stop?: () => Promise<void>;
  isTracking?: () => Promise<boolean>;
  appState?: AppStateLike;
  intervalMs?: number;
  setInterval?: (fn: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void;
}

/**
 * Begin reconciling OS tracking to `trackingDesired`. Returns the teardown.
 * Safe to call more than once — an already-running reconciler is a no-op.
 */
export function startTrackingReconciler(deps: ReconcilerDeps = {}): () => void {
  if (teardown) return teardown;

  // Lazy requires so the default path doesn't pull the store graph / RN into
  // test files that inject their own fakes.
  const store: TrackingStore =
    deps.store ?? require('../../store/useWalkStore').useWalkStore;
  const stop = deps.stop ?? ensureWalkTrackingStopped;
  const isTracking = deps.isTracking ?? isTrackingDefault;
  const appState: AppStateLike =
    deps.appState ?? require('react-native').AppState;
  const intervalMs = deps.intervalMs ?? DEFAULT_INTERVAL_MS;
  const setI = deps.setInterval ?? setInterval;
  const clearI = deps.clearInterval ?? clearInterval;

  // The invariant enforcer: if the OS is tracking while nothing wants it, stop.
  // A `reconcile_stop` in the trace is decisive evidence: `hasStarted:true`
  // means the OS task outlived a finished walk (a JS/lifecycle leak we just
  // caught); `hasStarted:false` while the indicator is still visibly lit means
  // the residual is a native expo-location artifact no JS stop can clear.
  //
  // `force` (used by the foreground path) issues the stop UNCONDITIONALLY —
  // never gated on the `isTracking()` read. That read can lie (report false
  // while the manager is alive), and a backgrounded finish can leave a stop
  // that never completed; on return to the foreground we must re-assert the
  // stop regardless of what the read says. The periodic path stays gated so an
  // idle app doesn't fire pointless stops every interval.
  const reconcile = async (source: string, force: boolean): Promise<void> => {
    if (store.getState().trackingDesired) return; // a walk is (re)starting/active
    let on = false;
    try {
      on = await isTracking();
    } catch {
      on = false;
    }
    if (!on && !force) return;
    walkTrace('reconcile_stop', { trackingDesired: false, hasStarted: on, reason: source });
    stop().catch(() => {});
  };

  // 1) React to the source of truth — any flip to false stops now.
  const unsub = store.subscribe((state, prev) => {
    if (state.trackingDesired === prev.trackingDesired) return;
    if (state.trackingDesired) return; // just turned ON — nothing to stop
    walkTrace('reconcile_desired_off', { trackingDesired: false });
    stop().catch(() => {});
  });

  // 2) Every foreground — the belt-and-braces for a backgrounded finish. This
  //    is THE path the repro exercises (start → background → finish leaves the
  //    indicator lit): on return we unconditionally re-issue the stop and log
  //    the native hasStarted reading so the layer that owns any residual is
  //    unambiguous.
  const sub = appState.addEventListener('change', (s: string) => {
    walkTrace('appstate', { detail: s, trackingDesired: store.getState().trackingDesired });
    if (s !== 'active') return;
    reconcile('appstate_active', true);
  });

  // 3) Periodic safety net — a leaked OS task with no desired walk cannot
  //    survive longer than one interval. Cheap: one `hasStarted` read, and it
  //    early-returns (silently) while a walk is active or nothing is tracking.
  const timer = setI(() => {
    reconcile('interval', false);
  }, intervalMs);

  teardown = () => {
    unsub();
    sub.remove();
    clearI(timer);
    teardown = null;
  };
  return teardown;
}

/** Stop reconciling (root unmount / tests). */
export function stopTrackingReconciler(): void {
  if (teardown) teardown();
}

/**
 * trackingReconciler — the single, reactive guarantee that the OS location
 * service is OFF whenever a walk isn't active.
 *
 * Why this exists: stopping tracking used to be *imperative* — it only happened
 * if endWalk() ran to completion. Every other way a walk could leave the
 * `tracking` phase (a reset, a sign-out, an error, a future refactor) had to
 * remember to stop the service, and when JS said `phase: 'idle'` while the
 * native service was still registered, nothing noticed. That fragility is why
 * the "location indicator stays lit until force-close" bug kept regressing.
 *
 * This reconciler makes cleanup a pure function of state: it subscribes to the
 * walk phase and, on every transition INTO a non-active phase, fires the
 * bounded `ensureWalkTrackingStopped`. Because it reacts to the phase itself
 * rather than to any one button handler, ANY code path that leaves the active
 * phases stops the service — so this class of regression cannot silently
 * reappear. The stop inside endWalk stays as defense in depth; this is the
 * backstop that no longer depends on remembering to call it.
 *
 * Mounted once from the app root (app/_layout.tsx). Idempotent.
 */

import { ensureWalkTrackingStopped } from './locationEngine';
import type { WalkPhase } from '../../store/useWalkStore';

/** Tracking must be ON only in these phases; everything else must be OFF. */
const ACTIVE_PHASES: ReadonlySet<WalkPhase> = new Set<WalkPhase>([
  'starting',
  'tracking',
]);

/** Minimal shape the reconciler needs — lets tests inject a fake store. */
interface PhaseStore {
  subscribe: (
    listener: (state: { phase: WalkPhase }, prev: { phase: WalkPhase }) => void,
  ) => () => void;
}

let unsubscribe: (() => void) | null = null;

export interface ReconcilerDeps {
  store?: PhaseStore;
  stop?: () => Promise<void>;
}

/**
 * Begin reconciling OS tracking to walk phase. Returns the unsubscribe. Safe to
 * call more than once — a reconciler is already running is a no-op.
 */
export function startTrackingReconciler(deps: ReconcilerDeps = {}): () => void {
  if (unsubscribe) return unsubscribe;

  // Lazy require so the default path doesn't pull the whole store graph into
  // test files that inject their own fake store.
  const store: PhaseStore =
    deps.store ?? require('../../store/useWalkStore').useWalkStore;
  const stop = deps.stop ?? ensureWalkTrackingStopped;

  const sub = store.subscribe((state, prev) => {
    if (state.phase === prev.phase) return; // only phase transitions matter
    if (ACTIVE_PHASES.has(state.phase)) return; // still (or newly) active
    // Left the active phases — however it happened, the service must be off.
    stop().catch(() => {});
  });

  unsubscribe = () => {
    sub();
    unsubscribe = null;
  };
  return unsubscribe;
}

/** Stop reconciling (root unmount / tests). */
export function stopTrackingReconciler(): void {
  if (unsubscribe) unsubscribe();
}

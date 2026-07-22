/**
 * The regression contract: OS tracking must be stopped on EVERY transition out
 * of an active walk phase — including code paths that bypass endWalk entirely.
 * This is the guarantee that keeps the "location indicator stays lit" bug from
 * silently returning.
 */

// Mock the native engine so no expo-location import is pulled into the suite.
jest.mock('./locationEngine', () => ({
  ensureWalkTrackingStopped: jest.fn(() => Promise.resolve()),
}));

import { ensureWalkTrackingStopped } from './locationEngine';
import {
  startTrackingReconciler,
  stopTrackingReconciler,
} from './trackingReconciler';

type Phase = 'idle' | 'starting' | 'tracking' | 'saving' | 'summary';

/** Minimal zustand-like store exposing subscribe + a phase setter for tests. */
function makeFakeStore(initial: Phase) {
  let state = { phase: initial };
  const listeners = new Set<
    (s: { phase: Phase }, p: { phase: Phase }) => void
  >();
  return {
    subscribe(l: (s: { phase: Phase }, p: { phase: Phase }) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setPhase(next: Phase) {
      const prev = state;
      state = { phase: next };
      listeners.forEach(l => l(state, prev));
    },
  };
}

const stopMock = ensureWalkTrackingStopped as jest.Mock;

afterEach(() => {
  stopTrackingReconciler();
  stopMock.mockClear();
});

describe('trackingReconciler', () => {
  it('does NOT stop while entering/holding active phases', () => {
    const store = makeFakeStore('idle');
    startTrackingReconciler({ store });

    store.setPhase('starting');
    store.setPhase('tracking');

    expect(stopMock).not.toHaveBeenCalled();
  });

  it('stops on every transition out of active phases', () => {
    const store = makeFakeStore('tracking');
    startTrackingReconciler({ store });

    store.setPhase('saving'); // endWalk's own phase — reconciler backs it up
    expect(stopMock).toHaveBeenCalledTimes(1);

    store.setPhase('summary');
    expect(stopMock).toHaveBeenCalledTimes(2);

    store.setPhase('idle');
    expect(stopMock).toHaveBeenCalledTimes(3);
  });

  it('stops when a rogue reset bypasses endWalk (tracking → idle directly)', () => {
    const store = makeFakeStore('tracking');
    startTrackingReconciler({ store });

    // Simulates any future code path that clears the walk without going through
    // endWalk's stop calls — the exact shape of past regressions.
    store.setPhase('idle');

    expect(stopMock).toHaveBeenCalledTimes(1);
  });

  it('ignores no-op notifications where the phase did not change', () => {
    const store = makeFakeStore('summary');
    startTrackingReconciler({ store });

    // Re-emitting the same phase (unrelated state churn) must not thrash stop.
    store.setPhase('summary');

    expect(stopMock).not.toHaveBeenCalled();
  });

  it('is idempotent — a second start does not double-subscribe', () => {
    const store = makeFakeStore('tracking');
    startTrackingReconciler({ store });
    startTrackingReconciler({ store });

    store.setPhase('idle');

    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});

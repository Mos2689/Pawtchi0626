/**
 * The regression contract, rewritten for the source-of-truth reconciler:
 * whenever `trackingDesired` is false, the OS location service must be off — and
 * that must be enforced not only when the flag flips, but on app foreground AND
 * on a periodic tick, so a leaked task with no active walk cannot survive.
 * These tests are the guard that keeps the "indicator stays lit after Finish"
 * bug from silently returning through a new lifecycle path.
 */

// Mock the native engine + tracer so no expo-location / react-native import is
// pulled into the suite. All behavioural deps are injected per-test anyway.
jest.mock('./locationEngine', () => ({
  ensureWalkTrackingStopped: jest.fn(() => Promise.resolve()),
  isTracking: jest.fn(() => Promise.resolve(false)),
}));
jest.mock('./walkTrace', () => ({ walkTrace: jest.fn() }));

import {
  startTrackingReconciler,
  stopTrackingReconciler,
} from './trackingReconciler';

const flush = () => new Promise(r => setImmediate(r));

interface State {
  trackingDesired: boolean;
}

/** Fake store exposing subscribe + getState + a desired-flag setter. */
function makeStore(initial: boolean) {
  let state: State = { trackingDesired: initial };
  const listeners = new Set<(s: State, p: State) => void>();
  return {
    subscribe(l: (s: State, p: State) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getState() {
      return state;
    },
    setDesired(next: boolean) {
      const prev = state;
      state = { trackingDesired: next };
      listeners.forEach(l => l(state, prev));
    },
  };
}

/** Fake AppState — capture the handler so tests can emit transitions. */
function makeAppState() {
  let handler: ((s: string) => void) | null = null;
  let removed = false;
  return {
    addEventListener(_type: 'change', h: (s: string) => void) {
      handler = h;
      return {
        remove() {
          removed = true;
          handler = null;
        },
      };
    },
    emit(s: string) {
      handler?.(s);
    },
    get removed() {
      return removed;
    },
  };
}

/** Fake interval — capture the callback so ticks are deterministic. */
function makeTimers() {
  let cb: (() => void) | null = null;
  let cleared = false;
  return {
    setInterval: ((fn: () => void) => {
      cb = fn;
      return 1 as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearInterval: (() => {
      cleared = true;
      cb = null;
    }) as typeof clearInterval,
    tick() {
      cb?.();
    },
    get cleared() {
      return cleared;
    },
  };
}

function setup(opts: { initialDesired: boolean; tracking?: boolean }) {
  const store = makeStore(opts.initialDesired);
  const appState = makeAppState();
  const timers = makeTimers();
  const stop = jest.fn(() => Promise.resolve());
  const isTracking = jest.fn(() => Promise.resolve(opts.tracking ?? false));
  startTrackingReconciler({
    store,
    stop,
    isTracking,
    appState,
    setInterval: timers.setInterval,
    clearInterval: timers.clearInterval,
  });
  return { store, appState, timers, stop, isTracking };
}

afterEach(() => {
  stopTrackingReconciler();
});

describe('trackingReconciler — source-of-truth enforcement', () => {
  it('stops the instant trackingDesired flips false', () => {
    const { store, stop } = setup({ initialDesired: true });
    store.setDesired(false);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does NOT stop when trackingDesired turns on (a walk starting)', () => {
    const { store, stop } = setup({ initialDesired: false });
    store.setDesired(true);
    expect(stop).not.toHaveBeenCalled();
  });

  it('ignores no-op notifications where the flag did not change', () => {
    const { store, stop } = setup({ initialDesired: true });
    store.setDesired(true); // unrelated state churn re-emits the same value
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('trackingReconciler — periodic leak-catcher', () => {
  it('force-stops a live OS task when no walk is desired', async () => {
    const { timers, stop, isTracking } = setup({ initialDesired: false, tracking: true });
    timers.tick();
    await flush();
    expect(isTracking).toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('leaves tracking alone while a walk is genuinely active', async () => {
    const { timers, stop, isTracking } = setup({ initialDesired: true, tracking: true });
    timers.tick();
    await flush();
    // Early-returns on the desired flag — never even queries the OS.
    expect(isTracking).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does nothing when the OS is already stopped', async () => {
    const { timers, stop, isTracking } = setup({ initialDesired: false, tracking: false });
    timers.tick();
    await flush();
    expect(isTracking).toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('trackingReconciler — foreground reconcile', () => {
  it('force-stops a leak when the app returns to the foreground', async () => {
    const { appState, stop } = setup({ initialDesired: false, tracking: true });
    appState.emit('active');
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('re-issues the stop UNCONDITIONALLY on foreground even when the OS reports not-tracking', async () => {
    // The backgrounded-finish case: a stop issued while suspended may not have
    // completed, and the native "is it running?" read can lie false. Returning
    // to the foreground must re-assert the stop regardless of that read.
    const { appState, stop } = setup({ initialDesired: false, tracking: false });
    appState.emit('active');
    await flush();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('does not force a stop on foreground while a walk is genuinely active', async () => {
    const { appState, stop, isTracking } = setup({ initialDesired: true, tracking: true });
    appState.emit('active');
    await flush();
    expect(isTracking).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('does not reconcile on background transitions', async () => {
    const { appState, stop, isTracking } = setup({ initialDesired: false, tracking: true });
    appState.emit('background');
    await flush();
    expect(isTracking).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('trackingReconciler — lifecycle', () => {
  it('is idempotent — a second start does not double-subscribe', () => {
    const store = makeStore(true);
    const stop = jest.fn(() => Promise.resolve());
    const timers = makeTimers();
    const t1 = startTrackingReconciler({
      store,
      stop,
      isTracking: jest.fn(() => Promise.resolve(false)),
      appState: makeAppState(),
      setInterval: timers.setInterval,
      clearInterval: timers.clearInterval,
    });
    // Second call is ignored while one is already running.
    const t2 = startTrackingReconciler({ store: makeStore(true), stop: jest.fn() });
    expect(t1).toBe(t2);

    store.setDesired(false);
    expect(stop).toHaveBeenCalledTimes(1); // only the first subscription is live
  });

  it('teardown removes the subscription, AppState listener, and interval', () => {
    const { store, appState, timers, stop } = setup({ initialDesired: true });
    stopTrackingReconciler();
    expect(appState.removed).toBe(true);
    expect(timers.cleared).toBe(true);
    store.setDesired(false);
    expect(stop).not.toHaveBeenCalled(); // no longer subscribed
  });
});

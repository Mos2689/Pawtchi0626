import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import { nextAutoRetryDelay } from '../lib/resilientLoad';

/**
 * Re-run a screen's load on its own after it fails (lib/resilientLoad.ts).
 *
 * `load` resolves true on success and false on failure — it handles its own
 * errors, as every Connect screen's load already does. The returned `run` is
 * what the screen calls instead of `load`: on focus, after a write, from a
 * "Try again" button. A failure schedules the next try at 3, 8 and 20 seconds;
 * after that the screen waits for the app to return to the foreground. Leaving
 * the screen cancels anything pending, and success resets the schedule.
 *
 * No network-state listener on purpose: that would be a new native module, and
 * the foreground event covers the common case of coming back online.
 */
export function useAutoRetry(load: () => Promise<boolean>): () => Promise<boolean> {
  const loadRef = useRef(load);
  loadRef.current = load;
  const failures = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focused = useRef(false);

  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const run = useCallback(async (): Promise<boolean> => {
    clear();
    let ok = false;
    try {
      ok = await loadRef.current();
    } catch {
      ok = false;
    }
    if (ok) {
      failures.current = 0;
      return true;
    }
    failures.current += 1;
    const delay = nextAutoRetryDelay(failures.current);
    if (delay !== null && focused.current) {
      timer.current = setTimeout(() => { void run(); }, delay);
    }
    return false;
  }, []);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      clear();
    };
  }, []));

  useEffect(() => {
    let previous: AppStateStatus = AppState.currentState;
    const subscription = AppState.addEventListener('change', next => {
      // Back in the app with a failure outstanding: start the schedule afresh.
      if (next === 'active' && previous !== 'active' && failures.current > 0 && focused.current) {
        failures.current = 0;
        void run();
      }
      previous = next;
    });
    return () => {
      subscription.remove();
      clear();
    };
  }, [run]);

  return run;
}

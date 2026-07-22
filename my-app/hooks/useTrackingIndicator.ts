/**
 * useTrackingIndicator — drives the in-app walk-tracking banner.
 *
 * Two jobs: (1) reassure — show a live banner whenever a walk is genuinely
 * tracking, and (2) recover — surface a warning if the OS location service is
 * still running while NO walk is active (the leak this whole change targets),
 * with a one-tap hard stop.
 *
 * Observability is by polling the native `isTracking()` flag, but only while a
 * walk is active OR the service is reported on — so it costs nothing when idle.
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useWalkStore, WalkPhase } from '../store/useWalkStore';
import { isTracking } from '../lib/walk/locationEngine';

export type IndicatorMode = 'active' | 'leak';

export interface TrackingIndicator {
  visible: boolean;
  mode: IndicatorMode | null;
  petName: string | null;
  elapsedMs: number;
  onStop: () => void;
}

/** Cheap native flag check cadence while a walk (or a leak) is live. */
const POLL_MS = 4000;
const ACTIVE_PHASES: ReadonlySet<WalkPhase> = new Set<WalkPhase>([
  'starting',
  'tracking',
]);

export function useTrackingIndicator(): TrackingIndicator {
  const phase = useWalkStore(s => s.phase);
  const marker = useWalkStore(s => s.marker);
  const [osTracking, setOsTracking] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const phaseActive = ACTIVE_PHASES.has(phase);

  // Poll the OS "is the service running?" flag. Refreshes on mount, whenever the
  // app returns to the foreground, and on an interval — but the interval only
  // runs while a walk is active or the service is (still) on, so it's idle when
  // there's nothing to watch.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const on = await isTracking();
        if (!cancelled) setOsTracking(on);
      } catch {
        if (!cancelled) setOsTracking(false);
      }
    };
    refresh();

    const interval =
      phaseActive || osTracking ? setInterval(refresh, POLL_MS) : null;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') refresh();
    });
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      sub.remove();
    };
  }, [phase, phaseActive, osTracking]);

  // 1s clock for the live timer — only while a walk is active.
  useEffect(() => {
    if (!phaseActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phaseActive]);

  const mode: IndicatorMode | null = phaseActive
    ? 'active'
    : osTracking && phase !== 'saving'
      ? 'leak'
      : null;

  const onStop = useCallback(() => {
    const store = useWalkStore.getState();
    if (ACTIVE_PHASES.has(store.phase)) {
      // A real walk is running — finish it properly so the user keeps it.
      store.endWalk('manual').catch(() => {});
    } else {
      // Nothing to save — just kill the leaked service. Clear the flag
      // optimistically so the banner dismisses instantly; the poll confirms.
      setOsTracking(false);
      store.hardStopTracking().catch(() => {});
    }
  }, []);

  return {
    visible: mode !== null,
    mode,
    petName: marker?.petName ?? null,
    elapsedMs: marker ? Math.max(0, now - marker.startedAt) : 0,
    onStop,
  };
}

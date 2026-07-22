/**
 * locationEngine — the only module that touches expo-location / TaskManager.
 *
 * Everything above this layer (session machine, validator, matcher) is pure;
 * everything below it is the OS. Swapping in a future passive detector or a
 * GPS-collar feed means replacing this file only.
 *
 * Background strategy (store-compliant, battery-sane):
 *   - Android: startLocationUpdatesAsync with a FOREGROUND SERVICE — the
 *     persistent notification is the contract that lets tracking continue
 *     with only while-in-use permission. No ACCESS_BACKGROUND_LOCATION.
 *   - iOS: UIBackgroundModes ["location"] keeps updates flowing while the
 *     session (started in the foreground) is active; the blue indicator is
 *     shown deliberately — transparency over stealth.
 *
 * Delivery is dual-path: points are forwarded to an in-memory listener when
 * the JS runtime is alive (live screen), AND appended to an AsyncStorage
 * buffer so a killed/restarted app can reconstruct the walk (crash recovery
 * is a replay of the buffer through the pure session machine).
 *
 * IMPORTANT: this module must be imported from the app root (app/_layout.tsx)
 * so TaskManager.defineTask runs at bundle load — the OS can wake the task
 * without any screen mounted.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RawGpsPoint } from './walkSession';

export const WALK_LOCATION_TASK = 'pawtchi-walk-location';
const POINT_BUFFER_KEY = 'walk:point_buffer';
// 3s cadence for 3h ≈ 3600 fixes; the cap only guards runaway sessions.
const POINT_BUFFER_CAP = 8000;

type PointListener = (points: RawGpsPoint[]) => void;
let pointListener: PointListener | null = null;

/** Live subscriber for the walk store; pass null to detach. */
export function setPointListener(listener: PointListener | null): void {
  pointListener = listener;
}

function toRawPoints(locations: Location.LocationObject[]): RawGpsPoint[] {
  return locations.map(l => ({
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    timestamp: l.timestamp,
  }));
}

async function appendToBuffer(points: RawGpsPoint[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(POINT_BUFFER_KEY);
    const buffer: RawGpsPoint[] = raw ? JSON.parse(raw) : [];
    buffer.push(...points);
    if (buffer.length > POINT_BUFFER_CAP) {
      buffer.splice(0, buffer.length - POINT_BUFFER_CAP);
    }
    await AsyncStorage.setItem(POINT_BUFFER_KEY, JSON.stringify(buffer));
  } catch (e) {
    if (__DEV__) console.log('[locationEngine] buffer write failed', e);
  }
}

/** Read-and-keep — recovery replays the whole buffer. */
export async function readPointBuffer(): Promise<RawGpsPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(POINT_BUFFER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearPointBuffer(): Promise<void> {
  try {
    await AsyncStorage.removeItem(POINT_BUFFER_KEY);
  } catch {
    // non-fatal — the cap bounds a stale buffer anyway
  }
}

// Module-scope task definition — required by TaskManager, and the reason this
// file is imported from the app root. Guarded so environments without the
// native module (Expo Go, tests) don't crash at bundle load — startWalkLocation
// updates would already fail on those environments before ever calling this.
try {
  TaskManager.defineTask(WALK_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      if (__DEV__) console.log('[locationEngine] task error', error.message);
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] })?.locations;
    if (!locations || locations.length === 0) return;

    const points = toRawPoints(locations);
    await appendToBuffer(points);
    if (pointListener) pointListener(points);
  });
} catch (e) {
  if (__DEV__) console.log('[locationEngine] TaskManager unavailable — tracked walks disabled', e);
}

export type WalkPermission = 'granted' | 'denied' | 'services_off';

// ── Desired-state guard ──
// The OS start/stop calls are slow and can interleave (user taps Finish while
// the native start is still in flight). Rather than sprinkling re-stops at
// every call site, this module owns a single invariant: `desiredTracking` is
// what the app WANTS, and every start records itself in `startInFlight` so a
// stop can wait for it and act on a registered task instead of a no-op.
let desiredTracking = false;
let startInFlight: Promise<void> | null = null;

/**
 * While-in-use permission is all tracking needs (see module header). Returns
 * a denial reason the UI can turn into a graceful fallback — the manual
 * Mark-done flow always remains available. A thrown native-module error
 * (Expo Go, missing dev build) becomes 'denied' rather than a crash.
 */
export async function requestWalkPermission(): Promise<WalkPermission> {
  try {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) return 'services_off';
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    if (__DEV__) console.log('[locationEngine] permission request failed', e);
    return 'denied';
  }
}

export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(WALK_LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function startWalkLocationUpdates(petName: string): Promise<void> {
  desiredTracking = true;
  if (await isTracking()) return; // idempotent — a stale service is reused

  const start = doStartLocationUpdates(petName);
  const wrapped: Promise<void> = start.catch(() => {}).then(() => {
    if (startInFlight === wrapped) startInFlight = null;
  });
  startInFlight = wrapped;
  await start;

  // A stop may have run while the native start was in flight — it found no
  // registered task to act on, so honor it now that the task exists.
  if (!desiredTracking) {
    await ensureWalkTrackingStopped();
  }
}

async function doStartLocationUpdates(petName: string): Promise<void> {
  await Location.startLocationUpdatesAsync(WALK_LOCATION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    // 5m OR 3s, whichever the platform honors — walking pace makes this
    // roughly one fix per few meters without burning the battery at idle.
    distanceInterval: 5,
    timeInterval: 3000,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false, // sniff stops must not kill the stream
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: `${petName}'s walk is being tracked`,
      notificationBody: 'Pawtchi is measuring the route. The walk ends on its own when you get home.',
      notificationColor: '#FFFF00',
      killServiceOnDestroy: false,
    },
  });
}

/**
 * Unconditional stop. Deliberately NOT gated on isTracking(): during the
 * start/finish race (user taps Finish while startLocationUpdatesAsync is
 * still in flight) the "has started" check reads false, the stop is skipped,
 * and the service then outlives the walk — the "location icon never goes
 * away" bug. Stopping a task that isn't running just throws; we swallow it.
 */
export async function stopWalkLocationUpdates(): Promise<void> {
  desiredTracking = false;
  try {
    await Location.stopLocationUpdatesAsync(WALK_LOCATION_TASK);
  } catch (e) {
    if (__DEV__) console.log('[locationEngine] stop noop (not tracking)', e);
  }
}

/**
 * Belt-and-braces stop: some stopLocationUpdatesAsync resolutions land before
 * the underlying CLLocationManager/foreground-service actually releases, and
 * the iOS status-bar location indicator lingers. Poll hasStarted a few times
 * and retry the stop until the OS agrees we're not tracking. Cheap on the
 * happy path (first check returns false, one syscall) — bounded on the sad.
 */
export async function ensureWalkTrackingStopped(): Promise<void> {
  desiredTracking = false;

  // If a native start is mid-flight, stopping now is a no-op the start would
  // immediately undo — wait for it so the loop below sees the registered task.
  if (startInFlight) {
    try {
      await startInFlight;
    } catch {
      // A failed start means nothing got registered — proceed to verify.
    }
  }

  for (let i = 0; i < 8; i++) {
    let stillOn = false;
    try {
      stillOn = await Location.hasStartedLocationUpdatesAsync(WALK_LOCATION_TASK);
    } catch {
      // Can't read the state (Expo Go / missing native module) — fire one
      // best-effort stop rather than trusting an error to mean "not tracking".
      try {
        await Location.stopLocationUpdatesAsync(WALK_LOCATION_TASK);
      } catch {}
      return;
    }
    if (!stillOn) return;
    try {
      await Location.stopLocationUpdatesAsync(WALK_LOCATION_TASK);
    } catch {
      // The stop can race with the OS's own teardown; swallow and re-poll.
    }
    await new Promise(r => setTimeout(r, 250));
  }
  if (__DEV__) console.log('[locationEngine] tracking stop retries exhausted');
}

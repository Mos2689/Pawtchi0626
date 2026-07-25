/**
 * walkTracker — the ENTIRE native/OS surface for tracked walks.
 *
 * ── The model (one rule) ──
 * A walk exists IF AND ONLY IF one durable AsyncStorage record (`walk:active`)
 * exists, and that record is the ONLY thing that authorizes the OS location
 * task to run. Nothing in JavaScript state (no `phase`, no flags, no reconciler)
 * gets a vote.
 *
 *   • start  = write the record, then start the OS task.
 *   • finish = delete the record FIRST, then stop the OS task.
 *   • the OS task is a PURE CONSUMER of the record: on every delivery
 *     (foreground, background, or an OS cold-relaunch of the app) it reads the
 *     record. Absent → it stops ITSELF and drops the delivery. Present → it
 *     appends the points.
 *
 * Why this ends the recurring leak class by construction:
 *   • Reopen with no walk → the OS's leftover task fires once, finds no record,
 *     unregisters itself. It can never auto-start.
 *   • A finish the OS suspends mid-stop → the record is already gone, so the
 *     next delivery self-stops. Nothing lingers until uninstall.
 *   • Reopen DURING a real walk → record present → the walk just continues.
 *     Background mode keeps working; the record is what distinguishes "finished"
 *     (gone) from "still going" (present) with no lifecycle guessing.
 *
 * This module must be imported from the app root (app/_layout.tsx) so the task
 * is defined at bundle load and the OS can wake it with no screen mounted.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { track } from '../analytics';
import type { RawGpsPoint } from './walkSession';
import type { DogWalkProfile } from './dogCalibration';

export const WALK_TASK = 'pawtchi-walk-location';
const ACTIVE_KEY = 'walk:active';
const BUFFER_KEY = 'walk:point_buffer';
// 3s cadence for 3h ≈ 3600 fixes; the cap only guards a runaway session.
const BUFFER_CAP = 8000;

export type WalkPermission = 'granted' | 'denied' | 'services_off';

/** The durable "a walk is happening" record — everything finalize needs. */
export interface ActiveWalkDescriptor {
  id: string;
  petId: string;
  petName: string;
  ownerId: string;
  startedAt: number;
  profile: DogWalkProfile;
}

// ── The durable record: the SOLE authority for "a walk is happening" ──

/** Present ⇒ a walk is happening; null ⇒ no walk (or unreadable — see rawRead). */
export async function readActiveWalk(): Promise<ActiveWalkDescriptor | null> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    return raw ? (JSON.parse(raw) as ActiveWalkDescriptor) : null;
  } catch {
    return null;
  }
}

async function writeActiveWalk(descriptor: ActiveWalkDescriptor): Promise<void> {
  await AsyncStorage.setItem(ACTIVE_KEY, JSON.stringify(descriptor));
}

async function clearActiveWalk(): Promise<void> {
  try {
    await AsyncStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Non-fatal — the task self-heal and the launch reconcile both re-check.
  }
}

/**
 * Read that DISTINGUISHES "no walk" from "storage failed", used only by the
 * task callback: a transient read failure must never be mistaken for "no walk"
 * and kill a live walk. `{ error: true }` ⇒ favor the walk (record the points).
 */
async function rawReadActive(): Promise<
  { value: ActiveWalkDescriptor | null } | { error: true }
> {
  try {
    const raw = await AsyncStorage.getItem(ACTIVE_KEY);
    if (!raw) return { value: null };
    try {
      return { value: JSON.parse(raw) as ActiveWalkDescriptor };
    } catch {
      // Corrupt record ⇒ there is no valid walk.
      return { value: null };
    }
  } catch {
    return { error: true };
  }
}

// ── Point buffer: the durable stream any process can replay to rebuild a walk ──

function toRawPoints(locations: Location.LocationObject[]): RawGpsPoint[] {
  return locations.map(l => ({
    lat: l.coords.latitude,
    lng: l.coords.longitude,
    accuracy: l.coords.accuracy ?? null,
    timestamp: l.timestamp,
  }));
}

export async function appendPoints(points: RawGpsPoint[]): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    const buffer: RawGpsPoint[] = raw ? JSON.parse(raw) : [];
    buffer.push(...points);
    if (buffer.length > BUFFER_CAP) buffer.splice(0, buffer.length - BUFFER_CAP);
    await AsyncStorage.setItem(BUFFER_KEY, JSON.stringify(buffer));
  } catch (e) {
    if (__DEV__) console.log('[walkTracker] buffer write failed', e);
  }
}

export async function readPoints(): Promise<RawGpsPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(BUFFER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function clearPoints(): Promise<void> {
  try {
    await AsyncStorage.removeItem(BUFFER_KEY);
  } catch {
    // Non-fatal — the cap bounds a stale buffer anyway.
  }
}

// ── Live listener — the walk screen attaches while it's mounted ──
type PointListener = (points: RawGpsPoint[]) => void;
let liveListener: PointListener | null = null;

/** Attach the live subscriber (walk store); pass null to detach. */
export function setLiveListener(listener: PointListener | null): void {
  liveListener = listener;
}

// ── The self-healing OS task (defined at module/bundle load) ──
// Guarded so environments without the native module (Expo Go, tests) don't
// crash at load — starting a walk would already fail there before this matters.
try {
  TaskManager.defineTask(WALK_TASK, async ({ data, error }) => {
    if (error) {
      if (__DEV__) console.log('[walkTracker] task error', error.message);
      return;
    }
    const locations = (data as { locations?: Location.LocationObject[] })?.locations;
    if (!locations || locations.length === 0) return;

    const res = await rawReadActive();

    // Definitively no walk (read succeeded, record absent) ⇒ this delivery is a
    // stale OS registration (a finished walk, or an OS relaunch with nothing to
    // track). Unregister at the exact moment it proves itself alive, then drop
    // the delivery. A zombie cannot survive a single callback.
    if ('value' in res && res.value === null) {
      try {
        await Location.stopLocationUpdatesAsync(WALK_TASK);
      } catch {
        // Racing the OS's own teardown; harmless.
      }
      track('walk_bg_self_stopped', {});
      return;
    }

    // Record present, OR the read failed (favor the live walk — a transient
    // storage error must never kill a real walk). Record the points.
    const points = toRawPoints(locations);
    await appendPoints(points);
    if (liveListener) liveListener(points);
  });
} catch (e) {
  if (__DEV__) console.log('[walkTracker] TaskManager unavailable — tracked walks disabled', e);
}

// ── Serialized start/stop ──
// Every OS start/stop runs through one promise chain so a finish and a
// following start can NEVER interleave — a late stop can't kill a fresh start,
// and a late start can't outlive a finish. This one ordering guarantee replaces
// the old desiredTracking/startInFlight bookkeeping.
let opChain: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = opChain.then(fn, fn);
  opChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run as Promise<T>;
}

async function doStart(descriptor: ActiveWalkDescriptor): Promise<void> {
  // Record FIRST: the task is only ever authorized by the record's existence.
  await writeActiveWalk(descriptor);
  await Location.startLocationUpdatesAsync(WALK_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    // 5m OR 3s, whichever the platform honors — one fix per few meters at
    // walking pace without burning the battery at idle.
    distanceInterval: 5,
    timeInterval: 3000,
    activityType: Location.ActivityType.Fitness,
    pausesUpdatesAutomatically: false, // sniff stops must not kill the stream
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: `${descriptor.petName}'s walk is being tracked`,
      notificationBody: 'Pawtchi is measuring the route. The walk ends on its own when you get home.',
      notificationColor: '#FFFF00',
      killServiceOnDestroy: false,
    },
  });
}

async function doStop(): Promise<void> {
  // Record FIRST: even if the OS stop below is delayed or the app is suspended
  // right here, the next delivery finds no record and self-stops.
  await clearActiveWalk();
  // Best-effort unregister with a short bounded verify. Stopping an
  // already-stopped task just throws; we swallow it.
  for (let i = 0; i < 5; i++) {
    try {
      await Location.stopLocationUpdatesAsync(WALK_TASK);
    } catch {
      // not registered / already stopped / racing OS teardown — benign
    }
    let running = false;
    try {
      running = await Location.hasStartedLocationUpdatesAsync(WALK_TASK);
    } catch {
      running = false;
    }
    if (!running) return;
    await new Promise(r => setTimeout(r, 200));
  }
}

/** Begin a walk: write the record, then start the OS task. Serialized. */
export function startWalk(descriptor: ActiveWalkDescriptor): Promise<void> {
  return serialize(() => doStart(descriptor));
}

/** End a walk: clear the record, then stop the OS task. Serialized, idempotent. */
export function stopWalk(): Promise<void> {
  return serialize(doStop);
}

/** Secondary hint only — treat as unreliable (can report false during a walk). */
export async function isRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(WALK_TASK);
  } catch {
    return false;
  }
}

/**
 * While-in-use permission is all a foreground-service / background-mode walk
 * needs. A thrown native-module error (Expo Go) becomes 'denied', not a crash.
 */
export async function requestPermission(): Promise<WalkPermission> {
  try {
    const services = await Location.hasServicesEnabledAsync();
    if (!services) return 'services_off';
    const { status } = await Location.requestForegroundPermissionsAsync();
    return status === 'granted' ? 'granted' : 'denied';
  } catch (e) {
    if (__DEV__) console.log('[walkTracker] permission request failed', e);
    return 'denied';
  }
}

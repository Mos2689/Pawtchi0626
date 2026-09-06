/**
 * arrivalIntent — the note Pawtchi leaves itself when an owner drives to a spot.
 *
 * ── The gap this closes ──
 * The details sheet now offers two ways to arrive: walk from here, or get
 * directions and drive. The first stays inside the app and always did. The
 * second used to be the end of the story — the owner left for Apple Maps, drove
 * twenty minutes, parked, and walked their dog with the app still sitting on
 * Home showing a route from the house they left. The intent was real and
 * Pawtchi simply forgot it at the car door.
 *
 * So tapping "Get directions" on a walkable place writes this note, and Home
 * reads it back the next time it is looked at. If the owner is standing at the
 * place they asked directions to, Home offers to start the walk.
 *
 * ── Why this is not geofencing ──
 * There is no background location here and no monitored region. Pawtchi has no
 * background-location permission at all (it was stripped from app.json for store
 * compliance — see constants/features.ts), and this feature was designed inside
 * that constraint rather than as a reason to reopen it.
 *
 * The check is entirely passive: it happens when Home is focused, against a
 * position the OS already has. Nothing runs while the app is closed, nothing
 * wakes the device, and an owner who never reopens Pawtchi at the park is never
 * located. The cost of that honesty is one tap — they have to open the app —
 * and opening the app is what they were going to do anyway to start the walk.
 *
 * ── Why it is persisted, unlike walkStartIntent ──
 * `walkStartIntent` is deliberately module-level and in-memory, because it hands
 * a gesture to a screen one navigation away. This one has to survive the owner
 * leaving for a map app, a drive long enough for iOS to reclaim the process, and
 * a cold launch at the other end. An in-memory flag would be gone in exactly the
 * case the feature exists for.
 *
 * That persistence is why the record is deliberately thin, why it expires, and
 * why it is namespaced per account: it is one destination the owner explicitly
 * asked for, written on their own device, and it is cleared the moment it has
 * been answered either way.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { haversineMeters, type GeoPoint } from '../walk/geo';

/**
 * How near counts as "here".
 *
 * Generous on purpose, and the generosity is the point: an owner parks at the
 * road end of a beach, not on the pin, and OSM puts a park's node wherever the
 * mapper happened to click — often nowhere near the entrance anyone uses. A
 * tight radius would fail exactly the arrivals it was built for.
 *
 * The failure modes are asymmetric, which is what settles the number. Too tight
 * and the prompt never appears, and the owner learns the feature does not work.
 * Too loose and it appears while they are still parking — which is mildly early
 * and completely harmless, because the prompt is an offer they can decline.
 */
export const ARRIVAL_RADIUS_M = 300;

/**
 * How long a stated intention stays believable.
 *
 * Long enough for a drive across a city with a stop on the way; short enough
 * that a person who looked up a beach on Tuesday is not asked about it on
 * Wednesday. An intent that outlives its own errand is how a helpful prompt
 * becomes a haunting.
 */
export const ARRIVAL_TTL_MS = 4 * 60 * 60 * 1000;

/** The note itself. Only what the prompt has to say, and nothing more. */
export interface ArrivalIntent {
  /** The spot's id — the prompt only ever talks about one place. */
  spotId: string;
  /** Resolved for display at write time, so the prompt never re-derives it. */
  name: string;
  lat: number;
  lng: number;
  /** Epoch ms. Drives expiry, and nothing else. */
  armedAt: number;
}

/**
 * Per account, like every other persisted preference on this device.
 *
 * A shared key would show one owner the other's destination on a family phone,
 * which is both wrong and slightly alarming.
 */
const KEY_PREFIX = 'spots:arrival_intent';

export function arrivalIntentKey(userId: string): string {
  return `${KEY_PREFIX}:${userId}`;
}

/** Shape-check a parsed record. A partial write is treated as no record. */
function isIntent(value: unknown): value is ArrivalIntent {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ArrivalIntent>;
  return (
    typeof v.spotId === 'string' &&
    typeof v.name === 'string' &&
    Number.isFinite(v.lat) &&
    Number.isFinite(v.lng) &&
    Number.isFinite(v.armedAt)
  );
}

/**
 * Remember that the owner asked how to get somewhere they can walk a dog.
 *
 * Called from the "Get directions" tap and from nowhere else. It is not called
 * when a spot is merely opened, or scrolled past, or routed to for the preview:
 * the note records a decision, and only a tap is one.
 *
 * Overwrites any previous note by design. Asking for directions to a second
 * place supersedes the first — an owner heading to the beach instead of the
 * park is not still heading to the park.
 */
export async function armArrivalIntent(
  userId: string | null | undefined,
  intent: Omit<ArrivalIntent, 'armedAt'>,
  now: number = Date.now(),
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(
      arrivalIntentKey(userId),
      JSON.stringify({ ...intent, armedAt: now } satisfies ArrivalIntent),
    );
  } catch {
    // A failed write costs the prompt, not the walk. The owner can still start
    // one the ordinary way, and the sheet has already opened their map app.
  }
}

/**
 * Read the note back, or null if there is nothing believable to read.
 *
 * Expiry is enforced HERE rather than at the call site, and an expired record is
 * deleted on the way out. A stale note that merely fails a check on every read
 * is a stale note that sits on the device forever; clearing it is both the
 * privacy-correct behaviour and the reason this function is async.
 */
export async function readArrivalIntent(
  userId: string | null | undefined,
  now: number = Date.now(),
): Promise<ArrivalIntent | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(arrivalIntentKey(userId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isIntent(parsed)) {
      await clearArrivalIntent(userId);
      return null;
    }
    // `now - armedAt` rather than an absolute expiry timestamp: a device whose
    // clock has been moved backwards produces a negative age, which fails this
    // check and clears the note. That is the safe direction to fail.
    if (now - parsed.armedAt > ARRIVAL_TTL_MS || now < parsed.armedAt) {
      await clearArrivalIntent(userId);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Forget it.
 *
 * Called on every outcome — the walk was started, the prompt was declined, the
 * note expired, a walk began some other way. There is no path where an answered
 * intent survives to be asked about twice.
 */
export async function clearArrivalIntent(
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.removeItem(arrivalIntentKey(userId));
  } catch {
    // Nothing to do. The TTL is the backstop.
  }
}

/**
 * Is the owner actually there?
 *
 * Pure, so the decision is testable without a device, a clock or a store. The
 * position is passed in rather than read here for the same reason: the caller
 * owns the permission check, and a function that could quietly turn on the GPS
 * is not one you can reason about from its name.
 */
export function hasArrived(
  intent: ArrivalIntent,
  position: GeoPoint | null | undefined,
  radiusM: number = ARRIVAL_RADIUS_M,
): boolean {
  if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) {
    return false;
  }
  return haversineMeters(position, { lat: intent.lat, lng: intent.lng }) <= radiusM;
}

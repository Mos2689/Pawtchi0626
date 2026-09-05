// Lightweight per-pantry-item portion learning.
//
// We track the last few portions the user picked for each pantry item in
// AsyncStorage so the meal screen can pre-fill what they're actually feeding.
//
// ── Why this stores a typed portion and not a number ──
//
// v1 stored a bare multiplier. A bare multiplier carries no unit: `200` could
// mean 200 g, 200 pieces or 200 bowls, and nothing downstream could tell. When
// a gram-unit bug made the meal screen produce a multiplier of 200, that number
// was recorded here, survived the fix that corrected the bug, and was replayed
// on the next open — reproducing a 24,000 kcal meal on a build that had already
// been patched. A value that outlives the code that produced it has to describe
// itself.
//
// So: every entry carries its `mode`, its quantity is in that mode's native
// units, and it is validated against the SAME bounds the portion stepper
// enforces (`getPortionBounds`). Learning can never propose a portion the UI
// itself would refuse.
//
// Legacy v1 entries are discarded rather than migrated — see STORE_KEY below.
//
// Keep this pure (no React/zustand). All state lives in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PortionBounds } from './pantryMath';

/**
 * v1 held bare scalars under `portion_learning_v1`. Bumping the key is what
 * makes the poisoned history structurally unreachable rather than merely
 * filtered — there is no shape of scalar we could safely reinterpret, because
 * the unit it was measured in was never recorded.
 */
const STORE_KEY = 'portion_learning_v2';
const LEGACY_STORE_KEY = 'portion_learning_v1';

const HISTORY_LIMIT = 5;
/** Need this many consecutive matching picks to suggest a new usual. */
export const SUGGEST_THRESHOLD = 2;

export type PortionMode = 'weight' | 'count' | 'fraction';

/**
 * One recorded portion.
 *
 * `quantity` is in the mode's native units — grams for weight, whole pieces for
 * count, multiples of one serving unit for fraction. In weight mode the
 * quantity IS the gram figure, so `gramsFed` is deliberately absent: carrying
 * both invites them to disagree.
 */
export interface LearnedPortion {
  mode: PortionMode;
  quantity: number;
  /** Grams this portion represents. Set for count/fraction only. */
  gramsFed?: number;
  /** Pantry nutrition revision in force when this was recorded, when known. */
  nutritionRevision?: number;
}

interface History {
  recent: LearnedPortion[]; // newest last; max HISTORY_LIMIT
}

interface Store {
  [pantryItemId: string]: History | undefined;
}

/** Quantities this close together count as "the same portion", per mode. */
function quantityEpsilon(mode: PortionMode): number {
  switch (mode) {
    case 'weight': return 0.5;   // half a gram
    case 'count': return 0.5;    // integers anyway
    case 'fraction': return 0.01;
  }
}

/**
 * Is this a portion we are willing to store or replay?
 *
 * Rejects anything that isn't an object (which is how a legacy v1 scalar is
 * caught if one ever reaches us), any mode that doesn't match the item's
 * current mode (a saved "3 pieces" is meaningless once the item is measured in
 * grams), and anything outside the stepper's own range.
 */
export function isValidLearnedPortion(
  value: unknown,
  bounds: PortionBounds,
): value is LearnedPortion {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const p = value as Partial<LearnedPortion>;
  if (p.mode !== bounds.mode) return false;
  if (typeof p.quantity !== 'number' || !Number.isFinite(p.quantity)) return false;
  if (p.quantity < bounds.min || p.quantity > bounds.max) return false;
  if (bounds.mode === 'count' && !Number.isInteger(p.quantity)) return false;
  return true;
}

let legacyPurged = false;

async function read(): Promise<Store> {
  try {
    // Best-effort, once per process: get the poisoned scalars off the device
    // rather than leaving them to be found by some future reader.
    if (!legacyPurged) {
      legacyPurged = true;
      AsyncStorage.removeItem(LEGACY_STORE_KEY).catch(() => {});
    }
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function write(store: Store): Promise<void> {
  try {
    await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch {
    // Best-effort; learning is non-critical.
  }
}

/**
 * Append a portion to the per-item history (trimmed to HISTORY_LIMIT).
 *
 * Out-of-range portions are dropped rather than stored. Learning is a
 * convenience; recording something the stepper would refuse would turn it into
 * a way to smuggle an impossible portion back into the UI later.
 */
export async function recordServing(
  pantryItemId: string,
  portion: LearnedPortion,
  bounds: PortionBounds,
): Promise<void> {
  if (!pantryItemId) return;
  if (!isValidLearnedPortion(portion, bounds)) return;
  const store = await read();
  const prev = store[pantryItemId]?.recent ?? [];
  const next = [...prev, portion].slice(-HISTORY_LIMIT);
  store[pantryItemId] = { recent: next };
  await write(store);
}

export interface SuggestionOptions {
  /**
   * The quantity that already IS the default for this item. A suggestion equal
   * to it is not a suggestion — there is nothing to change.
   */
  defaultQuantity?: number;
  threshold?: number;
}

/**
 * If the most recent N picks are all valid, all equal, and not already the
 * default, return that portion as the suggested usual. Otherwise null.
 *
 * Note the entries are NOT filtered before the streak is measured. Skipping an
 * invalid entry would let two non-adjacent picks masquerade as consecutive; a
 * bad entry should break the streak, not be stepped over.
 */
export function pickSuggestionFromHistory(
  history: unknown[],
  bounds: PortionBounds,
  opts: SuggestionOptions = {},
): LearnedPortion | null {
  const threshold = opts.threshold ?? SUGGEST_THRESHOLD;
  if (!Array.isArray(history) || history.length < threshold) return null;

  const last = history.slice(-threshold);
  if (!last.every((entry) => isValidLearnedPortion(entry, bounds))) return null;

  const picks = last as LearnedPortion[];
  const target = picks[0];
  const eps = quantityEpsilon(bounds.mode);

  if (
    opts.defaultQuantity != null &&
    Math.abs(target.quantity - opts.defaultQuantity) < eps
  ) {
    return null;
  }

  const allMatch = picks.every((p) => Math.abs(p.quantity - target.quantity) < eps);
  return allMatch ? target : null;
}

/** Async wrapper: write the just-picked portion, then return a suggestion. */
export async function recordAndMaybeSuggest(
  pantryItemId: string,
  portion: LearnedPortion,
  bounds: PortionBounds,
  opts?: SuggestionOptions,
): Promise<LearnedPortion | null> {
  await recordServing(pantryItemId, portion, bounds);
  const store = await read();
  const recent = store[pantryItemId]?.recent ?? [];
  return pickSuggestionFromHistory(recent, bounds, opts);
}

/** Read-only: the current suggestion for an item from its stored history. */
export async function getSuggestion(
  pantryItemId: string,
  bounds: PortionBounds,
  opts?: SuggestionOptions,
): Promise<LearnedPortion | null> {
  if (!pantryItemId) return null;
  const store = await read();
  const recent = store[pantryItemId]?.recent ?? [];
  return pickSuggestionFromHistory(recent, bounds, opts);
}

/** Clear the per-item history. */
export async function clearHistory(pantryItemId: string): Promise<void> {
  if (!pantryItemId) return;
  const store = await read();
  if (!store[pantryItemId]) return;
  delete store[pantryItemId];
  await write(store);
}

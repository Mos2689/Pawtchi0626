// Lightweight per-pantry-item portion learning.
//
// We track the last few serving multipliers the user picked for each pantry
// item in AsyncStorage. When the user repeatedly picks "A little less" (0.75)
// or "A little more" (1.25) for the same food, the result screen offers a
// one-tap "make this the new usual?" prompt that updates the pantry item's
// kcal_per_serving proportionally — so future quick-logs default to what the
// user is actually feeding.
//
// Keep this pure (no React/zustand). All state lives in AsyncStorage.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORE_KEY = 'portion_learning_v1';
const HISTORY_LIMIT = 5;
/** Need this many consecutive non-1× picks to suggest a new usual. */
export const SUGGEST_THRESHOLD = 2;

interface History {
  recent: number[]; // newest last; max HISTORY_LIMIT
}

interface Store {
  [pantryItemId: string]: History | undefined;
}

async function read(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
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

/** Append a multiplier to the per-item history (trimmed to HISTORY_LIMIT). */
export async function recordServing(pantryItemId: string, multiplier: number): Promise<void> {
  if (!pantryItemId || !Number.isFinite(multiplier) || multiplier <= 0) return;
  const store = await read();
  const prev = store[pantryItemId]?.recent ?? [];
  const next = [...prev, multiplier].slice(-HISTORY_LIMIT);
  store[pantryItemId] = { recent: next };
  await write(store);
}

/**
 * If the user just picked a non-1× multiplier *and* their most recent N picks
 * (including this one) all matched the same off-1× value, return that value as
 * the suggested new usual. Otherwise return null.
 *
 * Pure helper so the meal screen can call it without async fan-out — pass in
 * the already-loaded history.
 */
export function pickSuggestionFromHistory(
  history: number[],
  threshold: number = SUGGEST_THRESHOLD,
): number | null {
  if (history.length < threshold) return null;
  const last = history.slice(-threshold);
  const target = last[0];
  if (target === 1) return null;
  if (target <= 0 || !Number.isFinite(target)) return null;
  const allMatch = last.every((m) => Math.abs(m - target) < 0.01);
  return allMatch ? target : null;
}

/** Async wrapper: write the just-picked multiplier, then return a suggestion. */
export async function recordAndMaybeSuggest(
  pantryItemId: string,
  multiplier: number,
): Promise<number | null> {
  await recordServing(pantryItemId, multiplier);
  const store = await read();
  const recent = store[pantryItemId]?.recent ?? [];
  return pickSuggestionFromHistory(recent);
}

/** Read-only: the current suggestion for an item from its stored history. */
export async function getSuggestion(pantryItemId: string): Promise<number | null> {
  if (!pantryItemId) return null;
  const store = await read();
  const recent = store[pantryItemId]?.recent ?? [];
  return pickSuggestionFromHistory(recent);
}

/** Clear the per-item history (called when the user accepts the new usual). */
export async function clearHistory(pantryItemId: string): Promise<void> {
  if (!pantryItemId) return;
  const store = await read();
  if (!store[pantryItemId]) return;
  delete store[pantryItemId];
  await write(store);
}

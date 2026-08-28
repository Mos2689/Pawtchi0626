/**
 * When each place last produced a then/now offer.
 *
 * ── Why this has to be persisted ──
 * PLACE_COOLDOWN_DAYS is the guard that stops place memory nagging, and the
 * behaviour it guards against is inherently cross-walk: someone on a daily loop
 * passes the same tree tomorrow, and the day after, and the day after that. A
 * cooldown held only in memory would reset every walk and guard nothing — the
 * prompt would fire at the same tree every single day, which is precisely the
 * failure the constant exists to prevent.
 *
 * ── Shape ──
 * One AsyncStorage key per account holding `{ [placeKey]: timestamp }`. Small
 * by construction: only places that have actually produced an offer appear, and
 * entries older than the cooldown are swept on write.
 *
 * Namespaced per owner, and fire-and-forget on every failure — the same posture
 * as walkStorySync.ts. Worst case on a failed read is one extra prompt; worst
 * case on a failed write is the same. Neither is worth failing a walk over.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { PLACE_COOLDOWN_DAYS } from './placeMemory';

const PREFIX = 'keepsake:placeprompt';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Per-account storage key. */
export function placePromptKey(userId: string): string {
  return `${PREFIX}:${userId}`;
}

export type PlacePromptLog = Record<string, number>;

/**
 * Entries this old can never suppress anything again, so they are dropped on
 * the next write. Twice the cooldown, not exactly the cooldown — an entry
 * sitting right on the boundary is cheap to keep and awkward to reason about.
 */
const SWEEP_AFTER_MS = 2 * PLACE_COOLDOWN_DAYS * DAY_MS;

export async function readPlacePromptLog(userId: string): Promise<PlacePromptLog> {
  try {
    const raw = await AsyncStorage.getItem(placePromptKey(userId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};

    const out: PlacePromptLog = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const at = Number(value);
      if (Number.isFinite(at)) out[key] = at;
    }
    return out;
  } catch {
    return {};
  }
}

/** Drop entries too old to suppress anything. Pure, so it is testable. */
export function sweepPlacePromptLog(log: PlacePromptLog, now: number): PlacePromptLog {
  const out: PlacePromptLog = {};
  for (const [key, at] of Object.entries(log)) {
    if (now - at < SWEEP_AFTER_MS) out[key] = at;
  }
  return out;
}

export async function recordPlacePrompt(
  userId: string,
  placeKey: string,
  now: number = Date.now(),
): Promise<void> {
  try {
    const existing = await readPlacePromptLog(userId);
    const next = sweepPlacePromptLog({ ...existing, [placeKey]: now }, now);
    await AsyncStorage.setItem(placePromptKey(userId), JSON.stringify(next));
  } catch {
    // Non-fatal by design — see the module header.
  }
}

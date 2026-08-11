/**
 * walkStorySync — the "a fresh Walk Story is waiting" marker.
 *
 * One AsyncStorage key holds the latest walk that earned a story. The Home
 * avatar reads it on focus to decide whether the story ring should glow; the
 * viewer marks it seen on open, and the ring goes quiet. Ephemeral by design:
 * a story is only "fresh" on the day it was made and until it's been opened —
 * yesterday's walk never keeps the ring lit.
 *
 * Mirrors walksignSync's pattern: fire-and-forget, every failure non-fatal
 * (worst case the ring just doesn't light, or lights once more than it should).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalYMD } from './dateUtils';

const PENDING_KEY = 'walkstory:pending';

export interface PendingWalkStory {
  /** The walk_sessions id whose story the ring points at. */
  walkSessionId: string;
  /** The pet the walk belongs to — so the ring never lights on another pet. */
  petId: string;
  /** ISO timestamp the story became available (walk completion time). */
  generatedAt: string;
  /** True once the viewer has been opened for this story. */
  seen: boolean;
}

export async function readPendingWalkStory(): Promise<PendingWalkStory | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingWalkStory) : null;
  } catch {
    return null;
  }
}

/** Stash the newest walk as the pending story. A new walk always supersedes
 *  the last — the ring only ever points at the most recent outing. */
export async function setPendingWalkStory(walkSessionId: string, petId: string): Promise<void> {
  try {
    const payload: PendingWalkStory = {
      walkSessionId,
      petId,
      generatedAt: new Date().toISOString(),
      seen: false,
    };
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(payload));
  } catch {
    // No marker means no ring for this walk — the story itself is unaffected.
  }
}

/** Flip the pending record to seen (keeps the id so the viewer can still open
 *  it), which quiets the ring. No-op when there's nothing pending. */
export async function markWalkStorySeen(): Promise<void> {
  try {
    const current = await readPendingWalkStory();
    if (!current || current.seen) return;
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify({ ...current, seen: true }));
  } catch {
    // Worst case the ring shows once more — better than losing the story.
  }
}

/**
 * A story is "fresh" (ring glows) only while it's from today and unseen. The
 * day boundary uses the phone's local calendar day, matching every other daily
 * read in the app.
 */
export function isStoryFresh(payload: PendingWalkStory | null): boolean {
  if (!payload || payload.seen) return false;
  const generated = new Date(payload.generatedAt);
  if (Number.isNaN(generated.getTime())) return false;
  return getLocalYMD(generated) === getLocalYMD(new Date());
}

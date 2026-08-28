/**
 * walkStorySync — the "a fresh Walk Story is waiting" marker.
 *
 * One AsyncStorage key per account holds the latest walk that earned a story.
 * The Home avatar reads it on focus to decide whether the story ring should
 * glow; the viewer marks it seen on open, and the ring goes quiet. Ephemeral by
 * design: a story is only "fresh" on the day it was made and until it's been
 * opened — yesterday's walk never keeps the ring lit.
 *
 * The key is namespaced per owner (see `hooks/useFirstWalkIntro.ts` for the
 * precedent). It used to be one device-global slot, so a walk recorded by one
 * account left a pending story behind for whoever signed in next; readers
 * happened to filter on petId, which masked it, but a marker pointing at another
 * account's walk_session had no business being readable at all.
 *
 * Mirrors walksignSync's pattern: fire-and-forget, every failure non-fatal
 * (worst case the ring just doesn't light, or lights once more than it should).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocalYMD } from './dateUtils';

const PENDING_PREFIX = 'walkstory:pending';

/** Per-account storage key. */
export function pendingWalkStoryKey(userId: string): string {
  return `${PENDING_PREFIX}:${userId}`;
}

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

export async function readPendingWalkStory(
  userId: string | null | undefined,
): Promise<PendingWalkStory | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(pendingWalkStoryKey(userId));
    return raw ? (JSON.parse(raw) as PendingWalkStory) : null;
  } catch {
    return null;
  }
}

/** Stash the newest walk as the pending story. A new walk always supersedes
 *  the last — the ring only ever points at the most recent outing. */
export async function setPendingWalkStory(
  walkSessionId: string,
  petId: string,
  ownerId: string | null | undefined,
): Promise<void> {
  if (!ownerId) return;
  try {
    const payload: PendingWalkStory = {
      walkSessionId,
      petId,
      generatedAt: new Date().toISOString(),
      seen: false,
    };
    await AsyncStorage.setItem(pendingWalkStoryKey(ownerId), JSON.stringify(payload));
  } catch {
    // No marker means no ring for this walk — the story itself is unaffected.
  }
}

/** Flip the pending record to seen (keeps the id so the viewer can still open
 *  it), which quiets the ring. No-op when there's nothing pending. */
export async function markWalkStorySeen(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  try {
    const current = await readPendingWalkStory(userId);
    if (!current || current.seen) return;
    await AsyncStorage.setItem(
      pendingWalkStoryKey(userId),
      JSON.stringify({ ...current, seen: true }),
    );
  } catch {
    // Worst case the ring shows once more — better than losing the story.
  }
}

/** Remove the pending marker only when it belongs to the discarded walk. */
export async function clearPendingWalkStory(
  walkSessionId: string,
  userId: string | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    const current = await readPendingWalkStory(userId);
    if (current?.walkSessionId === walkSessionId) {
      await AsyncStorage.removeItem(pendingWalkStoryKey(userId));
    }
  } catch {
    // A stale ring is non-fatal and will expire at the local day boundary.
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

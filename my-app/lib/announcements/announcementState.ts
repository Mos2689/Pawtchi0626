/**
 * Per-account memory of which announcements this person has seen.
 *
 * On the device, per user id, so two accounts on one phone keep separate
 * counts. A reinstall or a second phone starts from zero: accepted for a cap
 * of three built-in showings, and the reason no table was added for it.
 *
 * Every write is read-modify-write of the whole map, and every failure is
 * swallowed — an announcement must never be able to break Home.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  EMPTY_RECORD,
  type AnnouncementRecord,
  type AnnouncementState,
} from './eligibility';

const KEY_PREFIX = 'pawtchi.announcements.v1:';

export function announcementStateKey(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** Corrupt or foreign data reads as "never seen", entry by entry. */
export function normalizeState(raw: unknown): AnnouncementState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: AnnouncementState = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    out[id] = {
      shows: toCount(v.shows),
      dismissals: toCount(v.dismissals),
      completed: v.completed === true,
      lastShownAt: typeof v.lastShownAt === 'number' && Number.isFinite(v.lastShownAt) ? v.lastShownAt : null,
    };
  }
  return out;
}

export async function readAnnouncementState(userId: string): Promise<AnnouncementState> {
  try {
    const raw = await AsyncStorage.getItem(announcementStateKey(userId));
    return raw ? normalizeState(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

async function update(
  userId: string,
  id: string,
  change: (r: AnnouncementRecord) => AnnouncementRecord,
): Promise<AnnouncementRecord> {
  const state = await readAnnouncementState(userId);
  const next = change(state[id] ?? EMPTY_RECORD);
  try {
    await AsyncStorage.setItem(announcementStateKey(userId), JSON.stringify({ ...state, [id]: next }));
  } catch {
    // Worst case it shows once more than intended.
  }
  return next;
}

/**
 * Counted when the sheet appears, not when it closes: an app killed with the
 * sheet open has still shown it, and must not show it again tomorrow as if
 * it never had.
 */
export function recordShown(userId: string, id: string, now: number): Promise<AnnouncementRecord> {
  return update(userId, id, (r) => ({ ...r, shows: r.shows + 1, lastShownAt: now }));
}

export function recordDismissed(userId: string, id: string): Promise<AnnouncementRecord> {
  return update(userId, id, (r) => ({ ...r, dismissals: r.dismissals + 1 }));
}

export function recordCompleted(userId: string, id: string): Promise<AnnouncementRecord> {
  return update(userId, id, (r) => ({ ...r, completed: true }));
}

/** Development only: pretend every showing happened `ms` earlier. */
export async function rewindAnnouncementStateForDev(userId: string, ms: number): Promise<void> {
  const state = await readAnnouncementState(userId);
  const shifted: AnnouncementState = {};
  for (const [id, r] of Object.entries(state)) {
    shifted[id] = { ...r, lastShownAt: r.lastShownAt == null ? null : r.lastShownAt - ms };
  }
  try {
    await AsyncStorage.setItem(announcementStateKey(userId), JSON.stringify(shifted));
  } catch {
    // Development helper; nothing to do.
  }
}

/** Development only: forget everything for this account. */
export async function resetAnnouncementState(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(announcementStateKey(userId));
  } catch {
    // Nothing to do.
  }
}

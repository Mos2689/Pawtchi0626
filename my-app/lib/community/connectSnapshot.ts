/**
 * Connect's last answer, kept on the phone so a cold start opens populated.
 *
 * ── Why this now exists ─────────────────────────────────────────────────────
 *
 * `communityCache` is memory only, on purpose (see its header). That made every
 * cold start open Connect with nothing, ask the network, and — because the Up
 * Next card was derived from the empty list — tell someone with a meetup on
 * Sunday "NOTHING PLANNED" for the seconds it took to answer (device report,
 * 2026-09-25). The last answer painted first and corrected behind is the same
 * trade `hooks/useRecentWalks.ts` and `lib/activity/todayCache.ts` already make.
 *
 * ── The original worry, and how each part of it is answered ────────────────
 *
 * "A plan restored from disk after a week would be presented as current."
 *
 *   * It is never presented as confirmed. Home marks restored data stale and
 *     shows "Updating…" until the refresh it starts at once has answered.
 *   * Past walks do not come back to life: `pickUpNext` already drops a dated
 *     walk once its start is more than three hours gone.
 *   * Anything older than MAX_RESTORE_AGE_MS is refused outright.
 *   * A restored EMPTY list is not restored at all. "You have no meetups" is a
 *     claim this file is never allowed to make — only the server makes it.
 *
 * ── Whose data ─────────────────────────────────────────────────────────────
 *
 * One slot, stamped with the user it belongs to, restored only for that user.
 * Cleared on sign-out with the rest of the previous account's state
 * (`clearAllUserState`). A save that was already in flight when the account
 * signed out is refused by `clearedAt`, so it cannot write the previous
 * owner's meetups back to disk behind the clear.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import type { CommunityPack } from '../communityWalks';
import type { GeoPoint } from '../walk/geo';

const KEY = 'connect:snapshot:v1';

/** A restore older than this is not a head start, it is a different life. */
export const MAX_RESTORE_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Routes kept per trail. The stored routes are already simplified to ~200. */
const MAX_ROUTE_POINTS = 200;

export interface ConnectSnapshot {
  userId: string;
  savedAt: number;
  packs: CommunityPack[];
  routes: Record<string, GeoPoint[]>;
}

let current: ConnectSnapshot | null = null;
let loading: Promise<void> | null = null;
/** Bumped by `clear`, so a read or write begun before it cannot land after. */
let generation = 0;
let clearedAt = 0;
/** Writes run one at a time, so the disk always holds the newest. */
let writes: Promise<void> = Promise.resolve();

function isSnapshot(value: unknown): value is ConnectSnapshot {
  const v = value as ConnectSnapshot | null;
  return !!v
    && typeof v.userId === 'string'
    && typeof v.savedAt === 'number'
    && Array.isArray(v.packs)
    && !!v.routes && typeof v.routes === 'object';
}

/**
 * Read the slot into memory. Idempotent; call it as early as possible — the
 * root layout starts it at bundle load, beside the zustand stores' own reads,
 * so it has landed long before Home mounts.
 */
export function loadConnectSnapshot(): Promise<void> {
  if (loading) return loading;
  const startedIn = generation;
  loading = AsyncStorage.getItem(KEY)
    .then(raw => {
      if (startedIn !== generation || !raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (isSnapshot(parsed)) current = parsed;
    })
    .catch(() => {
      // A corrupt or unreadable slot is the same as no slot: Connect asks the
      // network, exactly as it did before this file existed.
    });
  return loading;
}

/**
 * The last answer for this user, if it is theirs, recent, and not empty.
 * Synchronous — safe in a `useState` initialiser.
 */
export function restoreConnectSnapshot(
  userId: string | null | undefined,
  now: number = Date.now(),
): { packs: CommunityPack[]; routes: Record<string, GeoPoint[]> } | null {
  const snap = current;
  if (!snap || !userId || snap.userId !== userId) return null;
  if (now - snap.savedAt > MAX_RESTORE_AGE_MS) return null;
  if (snap.packs.length === 0) return null;
  return { packs: snap.packs, routes: snap.routes };
}

function persist(next: ConnectSnapshot): void {
  const inGeneration = generation;
  current = next;
  writes = writes
    .then(() => (inGeneration === generation ? AsyncStorage.setItem(KEY, JSON.stringify(next)) : undefined))
    .catch(() => {});
}

/**
 * The server's list, saved. `askedAt` is when the request was STARTED: an
 * answer to a question asked before a sign-out is not saved after it.
 *
 * Routes for trails no longer on the list are dropped, so the slot cannot grow
 * without bound as trails come and go.
 */
export function saveConnectPacks(
  userId: string,
  packs: CommunityPack[],
  askedAt: number,
  now: number = Date.now(),
): void {
  if (askedAt < clearedAt) return;
  const keep = new Set(packs.map(pack => pack.id));
  const previous = current && current.userId === userId ? current.routes : {};
  const routes: Record<string, GeoPoint[]> = {};
  for (const [id, route] of Object.entries(previous)) {
    if (keep.has(id)) routes[id] = route;
  }
  persist({ userId, savedAt: now, packs, routes });
}

/** Each trail's last route — the map lines — saved beside the list. */
export function saveConnectRoutes(
  userId: string,
  routes: Record<string, GeoPoint[]>,
  askedAt: number,
): void {
  if (askedAt < clearedAt) return;
  const snap = current;
  // Routes only ever decorate a list we already hold for this user.
  if (!snap || snap.userId !== userId) return;
  const keep = new Set(snap.packs.map(pack => pack.id));
  const trimmed: Record<string, GeoPoint[]> = {};
  for (const [id, route] of Object.entries(routes)) {
    if (keep.has(id)) trimmed[id] = route.slice(0, MAX_ROUTE_POINTS);
  }
  persist({ ...snap, routes: trimmed });
}

/** Sign-out. Memory, disk, and anything already on its way to either. */
export function clearConnectSnapshot(now: number = Date.now()): void {
  generation += 1;
  clearedAt = now;
  current = null;
  loading = null;
  writes = writes.then(() => AsyncStorage.removeItem(KEY)).catch(() => {});
}

/** Test seam: forget memory state without touching the (mocked) disk. */
export function resetConnectSnapshotForTests(): void {
  generation += 1;
  clearedAt = 0;
  current = null;
  loading = null;
  writes = Promise.resolve();
}

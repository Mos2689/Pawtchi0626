/**
 * captureJournal — every photo taken on a walk, written down the instant it is
 * taken.
 *
 * ── The hole this fills ──
 * A walk has no `walk_sessions` row until it saves, so useWalkKeepsakes held
 * each capture in memory (`pendingRef`) and flushed it once a session id
 * appeared. Memory is exactly the wrong place for the only record of a
 * photograph:
 *
 *   • iOS kills the app mid-walk — common with the camera open and GPS running.
 *     walkTracker restores the WALK from its durable record, but the photos
 *     were in a ref that died with the process.
 *   • The walk screen unmounts while the walk continues (the owner goes Home
 *     and back). A fresh hook instance starts with an empty ref.
 *   • The walk finishes offline, so `walkSessionId` arrives after the summary
 *     has already been left.
 *
 * In every case the file sat in Documents/keepsakes with no row pointing at
 * it: invisible, and eventually swept. A user lost every photo on three walks
 * this way before anyone could tell (Oct 2026).
 *
 * ── What it holds ──
 * Metadata only, as the outbox does — the file is already durable in the app
 * container (keepsakeFile.ts). An entry names the walk it belongs to by the
 * walk's START TIME, the one fact both the durable walk record
 * (ActiveWalkDescriptor.startedAt) and the saved row (walk_sessions.started_at,
 * written from the same value in walkSync.ts) agree on.
 *
 * ── Lifecycle ──
 *   1. Shutter → `appendJournal` (before the capture is shown as kept).
 *   2. Hook mount for a walk → `journalForWalk` seeds the drafts, so a restore
 *      or remount picks up where the last process left off.
 *   3. Row written, or moved to the outbox → `removeFromJournal`.
 *   4. App foreground → keepsakeRecovery matches anything still here to its
 *      saved walk (`matchJournalToWalk`) and hands it to the outbox.
 * An entry nothing can be matched to stays, and its file stays protected from
 * the sweep: a photo we cannot place is still a photo.
 *
 * ── Contract ──
 * Best-effort, like the outbox: nothing throws; a failed read is an empty
 * journal and a failed write retries from whatever is on disk.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeepsakeSource } from './keepsake';
import type { KeepsakeOutboxEntry } from './keepsakeOutbox';

const STORAGE_KEY = 'pawtchi.walk.captureJournal.v1';

/**
 * Upper bound on entries kept. A safety valve, not a policy: at ~400 KB a
 * photo, 500 entries is 200 MB of photographs nobody could place — far past
 * anything real use produces. Oldest drop first, and only their METADATA drops;
 * the files themselves are left for the sweep's normal rules.
 */
export const JOURNAL_MAX_ENTRIES = 500;

/** How far apart the journal's start time and the saved row's may be. */
export const START_MATCH_TOLERANCE_MS = 2_000;

export interface CaptureJournalEntry {
  /** The `walk_media` row id this photo will take — see PendingCapture.mediaId. */
  mediaId: string;
  ownerId: string;
  petId: string;
  /** The walk this photo belongs to, by its start time (ms since epoch). */
  walkStartedAt: number;
  capturedAt: number;
  lat: number | null;
  lng: number | null;
  routeIndex: number | null;
  elapsedS: number | null;
  placeKey: string | null;
  source: KeepsakeSource;
  /** Bare filename in the app container, or null when it could not be kept. */
  localPath: string | null;
  /**
   * Only when `localPath` is null: the camera's cache uri, the photo's sole
   * copy until its thumbnail uploads. Valid for the current install only.
   */
  cacheUri: string | null;
  width: number | null;
  height: number | null;
  journaledAt: number;
}

function isEntry(value: unknown): value is CaptureJournalEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<CaptureJournalEntry>;
  return (
    typeof e.mediaId === 'string' &&
    typeof e.ownerId === 'string' &&
    typeof e.petId === 'string' &&
    typeof e.walkStartedAt === 'number' &&
    Number.isFinite(e.walkStartedAt) &&
    typeof e.capturedAt === 'number' &&
    Number.isFinite(e.capturedAt)
  );
}

/**
 * Drop anything unrecognisable, dedupe by mediaId (last write wins), and trim
 * to the cap oldest-first. Pure — the JSON survives app updates, and one entry
 * from an older build must never take down a restore.
 */
export function normalizeJournal(
  raw: unknown,
  max: number = JOURNAL_MAX_ENTRIES,
): CaptureJournalEntry[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, CaptureJournalEntry>();
  for (const value of raw) {
    if (isEntry(value)) byId.set(value.mediaId, { ...value, cacheUri: value.cacheUri ?? null });
  }
  const entries = [...byId.values()].sort((a, b) => a.capturedAt - b.capturedAt);
  return entries.length <= max ? entries : entries.slice(entries.length - max);
}

/** Entries for one walk of one owner, oldest first. */
export function entriesForWalk(
  entries: readonly CaptureJournalEntry[],
  ownerId: string,
  walkStartedAt: number,
): CaptureJournalEntry[] {
  return entries.filter((e) => e.ownerId === ownerId && e.walkStartedAt === walkStartedAt);
}

/** A saved walk as recovery sees it. */
export interface SavedWalkRef {
  id: string;
  startedAt: number;
}

/**
 * The saved walk a journal entry belongs to, or null.
 *
 * Matched on start time within START_MATCH_TOLERANCE_MS — the row's
 * `started_at` is written from the same millisecond as the record's
 * `startedAt`, so the tolerance only absorbs serialisation, never two walks.
 * When two candidates fit, the closer one wins.
 */
export function matchJournalToWalk(
  entry: CaptureJournalEntry,
  walks: readonly SavedWalkRef[],
): SavedWalkRef | null {
  let best: SavedWalkRef | null = null;
  let bestGap = Infinity;
  for (const walk of walks) {
    const gap = Math.abs(walk.startedAt - entry.walkStartedAt);
    if (gap <= START_MATCH_TOLERANCE_MS && gap < bestGap) {
      best = walk;
      bestGap = gap;
    }
  }
  return best;
}

/** The outbox entry that writes this journal entry's row against a saved walk. */
export function journalToOutboxEntry(
  entry: CaptureJournalEntry,
  walkSessionId: string,
  now: number = Date.now(),
): KeepsakeOutboxEntry {
  return {
    id: `j-${entry.mediaId}`,
    mediaId: entry.mediaId,
    ownerId: entry.ownerId,
    petId: entry.petId,
    walkSessionId,
    capturedAt: entry.capturedAt,
    lat: entry.lat,
    lng: entry.lng,
    routeIndex: entry.routeIndex,
    elapsedS: entry.elapsedS,
    mediaType: 'photo',
    source: entry.source,
    localPath: entry.localPath,
    localAssetId: null,
    width: entry.width,
    height: entry.height,
    placeKey: entry.placeKey,
    attempts: 0,
    queuedAt: now,
  };
}

/** Filenames the storage sweep must not touch while they sit here. */
export function journalLocalPaths(entries: readonly CaptureJournalEntry[]): string[] {
  return entries.flatMap((e) => (e.localPath ? [e.localPath] : []));
}

// ── Storage ────────────────────────────────────────────────────────────────

export async function readJournal(): Promise<CaptureJournalEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? normalizeJournal(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

async function writeJournal(entries: readonly CaptureJournalEntry[]): Promise<void> {
  try {
    if (entries.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeJournal(entries)));
  } catch {
    // A journal we could not write retries from whatever is already on disk.
  }
}

/**
 * Serialise every read-modify-write. Captures arrive faster than AsyncStorage
 * round-trips (burst shots), and two interleaved appends would each read the
 * old list and the second write would erase the first photo.
 */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

/** Record a capture. Safe to call twice for the same mediaId. */
export function appendJournal(entry: CaptureJournalEntry): Promise<void> {
  return serial(async () => {
    const existing = await readJournal();
    await writeJournal([...existing.filter((e) => e.mediaId !== entry.mediaId), entry]);
  });
}

/** Forget entries whose rows now exist (or that moved to the outbox). */
export function removeFromJournal(mediaIds: readonly string[]): Promise<void> {
  if (mediaIds.length === 0) return Promise.resolve();
  const gone = new Set(mediaIds);
  return serial(async () => {
    const existing = await readJournal();
    const kept = existing.filter((e) => !gone.has(e.mediaId));
    if (kept.length !== existing.length) await writeJournal(kept);
  });
}

/** Forget every entry of one walk — the walk was discarded with its photos. */
export function removeWalkFromJournal(ownerId: string, walkStartedAt: number): Promise<void> {
  return serial(async () => {
    const existing = await readJournal();
    const kept = existing.filter(
      (e) => !(e.ownerId === ownerId && e.walkStartedAt === walkStartedAt),
    );
    if (kept.length !== existing.length) await writeJournal(kept);
  });
}

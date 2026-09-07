/**
 * keepsakeOutbox — the queue that makes "kept" true when the network says no.
 *
 * ── The hole this fills ──
 * The camera tells you the photo is part of the walk the instant the shutter
 * fires, and until this module existed that was a promise the app could not
 * keep. `insertKeepsake` returning null — offline, a dropped fix, a slow RLS
 * round trip — used to drop the capture on the floor: the flush emptied its
 * queue before awaiting the write, so there was nothing left to retry with and
 * nothing to tell the owner. The photograph itself survived in the container,
 * but with no row pointing at it, so no surface could ever find it again and
 * the storage sweep counted it as garbage.
 *
 * A walk is exactly the moment a phone has no signal. This is the ordinary
 * case, not the edge one.
 *
 * ── What is queued, and what is not ──
 * Metadata only. The photograph is already durable in the app container
 * (keepsakeFile.ts) before anything reaches this module, so an entry holds the
 * FILENAME and nothing heavier — the renderable uri is derived at drain time
 * via `keepsakeFileUri`. Storing a uri would be the same bug keepsakeFile.ts
 * documents at length: iOS regenerates the container UUID on update, so a path
 * written today is dangling after the next release.
 *
 * A queued entry's file is therefore the only copy of that photograph in
 * existence. `outboxLocalPaths` exists so the caller can hand those names to
 * `sweepKeepsakeFiles` as protected — the same exemption keepsakeBudget.ts
 * already grants a keepsake whose thumbnail has not uploaded.
 *
 * ── Contract ──
 * Best-effort, like every other module here: nothing throws, every failure
 * resolves to the safe value. A drain that cannot reach the network leaves the
 * queue exactly as it found it and tries again next walk.
 *
 * ── Why the network and the filesystem arrive as arguments ──
 * So this is testable. keepsakeSync pulls in supabase and keepsakeFile pulls in
 * expo-file-system, neither of which exists under the `lib` suite's node
 * environment — which is why neither of those modules has a test. Taking them
 * as ports keeps the one piece with actual decisions in it (what to retry, what
 * to drop, what the sweep may not touch) inside the tested half, the same split
 * keepsake.ts describes for this whole directory.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  KeepsakeInsertInput,
  KeepsakeMediaType,
  KeepsakeSource,
} from './keepsake';

const STORAGE_KEY = 'pawtchi.walk.keepsakeOutbox.v1';

/**
 * How many unsent keepsakes to hold.
 *
 * Well past any plausible backlog — a fortnight of daily walks with a couple of
 * moments each, all offline — and small enough that a corrupted or runaway
 * queue cannot grow without bound. Overflow drops the OLDEST, matching
 * keepsakeBudget.ts: recency is the best proxy for the photo someone is about
 * to go looking for.
 */
export const OUTBOX_MAX_ENTRIES = 100;

/** One keepsake that has been captured but not yet written to the database. */
export interface KeepsakeOutboxEntry {
  /** Client-side id. Dedupes a re-enqueue of an entry already in the queue. */
  id: string;
  ownerId: string;
  petId: string;
  walkSessionId: string;
  capturedAt: number;
  lat: number | null;
  lng: number | null;
  routeIndex: number | null;
  elapsedS: number | null;
  mediaType: KeepsakeMediaType;
  source: KeepsakeSource;
  /** Bare filename in the app container. Never a path — see the module header. */
  localPath: string | null;
  localAssetId: string | null;
  width: number | null;
  height: number | null;
  placeKey: string | null;
  /** How many drains have tried this entry. Kept for logging, never a limit. */
  attempts: number;
  queuedAt: number;
}

/** A name no other queued entry will take. Same shape as newFileName. */
export function newOutboxId(capturedAt: number): string {
  return `${capturedAt}-${Math.random().toString(36).slice(2, 10)}`;
}

function isEntry(value: unknown): value is KeepsakeOutboxEntry {
  if (!value || typeof value !== 'object') return false;
  const e = value as Partial<KeepsakeOutboxEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.ownerId === 'string' &&
    typeof e.petId === 'string' &&
    typeof e.walkSessionId === 'string' &&
    typeof e.capturedAt === 'number' &&
    Number.isFinite(e.capturedAt)
  );
}

/**
 * Trim to the cap, oldest first, and drop anything unrecognisable.
 *
 * Pure, so the policy is testable without a storage layer. Shape validation is
 * not paranoia: this is JSON that survives app updates, and one entry written
 * by an older build must never be able to take down a drain.
 */
export function normalizeOutbox(
  raw: unknown,
  max: number = OUTBOX_MAX_ENTRIES,
): KeepsakeOutboxEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries = raw.filter(isEntry).map((e) => ({ ...e, attempts: e.attempts ?? 0 }));
  if (entries.length <= max) return entries;
  return entries.sort((a, b) => a.capturedAt - b.capturedAt).slice(entries.length - max);
}

export async function readOutbox(): Promise<KeepsakeOutboxEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeOutbox(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function writeOutbox(entries: readonly KeepsakeOutboxEntry[]): Promise<void> {
  try {
    if (entries.length === 0) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      return;
    }
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeOutbox(entries)));
  } catch {
    // A queue we could not write is a queue that retries from whatever is on
    // disk. Nothing here is worth failing a walk over.
  }
}

/** Add entries, replacing any already queued under the same id. */
export async function enqueueOutbox(
  entries: readonly KeepsakeOutboxEntry[],
): Promise<void> {
  if (entries.length === 0) return;
  const existing = await readOutbox();
  const incoming = new Set(entries.map((e) => e.id));
  await writeOutbox([...existing.filter((e) => !incoming.has(e.id)), ...entries]);
}

/**
 * Filenames the storage sweep must not touch.
 *
 * For a queued entry the container file is the only copy anywhere — there is no
 * thumbnail yet and no row to hang one on. Evicting one would be the single way
 * this feature could actually destroy a photograph.
 */
export function outboxLocalPaths(entries: readonly KeepsakeOutboxEntry[]): string[] {
  return entries.flatMap((e) => (e.localPath ? [e.localPath] : []));
}

/** Everything a drain needs. Supplied by the caller — see the module header. */
export interface OutboxPorts {
  /** keepsakeSync.insertKeepsake. Null means "not written", never "give up". */
  insert: (input: KeepsakeInsertInput) => Promise<{ id: string } | null>;
  /** keepsakeThumbnail.uploadThumbnail. Returns the storage path, or null. */
  upload: (input: {
    ownerId: string;
    keepsakeId: string;
    uri: string;
    width?: number | null;
    height?: number | null;
  }) => Promise<string | null>;
  /** keepsakeSync.attachThumbnail. */
  attach: (keepsakeId: string, thumbPath: string) => Promise<boolean>;
  /** keepsakeFile.keepsakeFileUri — a stored filename to a renderable uri. */
  fileUri: (fileName: string | null | undefined) => string | null;
}

export interface DrainResult {
  /** Entries that reached the database and left the queue. */
  sent: number;
  /** Entries still queued, to try again next time. */
  kept: number;
}

/**
 * Try to write everything queued.
 *
 * The row is what matters; the thumbnail follows it and is allowed to fail
 * indefinitely, exactly as in the live flush path. So an entry leaves the queue
 * the moment its row exists — at that point the keepsake is discoverable, and
 * `fetchPendingThumbnails` is already the mechanism that finishes the job.
 *
 * An entry whose file has vanished (reinstall, a sweep from before it was
 * protected) is still written: the time, the place and the walk are real facts
 * about a real moment, and keepsakeResolve.ts renders that as context rather
 * than a gap.
 */
export async function drainOutbox(ports: OutboxPorts): Promise<DrainResult> {
  const { insert, upload, attach, fileUri } = ports;

  const queued = await readOutbox();
  if (queued.length === 0) return { sent: 0, kept: 0 };

  const remaining: KeepsakeOutboxEntry[] = [];
  let sent = 0;

  for (const entry of queued) {
    const stored = await insert({
      ownerId: entry.ownerId,
      petId: entry.petId,
      walkSessionId: entry.walkSessionId,
      capturedAt: entry.capturedAt,
      lat: entry.lat,
      lng: entry.lng,
      routeIndex: entry.routeIndex,
      elapsedS: entry.elapsedS,
      mediaType: entry.mediaType,
      source: entry.source,
      localPath: entry.localPath,
      localAssetId: entry.localAssetId,
      width: entry.width,
      height: entry.height,
      placeKey: entry.placeKey,
    });

    if (!stored) {
      remaining.push({ ...entry, attempts: entry.attempts + 1 });
      continue;
    }

    sent += 1;

    const uri = fileUri(entry.localPath);
    if (uri) {
      const path = await upload({
        ownerId: entry.ownerId,
        keepsakeId: stored.id,
        uri,
        width: entry.width,
        height: entry.height,
      });
      if (path) await attach(stored.id, path);
    }
  }

  await writeOutbox(remaining);
  return { sent, kept: remaining.length };
}

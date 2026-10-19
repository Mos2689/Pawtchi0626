/**
 * keepsakeRecovery — finish whatever a previous session could not.
 *
 * Runs at app level (hooks/useKeepsakeRecovery.ts) on launch and every return
 * to the foreground, not only when the walk screen mounts. Three jobs, in
 * order, each one feeding the next:
 *
 *   1. RESCUE — capture-journal entries whose walk has since saved are matched
 *      to that walk (captureJournal.matchJournalToWalk) and moved into the
 *      outbox. This is how a photo taken before the app was killed, or before
 *      the walk screen unmounted, finds its walk again.
 *   2. DRAIN — the outbox writes every queued row (keepsakeOutbox.drainOutbox).
 *   3. THUMBNAILS — rows that exist but never got a thumbnail are uploaded from
 *      the original still on this phone. Until this existed nothing ever
 *      retried them: the row was "written", so the outbox let go, and the
 *      phone's file stayed the only copy indefinitely.
 *
 * ── Never the wrong walk ──
 * An entry is attached only to a walk that started within the match tolerance
 * of the entry's own walk start. No match ⇒ the entry stays in the journal and
 * its file stays protected. Recovery may be late; it may not be wrong.
 *
 * The walk in progress (if any) is skipped: its hook owns those entries and
 * will flush them itself when the walk saves.
 *
 * ── Ports ──
 * Same split as the outbox: the decisions live here and are tested under node;
 * supabase, AsyncStorage and the filesystem arrive as arguments.
 */

import {
  journalToOutboxEntry,
  matchJournalToWalk,
  START_MATCH_TOLERANCE_MS,
  type CaptureJournalEntry,
} from './captureJournal';
import type { DrainResult, KeepsakeOutboxEntry } from './keepsakeOutbox';
import type { Keepsake } from './keepsake';

export interface RecoveryPorts {
  readJournal: () => Promise<CaptureJournalEntry[]>;
  removeFromJournal: (mediaIds: readonly string[]) => Promise<void>;
  enqueueOutbox: (entries: readonly KeepsakeOutboxEntry[]) => Promise<void>;
  drainOutbox: () => Promise<DrainResult>;
  /** The owner's saved walks starting inside the window; null = could not ask. */
  fetchWalkStarts: (ownerId: string, fromMs: number, toMs: number) => Promise<{ id: string; startedAt: number }[] | null>;
  /** The start of the walk being recorded right now, or null. */
  activeWalkStartedAt: () => Promise<number | null>;
  fetchPendingThumbnails: (ownerId: string) => Promise<Keepsake[]>;
  fileUri: (fileName: string | null | undefined) => string | null;
  upload: (input: { ownerId: string; keepsakeId: string; uri: string; width?: number | null; height?: number | null }) => Promise<string | null>;
  attach: (keepsakeId: string, thumbPath: string) => Promise<boolean>;
  now?: () => number;
}

export interface RecoveryResult {
  /** Journal entries moved to the outbox against their saved walk. */
  rescued: number;
  /** Journal entries no saved walk matched yet — kept. */
  unmatched: number;
  /** Outbox rows written this run. */
  sent: number;
  /** Outbox entries still queued. */
  queued: number;
  /** Thumbnails uploaded for rows that had none. */
  thumbsUploaded: number;
  /** Rows still without a thumbnail whose original this phone does not hold. */
  thumbsUnrecoverable: number;
}

/** Move journal entries whose walk has saved into the outbox. */
export async function rescueJournal(
  ports: RecoveryPorts,
  ownerId: string,
): Promise<{ rescued: number; unmatched: number }> {
  const all = (await ports.readJournal()).filter((e) => e.ownerId === ownerId);
  const active = await ports.activeWalkStartedAt();
  const candidates = all.filter((e) => e.walkStartedAt !== active);
  if (candidates.length === 0) return { rescued: 0, unmatched: 0 };

  const starts = candidates.map((e) => e.walkStartedAt);
  const walks = await ports.fetchWalkStarts(
    ownerId,
    Math.min(...starts) - START_MATCH_TOLERANCE_MS,
    Math.max(...starts) + START_MATCH_TOLERANCE_MS,
  );
  // Could not ask the server: leave everything exactly where it is.
  if (walks === null) return { rescued: 0, unmatched: candidates.length };

  const now = ports.now?.() ?? Date.now();
  const toQueue: KeepsakeOutboxEntry[] = [];
  for (const entry of candidates) {
    const walk = matchJournalToWalk(entry, walks);
    if (walk) toQueue.push(journalToOutboxEntry(entry, walk.id, now));
  }
  if (toQueue.length === 0) return { rescued: 0, unmatched: candidates.length };

  // Queue BEFORE forgetting: an interruption between the two leaves the photo
  // in both places (the outbox insert is idempotent), never in neither.
  await ports.enqueueOutbox(toQueue);
  await ports.removeFromJournal(toQueue.map((e) => e.mediaId as string));
  return { rescued: toQueue.length, unmatched: candidates.length - toQueue.length };
}

/** Upload thumbnails for rows that exist but never got one. */
export async function retryPendingThumbnails(
  ports: RecoveryPorts,
  ownerId: string,
): Promise<{ uploaded: number; unrecoverable: number }> {
  const pending = await ports.fetchPendingThumbnails(ownerId);
  let uploaded = 0;
  let unrecoverable = 0;
  for (const keepsake of pending) {
    const uri = ports.fileUri(keepsake.localPath);
    if (!uri) {
      unrecoverable += 1;
      continue;
    }
    const path = await ports.upload({
      ownerId,
      keepsakeId: keepsake.id,
      uri,
      width: keepsake.width,
      height: keepsake.height,
    });
    if (path && (await ports.attach(keepsake.id, path))) uploaded += 1;
  }
  return { uploaded, unrecoverable };
}

/** Rescue → drain → thumbnails. Never throws. */
export async function recoverKeepsakes(ports: RecoveryPorts, ownerId: string): Promise<RecoveryResult> {
  const result: RecoveryResult = { rescued: 0, unmatched: 0, sent: 0, queued: 0, thumbsUploaded: 0, thumbsUnrecoverable: 0 };
  try {
    Object.assign(result, await rescueJournal(ports, ownerId));
  } catch {
    // A rescue that fails leaves the journal as it was; next foreground retries.
  }
  try {
    const drained = await ports.drainOutbox();
    result.sent = drained.sent;
    result.queued = drained.kept;
  } catch {
    // Same: the outbox keeps its entries.
  }
  try {
    const thumbs = await retryPendingThumbnails(ports, ownerId);
    result.thumbsUploaded = thumbs.uploaded;
    result.thumbsUnrecoverable = thumbs.unrecoverable;
  } catch {
    // Thumbnails are allowed to wait.
  }
  return result;
}

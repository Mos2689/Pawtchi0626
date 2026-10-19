/**
 * keepsakeBackup — opt-in backup of full-size walk photos, and their restore.
 *
 * ── Upload ──
 * `backupPending` takes this owner's photos that have a phone copy and no
 * backup yet (oldest first, a few per run) and uploads the container file.
 * Runs from keepsake recovery on launch and foreground, only when the owner has
 * turned backup on — and turning it on backfills every photo already on the
 * phone, because the queue is simply "everything not backed up yet".
 *
 * A row whose phone file is gone is counted, not retried: there is nothing left
 * on this phone to back up.
 *
 * ── Restore ──
 * Lazy, per photo, when a surface wants the full image and the phone has no
 * copy (keepsakeImage → `rehydrateFromBackup`). It downloads into the container
 * under the row's own filename where possible, so the next view is local and
 * free. No bulk download: a new phone fills in as the owner looks back.
 *
 * ── Ports ──
 * The upload decisions are tested under node; storage and the database arrive
 * as arguments (keepsakeBackupPorts.ts), the same split as the outbox.
 */

export interface BackupPorts {
  fetchNeedingBackup: (ownerId: string, limit: number) => Promise<{ id: string; localPath: string }[] | null>;
  fileUri: (fileName: string | null | undefined) => string | null;
  uploadOriginal: (input: { ownerId: string; keepsakeId: string; uri: string }) => Promise<string | null>;
  markBackedUp: (keepsakeId: string, path: string) => Promise<boolean>;
}

export interface BackupResult {
  uploaded: number;
  failed: number;
  /** Rows whose phone copy is gone — nothing left here to back up. */
  missing: number;
}

/** How many photos one run backs up. Small: runs repeat on every foreground. */
export const BACKUP_BATCH = 10;

export async function backupPending(
  ports: BackupPorts,
  ownerId: string,
  limit: number = BACKUP_BATCH,
): Promise<BackupResult> {
  const result: BackupResult = { uploaded: 0, failed: 0, missing: 0 };
  const rows = await ports.fetchNeedingBackup(ownerId, limit);
  if (!rows) return result;
  for (const row of rows) {
    const uri = ports.fileUri(row.localPath);
    if (!uri) {
      result.missing += 1;
      continue;
    }
    const path = await ports.uploadOriginal({ ownerId, keepsakeId: row.id, uri });
    if (path && (await ports.markBackedUp(row.id, path))) result.uploaded += 1;
    else result.failed += 1;
  }
  return result;
}

export interface RestorePorts {
  fetchOriginalPath: (keepsakeId: string) => Promise<string | null>;
  signedUrl: (path: string) => Promise<string | null>;
  /** Download into the container; returns the stored filename + uri, or null. */
  download: (url: string, preferredName: string | null) => Promise<{ fileName: string; uri: string } | null>;
  updateLocalPath: (keepsakeId: string, fileName: string) => Promise<boolean>;
}

/**
 * Bring a backed-up photo back onto this phone. Returns a renderable uri, or
 * null when there is no backup (or it cannot be reached right now).
 */
export async function rehydrateFromBackup(
  ports: RestorePorts,
  keepsake: { id: string; localPath: string | null },
): Promise<string | null> {
  try {
    const path = await ports.fetchOriginalPath(keepsake.id);
    if (!path) return null;
    const url = await ports.signedUrl(path);
    if (!url) return null;
    const stored = await ports.download(url, keepsake.localPath);
    if (!stored) return null;
    // Only when the file landed under a NEW name does the row need to learn it;
    // re-using the row's own filename keeps every other device's view intact.
    if (stored.fileName !== keepsake.localPath) await ports.updateLocalPath(keepsake.id, stored.fileName);
    return stored.uri;
  } catch {
    return null;
  }
}

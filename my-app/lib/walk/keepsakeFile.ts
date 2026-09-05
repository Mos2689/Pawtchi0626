/**
 * keepsakeFile — Pawtchi's own copy of a capture.
 *
 * ── Why this module exists ──
 * The walk camera used to hand its photo to the user's library and keep a
 * `ph://` receipt. Rendering then meant reading the photo library back, and
 * that is what made iOS put its "Would Like to Access Your Photos" sheet over
 * the Home screen at launch for anyone on limited access — a permission prompt
 * nobody asked for, about the most sentimental data on the phone.
 *
 * Instagram and Snapchat never do this, and the reason is structural rather
 * than clever: their capture lives in their own app container. An app may read
 * its own container without permission on either platform, forever. So does
 * this one now.
 *
 * ── What that buys, beyond the prompt ──
 *   * Android sees originals at all. READ_MEDIA_IMAGES stays blocked (see
 *     ALWAYS_BLOCKED_MEDIA_PERMISSIONS in app.config.ts), and for the first
 *     time that costs nothing.
 *   * The copy survives a device migration. `Documents/` is included in iCloud
 *     and Finder backups; `ph://` identifiers explicitly are not, which is the
 *     entire reason matchAssetForKeepsake had to be written.
 *   * The camera roll becomes a courtesy rather than a dependency, so declining
 *     it costs the user nothing.
 *
 * ── Two things here are easy to get wrong ──
 * 1. Store the FILENAME, never the path. iOS regenerates the app container
 *    UUID on update, so an absolute `file:///var/mobile/Containers/Data/
 *    Application/<UUID>/Documents/...` recorded today is dangling after the
 *    next release — a bug that would pass every test and appear only in the
 *    field, a week after shipping, as everyone's photos vanishing at once.
 * 2. `Documents/` is backed up and counts against the user's iCloud quota, so
 *    what goes in is downscaled and bounded. See keepsakeBudget.ts.
 *
 * ── Contract ──
 * Best-effort, like keepsakeThumbnail.ts: every failure resolves to null and
 * nothing throws. A capture that cannot be persisted still becomes a keepsake —
 * it just has no owned copy, which is precisely the state every keepsake
 * written before this module was in was born in.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import {
  planEviction,
  KEEPSAKE_BYTE_BUDGET,
  type StoredKeepsakeFile,
} from './keepsakeBudget';

/** Subdirectory of the document directory holding every stored capture. */
export const KEEPSAKE_DIR_NAME = 'keepsakes';

/**
 * Long edge of the stored copy, in pixels.
 *
 * Not the full sensor image. 2048 fills the largest surface a keepsake ever
 * reaches — a full-screen viewer on a 3x phone — with pixels to spare, at
 * roughly 400 KB against the 3 MB a 12 MP original costs. Keeping the raw
 * capture would spend seven times the user's storage to serve a detail no
 * screen in the app can display.
 *
 * The camera-roll copy is untouched and full-resolution: someone who wants the
 * original has it, in the place they would look for it.
 */
export const STORED_MAX_EDGE = 2048;

/** Tuned with STORED_MAX_EDGE to land a typical capture around 400 KB. */
export const STORED_QUALITY = 0.8;

/**
 * Filenames we are willing to open.
 *
 * `local_path` arrives from the database, and joining an unvalidated string to
 * a directory is how a `../../` walks out of the container. The names this
 * module writes are timestamp-and-random, so the restriction costs nothing.
 */
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

function isSafeName(name: string): boolean {
  return SAFE_NAME.test(name) && !name.includes('..');
}

/** The directory, created if absent. Null when the filesystem refuses. */
function keepsakeDirectory(): Directory | null {
  try {
    const dir = new Directory(Paths.document, KEEPSAKE_DIR_NAME);
    if (!dir.exists) dir.create({ intermediates: true });
    return dir;
  } catch {
    return null;
  }
}

/**
 * A name no other capture will take.
 *
 * Capture time first so the directory sorts chronologically when a human looks
 * at it during debugging; random suffix because two photos in the same
 * millisecond is not worth reasoning about.
 */
function newFileName(capturedAt: number): string {
  return `${capturedAt}-${Math.random().toString(36).slice(2, 10)}.jpg`;
}

export interface PersistedCapture {
  /** Bare filename — this is what goes in walk_media.local_path. */
  fileName: string;
  /** Absolute uri, valid for THIS app session only. Never persist it. */
  uri: string;
}

/**
 * Downscale a fresh capture into the app container.
 *
 * Takes the uri expo-camera just produced — which already lives in the app's
 * CACHE directory, a place iOS may empty whenever it likes. That is the whole
 * gap this closes: the file is already ours, it is simply somewhere temporary,
 * and until now we deleted our claim to it and kept a receipt for the copy we
 * gave away instead.
 */
export async function persistCapture(input: {
  uri: string;
  capturedAt: number;
  width?: number | null;
  height?: number | null;
}): Promise<PersistedCapture | null> {
  const dir = keepsakeDirectory();
  if (!dir) return null;

  try {
    const isPortrait =
      input.width != null && input.height != null ? input.height > input.width : false;
    const longEdge = Math.max(input.width ?? 0, input.height ?? 0);

    /**
     * Resize only when it would actually SHRINK the image.
     *
     * `{ height: STORED_MAX_EDGE }` is not a cap, it is an instruction — hand
     * it a 888×1920 capture and expo-image-manipulator dutifully scales the
     * long edge UP to 2048, producing a bigger file than the original carrying
     * no more detail than the original. Caught on a real device: the first
     * sandboxed capture came off the camera at 1920 tall, comfortably under the
     * ceiling, and was upscaled anyway.
     *
     * An empty action list still re-encodes at STORED_QUALITY, so a
     * small-enough capture is compressed without being stretched first.
     */
    const actions =
      longEdge > STORED_MAX_EDGE
        ? [{ resize: isPortrait ? { height: STORED_MAX_EDGE } : { width: STORED_MAX_EDGE } }]
        : [];

    const scaled = await manipulateAsync(input.uri, actions, {
      compress: STORED_QUALITY,
      format: SaveFormat.JPEG,
    });
    if (!scaled?.uri) return null;

    const fileName = newFileName(input.capturedAt);
    const destination = new File(dir, fileName);
    // Move rather than copy: the manipulator's output is a cache temp file with
    // no other reader, and copying would leave a second full-size image behind
    // for the OS to clear whenever it got around to it.
    new File(scaled.uri).move(destination);

    return destination.exists ? { fileName, uri: destination.uri } : null;
  } catch {
    return null;
  }
}

/**
 * Resolve a stored filename to something `<Image>` can load.
 *
 * Returns null when the file is not there, which is an ordinary outcome rather
 * than an error: the app was reinstalled, or the budget swept it. The caller
 * drops to the next rung of the ladder and the keepsake still opens.
 */
export function keepsakeFileUri(fileName: string | null | undefined): string | null {
  if (!fileName || !isSafeName(fileName)) return null;
  try {
    const file = new File(Paths.document, KEEPSAKE_DIR_NAME, fileName);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/** Remove one stored capture. Silent about a file that was already gone. */
export function deleteKeepsakeFile(fileName: string | null | undefined): void {
  if (!fileName || !isSafeName(fileName)) return;
  try {
    const file = new File(Paths.document, KEEPSAKE_DIR_NAME, fileName);
    if (file.exists) file.delete();
  } catch {
    // Best-effort: a file we failed to delete is a few hundred KB, and the
    // next sweep will try again.
  }
}

/** Bytes currently held. Zero when the directory does not exist yet. */
export function keepsakeBytesUsed(): number {
  return listStoredFiles().reduce((sum, file) => sum + file.size, 0);
}

function listStoredFiles(): StoredKeepsakeFile[] {
  const dir = keepsakeDirectory();
  if (!dir) return [];
  try {
    return dir.list().flatMap((entry) => {
      if (!(entry instanceof File)) return [];
      const size = entry.size ?? 0;
      // Fall back to the filename's timestamp prefix when the filesystem has no
      // opinion: it is the capture time by construction, and a file with no
      // date would otherwise sort as epoch zero and be evicted first.
      const stamped = Number.parseInt(entry.name.split('-')[0] ?? '', 10);
      const capturedAt =
        entry.creationTime ??
        entry.modificationTime ??
        (Number.isFinite(stamped) ? stamped : 0);
      return [{ name: entry.name, size, capturedAt }];
    });
  } catch {
    return [];
  }
}

/**
 * Bring stored captures back within budget.
 *
 * `protectedNames` must list every keepsake whose thumbnail has not uploaded
 * yet — for those the owned file is the ONLY copy in existence, and evicting
 * one is the single way this feature could destroy a photograph. The policy
 * itself lives in keepsakeBudget.ts, where it can be tested without a
 * filesystem; this function is only the hands.
 *
 * Returns the number of files removed, for logging and for tests of the caller.
 */
export function sweepKeepsakeFiles(
  protectedNames: readonly string[] = [],
  budgetBytes: number = KEEPSAKE_BYTE_BUDGET,
): number {
  const files = listStoredFiles();
  if (files.length === 0) return 0;

  const { evict } = planEviction(files, budgetBytes, protectedNames);
  for (const name of evict) deleteKeepsakeFile(name);
  return evict.length;
}

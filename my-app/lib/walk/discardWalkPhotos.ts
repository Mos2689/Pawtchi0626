/**
 * discardWalkPhotos — the on-phone half of discarding a walk that has photos.
 *
 * discardWalk.ts deletes the `walk_sessions` row and `walk_media` cascades with
 * it, so the photos' rows are already gone server-side. What remains on the
 * phone would otherwise linger forever: the container files (each the only
 * full-size copy), the capture-journal entries (which recovery would keep
 * trying to place), and any outbox entries (whose rows can no longer be
 * written). The owner was told in the confirmation that the photos go too
 * (app/walk.tsx), so all three go.
 *
 * Best-effort and called only AFTER discardWalk succeeded — a walk that was not
 * discarded must keep every photo it has.
 */

import { removeFromJournal } from './captureJournal';
import { dropOutboxForWalk } from './keepsakeOutbox';
import { deleteKeepsakeFile } from './keepsakeFile';

export async function discardWalkPhotos(input: {
  walkSessionId: string | null;
  photos: readonly { mediaId: string; localPath: string | null }[];
}): Promise<void> {
  try {
    await removeFromJournal(input.photos.map((p) => p.mediaId));
    if (input.walkSessionId) await dropOutboxForWalk(input.walkSessionId);
    for (const photo of input.photos) deleteKeepsakeFile(photo.localPath);
  } catch {
    // Leftovers cost disk, never a photo the owner chose to keep.
  }
}

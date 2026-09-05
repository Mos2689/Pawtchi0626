/**
 * How much of the user's phone Pawtchi's photo copies may occupy.
 *
 * ── Why there is a budget at all ──
 * Keeping our own copy of every capture is what removed the photo-library
 * permission from the render path (see keepsakeFile.ts), but it moves the
 * storage cost onto the device. Unbounded, a daily walker with a couple of
 * moments each time adds a few hundred megabytes a year to the app's size in
 * Settings — the number people look at right before they delete something.
 *
 * ── Why eviction is safe here and would not be elsewhere ──
 * Because the ladder already has a rung underneath. Deleting an owned file does
 * not delete a memory; it drops that keepsake from `original` to `thumbnail`,
 * which is exactly what happens today to anyone who cleared their camera roll,
 * and which keepsakeResolve.ts was written to handle. Eviction is therefore a
 * quality reduction on the oldest photos, not data loss.
 *
 * ── The one rule that is not about size ──
 * A capture whose thumbnail has not uploaded yet has NO rung underneath it. Its
 * file is the only copy that exists anywhere. Evicting one would be the single
 * way this feature could actually destroy a photograph, so those files are
 * exempt from the budget no matter how far over it we are. Running slightly
 * over budget is a number; losing a moment is a betrayal.
 *
 * Pure — no filesystem. keepsakeFile.ts supplies the listing and performs the
 * deletions.
 */

/**
 * Bytes of captures to keep on the device.
 *
 * 256 MB against the ~400 KB a stored capture costs after downscaling is
 * roughly 650 photographs — about two years for the daily walker the thumbnail
 * sizing was calculated against. Chosen to be large enough that ordinary use
 * never reaches it and small enough that Pawtchi never becomes the reason
 * someone goes looking for space to reclaim.
 */
export const KEEPSAKE_BYTE_BUDGET = 256 * 1024 * 1024;

export interface StoredKeepsakeFile {
  /** Bare filename, as stored in walk_media.local_path. */
  name: string;
  size: number;
  /** Capture time, ms since epoch. Oldest are evicted first. */
  capturedAt: number;
}

export interface EvictionPlan {
  /** Filenames to delete, oldest first. */
  evict: string[];
  /** Bytes still held after the plan runs, including the exempt files. */
  remainingBytes: number;
}

/**
 * Choose which stored captures to delete.
 *
 * Oldest-first, because recency is the best available proxy for the photo
 * someone is about to look at: the walk they just finished, the story that just
 * opened, the gallery page they land on. A two-year-old moment rendering from
 * its thumbnail is a memory that still opens; last Tuesday's doing so is a
 * feature that looks broken.
 *
 * Returns an empty plan when already within budget — callers can skip the
 * filesystem work entirely on the overwhelmingly common path.
 */
export function planEviction(
  files: readonly StoredKeepsakeFile[],
  budgetBytes: number = KEEPSAKE_BYTE_BUDGET,
  /** Files with no durable thumbnail yet. Never evicted — see the header. */
  protectedNames: readonly string[] = [],
): EvictionPlan {
  const total = files.reduce((sum, file) => sum + Math.max(0, file.size), 0);
  if (total <= budgetBytes) return { evict: [], remainingBytes: total };

  const exempt = new Set(protectedNames);
  const evictable = files
    .filter((file) => !exempt.has(file.name))
    .sort((a, b) => a.capturedAt - b.capturedAt);

  const evict: string[] = [];
  let remaining = total;
  for (const file of evictable) {
    if (remaining <= budgetBytes) break;
    evict.push(file.name);
    remaining -= Math.max(0, file.size);
  }

  // `remaining` can still exceed the budget when the exempt files alone do.
  // That is the intended outcome, not a failure to converge: those files have
  // no thumbnail behind them, so the alternative is destroying the only copy.
  return { evict, remainingBytes: remaining };
}

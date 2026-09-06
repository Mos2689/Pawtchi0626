/**
 * Thumbnails — the part of a keepsake that outlives the file.
 *
 * ── Why this is the only image Pawtchi ever stores ──
 * The original stays in the user's photo library, always. What syncs is this:
 * a ~20 KB long-edge-320 JPEG, roughly 1/150th the size of the photo it stands
 * for. At a walk a day with a couple of moments that is ~17 MB per user per
 * year rather than ~2.6 GB — the difference between a rounding error and a
 * media-storage business we have no intention of running.
 *
 * ── Why store anything at all ──
 * Because the archive is the product. Camera rolls get cleared, phones get
 * replaced, iCloud offloads originals. A dog's biography that develops holes
 * every time storage runs low is not a biography. The thumbnail is what lets a
 * walk from two phones ago still open with its moments intact.
 *
 * ── Contract ──
 * Best-effort, exactly like imagePrep.ts and attachScreenshot: every failure
 * resolves to null rather than throwing. A keepsake whose thumbnail has not
 * uploaded yet is completely usable from the local original — it just has not
 * become durable yet, and it will retry.
 */

import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../supabase';
import { KEEPSAKE_THUMB_BUCKET } from './keepsakeSync';

/**
 * Long edge of the stored thumbnail, in pixels.
 *
 * 320 is chosen against the largest surface a thumbnail ever has to fill — a
 * gallery tile and the small side of a then/now pair — not against a full
 * screen. Rendering the original is rung 1 of the ladder; this is the fallback,
 * and sizing it for a hero image would give away the cost advantage that makes
 * the whole architecture work.
 */
export const THUMB_MAX_EDGE = 320;

/** Quality tuned so a 320px frame lands around 20 KB. */
export const THUMB_QUALITY = 0.7;

/** `{ownerId}/{keepsakeId}.jpg` — the first segment is what storage RLS checks. */
export function thumbnailPath(ownerId: string, keepsakeId: string): string {
  return `${ownerId}/${keepsakeId}.jpg`;
}

/**
 * Shrink a local image to thumbnail size. Returns the new local uri, or null.
 *
 * Resizes on the longest edge so portrait and landscape both land within
 * budget; expo-image-manipulator preserves aspect ratio when only one
 * dimension is given.
 */
export async function makeThumbnail(
  uri: string,
  width?: number | null,
  height?: number | null,
): Promise<string | null> {
  try {
    const isPortrait = width != null && height != null ? height > width : false;
    const resize = isPortrait ? { height: THUMB_MAX_EDGE } : { width: THUMB_MAX_EDGE };

    const result = await manipulateAsync(uri, [{ resize }], {
      compress: THUMB_QUALITY,
      format: SaveFormat.JPEG,
    });
    return result.uri ?? null;
  } catch {
    return null;
  }
}

/**
 * Generate and upload a keepsake's thumbnail. Returns the storage path, or null.
 *
 * `upsert` is on so a retry after a partially-failed sync overwrites rather
 * than colliding — the path is derived from the keepsake id, so the same
 * keepsake always owns the same object.
 */
export async function uploadThumbnail(input: {
  ownerId: string;
  keepsakeId: string;
  uri: string;
  width?: number | null;
  height?: number | null;
}): Promise<string | null> {
  const thumbUri = await makeThumbnail(input.uri, input.width, input.height);
  if (!thumbUri) return null;

  try {
    const path = thumbnailPath(input.ownerId, input.keepsakeId);

    // React Native has no File/Blob for a local uri, so the multipart form is
    // assembled by hand — the same approach lib/support/supportTickets.ts and
    // the avatar upload in app/(tabs)/profile.tsx use.
    const form = new FormData();
    form.append('file', {
      uri: thumbUri,
      name: `${input.keepsakeId}.jpg`,
      type: 'image/jpeg',
    } as unknown as Blob);

    const { error } = await supabase.storage
      .from(KEEPSAKE_THUMB_BUCKET)
      .upload(path, form, { contentType: 'image/jpeg', upsert: true });

    return error ? null : path;
  } catch {
    return null;
  }
}

/**
 * A signed URL for rendering a stored thumbnail.
 *
 * The bucket is private — these are photographs of people's homes, streets and
 * families, and a public bucket would make every one of them guessable by id.
 * One hour is far longer than any render needs and short enough that a leaked
 * link is worthless.
 */
export const THUMB_URL_TTL_S = 3600;

export async function thumbnailUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(KEEPSAKE_THUMB_BUCKET)
      .createSignedUrl(path, THUMB_URL_TTL_S);
    return error ? null : data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Sign a whole screen's worth of thumbnails at once.
 *
 * `thumbnailUrl` above is one round trip per photograph, which is the right
 * shape for a viewer looking at one image and the wrong shape for a map. The
 * gallery map holds the entire archive: thirty pins on screen would be thirty
 * requests, and every pan re-clusters and remounts them, so it would be thirty
 * more. Storage will sign a batch in a single call, so it should.
 *
 * Returns a path → url map with the failures simply absent. A partial answer is
 * the useful one: nineteen pins that render and one that falls back to context
 * is a working map, whereas failing the batch would blank the screen because one
 * object was missing.
 */
export async function thumbnailUrls(
  paths: readonly string[],
): Promise<Record<string, string>> {
  const wanted = [...new Set(paths.filter((p) => p.length > 0))];
  if (wanted.length === 0) return {};

  try {
    const { data, error } = await supabase.storage
      .from(KEEPSAKE_THUMB_BUCKET)
      .createSignedUrls(wanted, THUMB_URL_TTL_S);
    if (error || !data) return {};

    const urls: Record<string, string> = {};
    for (const row of data) {
      // Each entry carries its own error, so one missing object does not spoil
      // the rest of the batch.
      if (row?.path && row.signedUrl) urls[row.path] = row.signedUrl;
    }
    return urls;
  } catch {
    return {};
  }
}

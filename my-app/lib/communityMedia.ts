import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

import type { PendingCapture } from '../hooks/useWalkKeepsakes';
import { supabase } from './supabase';

export const COMMUNITY_MEDIA_BUCKET = 'community-walk-media';
const DISPLAY_LONG_EDGE = 1440;
const DISPLAY_QUALITY = 0.78;

async function displayCopy(capture: PendingCapture): Promise<string | null> {
  try {
    const portrait = (capture.height ?? 0) > (capture.width ?? 0);
    const longest = Math.max(capture.width ?? 0, capture.height ?? 0);
    const actions = longest > DISPLAY_LONG_EDGE
      ? [{ resize: portrait ? { height: DISPLAY_LONG_EDGE } : { width: DISPLAY_LONG_EDGE } }]
      : [];
    const result = await manipulateAsync(capture.uri, actions, {
      compress: DISPLAY_QUALITY,
      format: SaveFormat.JPEG,
    });
    return result.uri ?? null;
  } catch {
    return null;
  }
}

/**
 * ── What used to be here, and the bug it was ───────────────────────────────
 *
 * `readMediaRows` polled `walk_media` for rows the outbox was writing, then
 * `matchMediaRow` paired each capture to a row by timestamp within 1500 ms.
 * Both are gone, and so is the failure they caused.
 *
 * The poll returned the instant the FIRST row landed:
 *
 *     if (data?.length) return data;
 *
 * The outbox writes those rows one at a time — each is an upload — so the poll
 * almost always came back holding exactly one. Every later capture then found
 * no row within tolerance, hit `continue`, and was dropped without a word.
 *
 * It was not a race. Measured across every trail walk in production — 8 walks,
 * 14 photos — the first shot published every single time and the second and
 * third never did. 2→1, 2→1, 3→1.
 *
 * Nothing here waits on `walk_media` any more: a capture arrives already
 * knowing its own row id (see PendingCapture.mediaId), so there is nothing to
 * look up and nothing to match.
 */

/**
 * The captures a walk is allowed to publish: the ones whose shutter was pressed
 * while the camera said "Shared with this walk", and no others. Personal-only
 * is the default the moment there is any doubt — an absent time is not a
 * consent, so it is not published.
 */
export function selectSharedCaptures<T extends { capturedAt: number }>(
  captures: readonly T[],
  sharedCaptureTimes: ReadonlySet<number>,
): T[] {
  return captures.filter(capture => sharedCaptureTimes.has(capture.capturedAt));
}

/**
 * What the finish-time sweep still has to publish: shared at the shutter, and
 * not already CONFIRMED on the server.
 *
 * The sweep used to run over every shared capture again, on the premise that
 * the upsert made repeats free. The upsert makes them harmless, not free: each
 * repeat re-resized the photo, re-uploaded it (~180 KB) and re-wrote its row —
 * N uploads, at the moment the phone is busiest (external audit, 2026-09-26).
 *
 * Only a confirmed success is skipped. Anything that failed, or never started,
 * is still swept — the sweep is the only retry for a photo taken without signal.
 */
export function capturesToSweep<T extends { capturedAt: number; mediaId?: string }>(
  captures: readonly T[],
  sharedCaptureTimes: ReadonlySet<number>,
  alreadyPublished: ReadonlySet<string> = new Set(),
): T[] {
  return selectSharedCaptures(captures, sharedCaptureTimes)
    .filter(capture => !capture.mediaId || !alreadyPublished.has(capture.mediaId));
}

export interface PublishTarget {
  communityWalkId: string;
  contributorId: string;
  dogId: string;
}

/**
 * Put one photo on the trail, now.
 *
 * Called as the shutter fires, so the pack sees each other's photos during the
 * walk rather than all at once when it ends. Idempotent by construction: the
 * row is keyed on the capture's own `mediaId`, and `onConflict` makes a repeat
 * a no-op rather than a duplicate — which is what lets the end-of-walk sweep
 * below re-run over everything without checking what already landed.
 *
 * Returns whether the row reached the server. Never throws: a photo that could
 * not be shared is still a photo, still on this phone, and still the owner's
 * own keepsake. The caller's job is to leave the draft alone and let the sweep
 * try again.
 */
export async function publishOneCapture(
  capture: PendingCapture,
  target: PublishTarget,
): Promise<boolean> {
  try {
    const mediaId = capture.mediaId;
    if (!mediaId) return false;

    // Uploaded before the row is written, so a row never promises an image
    // that is not there. A failed upload still publishes the moment — where
    // and when it happened is true either way, and the display copy can be
    // filled in by a later sweep.
    const path = `${target.communityWalkId}/${target.contributorId}/${mediaId}.jpg`;
    const uri = await displayCopy(capture);
    let uploadedPath: string | null = null;
    if (uri) {
      try {
        const form = new FormData();
        form.append('file', { uri, name: `${mediaId}.jpg`, type: 'image/jpeg' } as unknown as Blob);
        const { error } = await supabase.storage
          .from(COMMUNITY_MEDIA_BUCKET)
          .upload(path, form, { contentType: 'image/jpeg', upsert: true });
        if (!error) uploadedPath = path;
      } catch {
        // The metadata below is still a truthful moment and may be retried.
      }
    }

    const { error } = await supabase.from('community_shared_media').upsert({
      walk_id: target.communityWalkId,
      contributor_id: target.contributorId,
      walk_media_id: mediaId,
      dog_ids: [target.dogId],
      display_path: uploadedPath,
      captured_at: new Date(capture.capturedAt).toISOString(),
      capture_lat: capture.lat,
      capture_lng: capture.lng,
      external_share_allowed: false,
    }, { onConflict: 'walk_media_id' });
    if (error) return false;
    // The row alone is not "published" when the picture did not go up with it.
    // Reporting success here marked the photo done, so nothing ever retried
    // the upload and it sat as "This photo is still arriving" for good. False
    // sends it back round: the live publisher and the finish-time sweep both
    // retry, and the upsert makes a second row impossible. A capture we could
    // not make a display copy of has no picture to send, so that stays done.
    return uri === null || uploadedPath !== null;
  } catch {
    return false;
  }
}

/**
 * The sweep at the end of the walk — a backstop, no longer the main path.
 *
 * Every shared capture is published as it is taken. This runs over the whole
 * set once more when the walk saves, which costs nothing for photos that
 * already landed (the upsert is keyed on an id that has not changed) and
 * rescues the ones that did not: the shot taken in a tunnel, or on the walk
 * where the signal went at minute three.
 *
 * Publishes only captures that were explicitly in Shared mode at shutter time.
 * Best-effort throughout: failure never changes or removes the personal
 * keepsake, which is the owner's regardless of what the pack ever sees.
 */
export async function publishCommunityCaptures(input: {
  communityWalkId: string;
  contributorId: string;
  dogId: string;
  captures: PendingCapture[];
  sharedCaptureTimes: Set<number>;
  /** Media ids the live publisher has already confirmed — see capturesToSweep. */
  alreadyPublished?: ReadonlySet<string>;
}): Promise<void> {
  const wanted = capturesToSweep(input.captures, input.sharedCaptureTimes, input.alreadyPublished);
  if (!wanted.length) return;

  const target: PublishTarget = {
    communityWalkId: input.communityWalkId,
    contributorId: input.contributorId,
    dogId: input.dogId,
  };
  // Sequential, not Promise.all: this runs while a walk is finishing and the
  // summary is being written, and firing every upload at once is how the one
  // moment the owner is watching gets slower.
  for (const capture of wanted) await publishOneCapture(capture, target);
}

/**
 * How long a signed photo URL stays usable.
 *
 * This was sixty seconds, which is shorter than people look at a screen. The
 * URLs are minted once when a memory or the Trails list loads, and the images
 * below the fold are not requested until somebody scrolls to them — so a minute
 * of reading, or one slow connection, and the rest of the walk's photos simply
 * never appeared. Silently: an expired signature is a 403, and a 403 renders as
 * an empty rectangle rather than an error anyone could report.
 *
 * An hour comfortably outlives any single visit to these screens, and outlives
 * the five-minute snapshot cache that can re-serve a list without re-signing.
 *
 * The trade is deliberate and bounded: these are pet photos in a private
 * bucket, each URL is scoped to one object, and it is only as reachable as the
 * device it was minted on. Nothing here is a capability over the account.
 */
const SIGNED_URL_TTL_S = 60 * 60;

/**
 * Signed URLs already minted, by storage path.
 *
 * ── Why the STRING has to be stable, not just valid ────────────────────────
 *
 * Every call to `createSignedUrls` returns a different string for the same
 * object — a fresh token and a fresh expiry. `expo-image` keys its cache on the
 * URL, so a new string is a new image: the photo is downloaded again, decoded
 * again, and the one already on screen is replaced by an identical one.
 *
 * That made re-signing far more expensive than the round trip it cost. The
 * memory reel re-signed every moment on each focus; the live map re-signed on
 * EVERY realtime event, which is every attendance change and every photo anyone
 * on the walk shares. A six-person walk could re-download the same set of
 * pictures dozens of times over.
 *
 * Holding the URLs makes the string stable, so the second load hands `expo-image`
 * exactly what it already has and nothing moves.
 *
 * ── In memory, and that is the right lifetime ──────────────────────────────
 *
 * Not persisted: a signature that outlives the process would be restored after
 * it had expired, and the point of this is to avoid 403s rendering as blank
 * rectangles. Cleared on sign-out with the rest of the previous account's state,
 * for the same reason the snapshot cache is.
 */
const signedUrls = new Map<string, { url: string; expiresAt: number }>();

/**
 * Re-sign with ten minutes to spare.
 *
 * A URL handed out at 59 minutes is valid when it is returned and expired by the
 * time somebody scrolls to it, which is the exact failure the hour-long TTL was
 * raised to fix. The margin has to exceed how long a screen may sit open after
 * its last fetch.
 */
const RESIGN_MARGIN_MS = 10 * 60_000;

/**
 * Hard ceiling on held URLs (perf audit E5). Past it, expired signatures —
 * useless anyway — go first, then the oldest. Far above any one screen's
 * photos; evicting only means a URL is signed again when next needed.
 */
export const MAX_SIGNED_URLS = 500;

function pruneSignedUrls(now: number): void {
  if (signedUrls.size <= MAX_SIGNED_URLS) return;
  for (const [path, held] of signedUrls) {
    if (held.expiresAt <= now) signedUrls.delete(path);
  }
  while (signedUrls.size > MAX_SIGNED_URLS) {
    const oldest = signedUrls.keys().next().value;
    if (oldest === undefined) break;
    signedUrls.delete(oldest);
  }
}

export async function communityMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};

  const now = Date.now();
  const out: Record<string, string> = {};
  const misses: string[] = [];
  for (const path of unique) {
    const held = signedUrls.get(path);
    if (held && held.expiresAt - RESIGN_MARGIN_MS > now) out[path] = held.url;
    else misses.push(path);
  }
  // Every path already held: no Storage round trip at all, which is the common
  // case for a reload of a screen that has not gained a photo.
  if (!misses.length) return out;

  const { data, error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .createSignedUrls(misses, SIGNED_URL_TTL_S);
  // A failed signing still returns what was already held. Some pictures beats
  // none, and it matches what this did before: never throw, just answer with
  // whatever could be resolved.
  if (error || !data) return out;

  const expiresAt = now + SIGNED_URL_TTL_S * 1000;
  for (const row of data) {
    if (!row.path || !row.signedUrl) continue;
    // Re-inserting moves the path to the end, so Map order is signing order.
    signedUrls.delete(row.path);
    signedUrls.set(row.path, { url: row.signedUrl, expiresAt });
    out[row.path] = row.signedUrl;
  }
  pruneSignedUrls(now);
  return out;
}

/** Dropped on sign-out, with the rest of the previous account's state. */
export function clearCommunityMediaUrls(): void {
  signedUrls.clear();
}

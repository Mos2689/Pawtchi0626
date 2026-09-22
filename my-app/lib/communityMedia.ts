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

async function readMediaRows(walkSessionId: string): Promise<any[]> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data } = await supabase
      .from('walk_media')
      .select('id, captured_at, lat, lng')
      .eq('walk_session_id', walkSessionId);
    if (data?.length) return data;
    await new Promise(resolve => setTimeout(resolve, 450 * (attempt + 1)));
  }
  return [];
}

/**
 * How far apart the device's shutter time and the server's stored time may be
 * and still describe the same photo. Generous enough for clock skew and the
 * upload round trip, tight enough that two shots cannot claim each other.
 */
export const CAPTURE_MATCH_TOLERANCE_MS = 1500;

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
 * Pair a local capture with the walk_media row the outbox wrote for it. Nothing
 * is invented: with no row within tolerance the moment is simply not published,
 * which keeps authorship attached to a real, persisted photo.
 */
export function matchMediaRow<T extends { captured_at: string }>(
  rows: readonly T[],
  capturedAt: number,
): T | null {
  let best: T | null = null;
  let bestDistance = CAPTURE_MATCH_TOLERANCE_MS;
  for (const row of rows) {
    const serverMs = Date.parse(row.captured_at);
    if (!Number.isFinite(serverMs)) continue;
    const distance = Math.abs(serverMs - capturedAt);
    if (distance < bestDistance) {
      best = row;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Publish only captures that were explicitly in Shared mode at shutter time.
 * This is best-effort: failure never changes or removes the personal keepsake.
 */
export async function publishCommunityCaptures(input: {
  communityWalkId: string;
  personalWalkId: string;
  contributorId: string;
  dogId: string;
  captures: PendingCapture[];
  sharedCaptureTimes: Set<number>;
}): Promise<void> {
  const wanted = selectSharedCaptures(input.captures, input.sharedCaptureTimes);
  if (!wanted.length) return;
  const mediaRows = await readMediaRows(input.personalWalkId);

  for (const capture of wanted) {
    const row = matchMediaRow(mediaRows, capture.capturedAt);
    if (!row) continue;

    const path = `${input.communityWalkId}/${input.contributorId}/${row.id}.jpg`;
    const uri = await displayCopy(capture);
    let uploadedPath: string | null = null;
    if (uri) {
      try {
        const form = new FormData();
        form.append('file', { uri, name: `${row.id}.jpg`, type: 'image/jpeg' } as unknown as Blob);
        const { error } = await supabase.storage
          .from(COMMUNITY_MEDIA_BUCKET)
          .upload(path, form, { contentType: 'image/jpeg', upsert: true });
        if (!error) uploadedPath = path;
      } catch {
        // The metadata below is still a truthful moment and may be retried.
      }
    }

    await supabase.from('community_shared_media').upsert({
      walk_id: input.communityWalkId,
      contributor_id: input.contributorId,
      walk_media_id: row.id,
      dog_ids: [input.dogId],
      display_path: uploadedPath,
      captured_at: new Date(capture.capturedAt).toISOString(),
      capture_lat: capture.lat,
      capture_lng: capture.lng,
      external_share_allowed: false,
    }, { onConflict: 'walk_media_id' });
  }
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

export async function communityMediaUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return {};
  const { data, error } = await supabase.storage
    .from(COMMUNITY_MEDIA_BUCKET)
    .createSignedUrls(unique, SIGNED_URL_TTL_S);
  if (error || !data) return {};
  return Object.fromEntries(data.flatMap(row => row.path && row.signedUrl ? [[row.path, row.signedUrl]] : []));
}

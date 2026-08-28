/**
 * keepsakeSync — the supabase side of keepsakes.
 *
 * Thin by design. Every decision worth testing lives in the pure modules
 * (keepsake.ts, placeKey.ts, placeMemory.ts, keepsakeImport.ts); this file only
 * moves rows and bytes, which is why it has no test of its own — the same
 * convention pawPrintsSync.ts and walkSync.ts follow.
 *
 * ── Failure posture ──
 * Fire-and-forget, every failure non-fatal, exactly like walkStorySync. A walk
 * that fails to sync its moments is still a walk; the thumbnail upload in
 * particular is allowed to fail indefinitely and retry later, because the
 * keepsake is perfectly usable from the local original in the meantime. Nothing
 * in here may ever be able to fail a walk save.
 *
 * ── What crosses the wire ──
 * Metadata, and a ~20 KB thumbnail. Never the original. See the header of
 * 20260820000000_walk_media.sql for why that split is the whole architecture.
 */

import { supabase } from '../supabase';
import {
  buildKeepsakeInsert,
  normalizeKeepsake,
  sortKeepsakes,
  type Keepsake,
  type KeepsakeInsertInput,
} from './keepsake';
import { neighbourPlaceKeys, PLACE_MATCH_RADIUS_M } from './placeKey';

/** Storage bucket holding thumbnails only. Originals never reach it. */
export const KEEPSAKE_THUMB_BUCKET = 'walk-media-thumbs';

const SELECT_COLUMNS =
  'id, walk_session_id, pet_id, captured_at, lat, lng, route_index, elapsed_s, ' +
  'media_type, source, local_asset_id, width, height, thumb_path, thumb_blurhash, ' +
  'place_key, caption';

/**
 * Write one keepsake. Returns the stored row, or null if the write failed.
 *
 * Callers treat null as "try again later", never as an error to surface: the
 * photo is already safe in the user's own library, which is the point of the
 * architecture.
 */
export async function insertKeepsake(
  input: KeepsakeInsertInput,
): Promise<Keepsake | null> {
  try {
    const { data, error } = await supabase
      .from('walk_media')
      .insert(buildKeepsakeInsert(input))
      .select(SELECT_COLUMNS)
      .single();
    if (error) return null;
    return normalizeKeepsake(data);
  } catch {
    return null;
  }
}

/** Every keepsake on one walk, oldest first. */
export async function fetchWalkKeepsakes(walkSessionId: string): Promise<Keepsake[]> {
  try {
    const { data, error } = await supabase
      .from('walk_media')
      .select(SELECT_COLUMNS)
      .eq('walk_session_id', walkSessionId)
      .order('captured_at', { ascending: true });
    if (error || !data) return [];
    return sortKeepsakes(data.flatMap((row) => normalizeKeepsake(row) ?? []));
  } catch {
    return [];
  }
}

/**
 * Candidate anchors for place memory near a coordinate.
 *
 * Stage 1 of the two-stage lookup: this returns everything in the covering
 * cells, which is deliberately more than "here". The caller passes the result
 * to evaluatePlaceMemory, which filters by real distance. Do not treat what
 * comes back as already being at the same place.
 */
export async function fetchPlaceCandidates(
  petId: string,
  lat: number,
  lng: number,
  radiusM: number = PLACE_MATCH_RADIUS_M,
): Promise<Keepsake[]> {
  const keys = neighbourPlaceKeys(lat, lng, radiusM);
  if (keys.length === 0) return [];

  try {
    const { data, error } = await supabase
      .from('walk_media')
      .select(SELECT_COLUMNS)
      .eq('pet_id', petId)
      .in('place_key', keys)
      .order('captured_at', { ascending: true });
    if (error || !data) return [];
    return data.flatMap((row) => normalizeKeepsake(row) ?? []);
  } catch {
    return [];
  }
}

/**
 * How many moments each of these walks holds.
 *
 * One query for a whole gallery page rather than one per tile: a grid of forty
 * walks would otherwise open forty requests to render forty small badges.
 * Walks with no moments are simply absent from the map, so callers should treat
 * a missing key as zero rather than as unknown.
 */
export async function fetchKeepsakeCounts(
  walkSessionIds: readonly string[],
): Promise<Record<string, number>> {
  if (walkSessionIds.length === 0) return {};

  try {
    const { data, error } = await supabase
      .from('walk_media')
      .select('walk_session_id')
      .in('walk_session_id', [...walkSessionIds]);
    if (error || !data) return {};

    const counts: Record<string, number> = {};
    for (const row of data) {
      const id = (row as { walk_session_id?: string }).walk_session_id;
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  } catch {
    return {};
  }
}

/**
 * Attach an uploaded thumbnail to a keepsake.
 *
 * Separate from the insert on purpose: the row is written the instant the photo
 * is taken, and the thumbnail follows whenever the network allows. That
 * ordering means a keepsake is never lost to a failed upload — it simply spends
 * a while renderable only from the local original.
 */
export async function attachThumbnail(
  keepsakeId: string,
  thumbPath: string,
  blurhash: string | null = null,
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('walk_media')
      .update({ thumb_path: thumbPath, thumb_blurhash: blurhash })
      .eq('id', keepsakeId);
    return !error;
  } catch {
    return false;
  }
}

/** Keepsakes still waiting for their thumbnail — the lazy-upload work queue. */
export async function fetchPendingThumbnails(petId: string, limit = 20): Promise<Keepsake[]> {
  try {
    const { data, error } = await supabase
      .from('walk_media')
      .select(SELECT_COLUMNS)
      .eq('pet_id', petId)
      .is('thumb_path', null)
      .not('local_asset_id', 'is', null)
      .order('captured_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.flatMap((row) => normalizeKeepsake(row) ?? []);
  } catch {
    return [];
  }
}

/**
 * Re-bind a keepsake's local asset id after rehydration on a new device.
 *
 * Best-effort: the id is only a cache hint, so a failure here costs one extra
 * library lookup next launch and nothing more.
 */
export async function updateLocalAssetId(
  keepsakeId: string,
  localAssetId: string | null,
): Promise<void> {
  try {
    await supabase
      .from('walk_media')
      .update({ local_asset_id: localAssetId })
      .eq('id', keepsakeId);
  } catch {
    // Non-fatal by design — see the module header.
  }
}

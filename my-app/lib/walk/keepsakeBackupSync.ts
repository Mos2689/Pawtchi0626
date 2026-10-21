/**
 * keepsakeBackupSync — every server call the opt-in photo backup makes.
 *
 * Kept OUT of keepsakeSync's shared SELECT_COLUMNS on purpose. The columns this
 * reads (owner_preferences.walk_photo_backup, walk_media.original_path /
 * backed_up_at) arrive with migration 20261020000000; if an app build reached
 * someone before that migration was applied, adding them to the shared select
 * would make EVERY keepsake query fail. Here, a missing column is just one more
 * error that resolves to "no backup" — the rest of the photo feature never
 * notices.
 *
 * Every function is best-effort and never throws.
 */

import { supabase } from '../supabase';

export const KEEPSAKE_ORIGINAL_BUCKET = 'walk-media-originals';

/** Signed URLs for a restore download; only needs to outlive one download. */
const ORIGINAL_URL_TTL_S = 600;

export function originalPath(ownerId: string, keepsakeId: string): string {
  return `${ownerId}/${keepsakeId}.jpg`;
}

/** Is backup on for this owner? Off when unset, unreadable, or not migrated. */
export async function fetchBackupEnabled(ownerId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('owner_preferences')
      .select('walk_photo_backup')
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (error || !data) return false;
    return (data as { walk_photo_backup?: unknown }).walk_photo_backup === true;
  } catch {
    return false;
  }
}

/** Turn backup on or off. True when the server accepted it. */
export async function setBackupEnabled(ownerId: string, on: boolean): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('owner_preferences')
      .upsert({ owner_id: ownerId, walk_photo_backup: on }, { onConflict: 'owner_id' });
    return !error;
  } catch {
    return false;
  }
}

/** This owner's photos that have a phone copy and no backup yet, oldest first. */
export async function fetchNeedingBackup(
  ownerId: string,
  limit = 10,
): Promise<{ id: string; localPath: string }[] | null> {
  try {
    const { data, error } = await supabase
      .from('walk_media')
      .select('id, local_path')
      .eq('owner_id', ownerId)
      .is('backed_up_at', null)
      .not('local_path', 'is', null)
      .order('captured_at', { ascending: true })
      .limit(limit);
    if (error || !data) return null;
    return data.flatMap((row: { id: unknown; local_path: unknown }) =>
      typeof row.id === 'string' && typeof row.local_path === 'string'
        ? [{ id: row.id, localPath: row.local_path }]
        : []);
  } catch {
    return null;
  }
}

/** Upload the container copy. Returns the storage path, or null. */
export async function uploadOriginal(input: {
  ownerId: string;
  keepsakeId: string;
  uri: string;
}): Promise<string | null> {
  try {
    const path = originalPath(input.ownerId, input.keepsakeId);
    // React Native has no Blob for a local uri — the same hand-built multipart
    // form keepsakeThumbnail.uploadThumbnail uses.
    const form = new FormData();
    form.append('file', {
      uri: input.uri,
      name: `${input.keepsakeId}.jpg`,
      type: 'image/jpeg',
    } as unknown as Blob);
    const { error } = await supabase.storage
      .from(KEEPSAKE_ORIGINAL_BUCKET)
      .upload(path, form, { contentType: 'image/jpeg', upsert: true });
    return error ? null : path;
  } catch {
    return null;
  }
}

/** Record that a photo's backup exists. */
export async function markBackedUp(keepsakeId: string, path: string): Promise<boolean> {
  try {
    const { error } = await supabase
      .from('walk_media')
      .update({ original_path: path, backed_up_at: new Date().toISOString() })
      .eq('id', keepsakeId);
    return !error;
  } catch {
    return false;
  }
}

/** Where this photo's backup is, or null (none, unreadable, not migrated). */
export async function fetchOriginalPath(keepsakeId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('walk_media')
      .select('original_path')
      .eq('id', keepsakeId)
      .maybeSingle();
    if (error || !data) return null;
    const value = (data as { original_path?: unknown }).original_path;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** A short-lived URL to download a backup from. */
export async function signedOriginalUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.storage
      .from(KEEPSAKE_ORIGINAL_BUCKET)
      .createSignedUrl(path, ORIGINAL_URL_TTL_S);
    return error ? null : data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

/** Point a row at the filename its restored copy was saved under. */
export async function updateLocalPath(keepsakeId: string, fileName: string): Promise<boolean> {
  try {
    const { error } = await supabase.from('walk_media').update({ local_path: fileName }).eq('id', keepsakeId);
    return !error;
  } catch {
    return false;
  }
}

/**
 * Turning backup OFF deletes the owner's backups — "off" should mean the
 * photos live only on their phone again, not that we quietly keep a copy.
 * Lists the owner's folder, removes every object, then clears the rows so the
 * restore rung stops looking. Returns how many objects were removed, or null if
 * the clean-up could not finish (the caller keeps the setting ON in that case,
 * so the owner is never told backups are gone while some remain).
 */
export async function clearBackups(ownerId: string): Promise<number | null> {
  try {
    let removed = 0;
    for (;;) {
      const { data, error } = await supabase.storage
        .from(KEEPSAKE_ORIGINAL_BUCKET)
        .list(ownerId, { limit: 100 });
      if (error) return null;
      if (!data || data.length === 0) break;
      const paths = data.map((o) => `${ownerId}/${o.name}`);
      const { error: rmError } = await supabase.storage.from(KEEPSAKE_ORIGINAL_BUCKET).remove(paths);
      if (rmError) return null;
      removed += paths.length;
      if (data.length < 100) break;
    }
    const { error: rowError } = await supabase
      .from('walk_media')
      .update({ original_path: null, backed_up_at: null })
      .eq('owner_id', ownerId)
      .not('backed_up_at', 'is', null);
    return rowError ? null : removed;
  } catch {
    return null;
  }
}

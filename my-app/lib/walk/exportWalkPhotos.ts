/**
 * exportWalkPhotos — copy every walk photo this phone holds into the user's
 * own photo library.
 *
 * The no-cloud safety net. With backup off, Pawtchi's container is the only
 * place a walk photo's full-size copy lives; this puts a copy where people
 * already look for their photos, and where their own phone backup (iCloud
 * Photos, Google Photos) carries it to the next device.
 *
 * Add-only access: `requestPermissionsAsync(true)` asks to ADD to the library,
 * never to read it — the read prompt keepsakeFile.ts removed stays removed. The
 * add-only usage string is already declared (app.config.ts
 * PHOTO_LIBRARY_ADD_PERMISSION).
 *
 * Re-running saves again: the library has no stable id to dedupe against
 * without READ access, which this deliberately does not ask for. The copy in
 * Profile says so plainly.
 */

import * as MediaLibrary from 'expo-media-library';
import { supabase } from '../supabase';
import { keepsakeFileUri } from './keepsakeFile';

export interface ExportResult {
  saved: number;
  /** Rows whose full-size copy is not on this phone (reinstall, new phone). */
  notOnPhone: number;
  failed: number;
}

/**
 * Add-only, named so lib/privacy/photoLibraryAccess.test.ts can verify it: the
 * library's API takes the flag positionally, and a bare `true` says nothing.
 */
const ADD_ONLY = { writeOnly: true } as const;

/** Null when add-only access was refused. */
export async function exportWalkPhotos(
  ownerId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportResult | null> {
  const permission = await MediaLibrary.requestPermissionsAsync(ADD_ONLY.writeOnly);
  if (!permission.granted) return null;

  const names: string[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabase
      .from('walk_media')
      .select('local_path')
      .eq('owner_id', ownerId)
      .not('local_path', 'is', null)
      .order('captured_at', { ascending: true })
      .range(from, from + 499);
    if (error || !data) break;
    for (const row of data as { local_path: string | null }[]) if (row.local_path) names.push(row.local_path);
    if (data.length < 500) break;
  }

  const result: ExportResult = { saved: 0, notOnPhone: 0, failed: 0 };
  for (let i = 0; i < names.length; i += 1) {
    const uri = keepsakeFileUri(names[i]);
    if (!uri) {
      result.notOnPhone += 1;
    } else {
      try {
        await MediaLibrary.saveToLibraryAsync(uri);
        result.saved += 1;
      } catch {
        result.failed += 1;
      }
    }
    onProgress?.(i + 1, names.length);
  }
  return result;
}

/**
 * delete-account — permanently deletes the signed-in user and their data.
 *
 * Called from Profile (app/(tabs)/profile.tsx). Until October 2026 this
 * function existed only as a deployment (version 5, April 2026) and was not in
 * the repo; this file is that version plus the storage cleanup below.
 *
 * ── What goes, and how ──────────────────────────────────────────────────────
 *
 * Rows: the older pet tables are deleted explicitly (as before). Everything
 * keyed to auth.users with ON DELETE CASCADE — walk_sessions, walk_media,
 * owner_preferences, support tickets and the rest — goes with the auth user
 * in the last step.
 *
 * Files: Storage objects are NOT covered by any cascade. Before this, every
 * deleted account left its walk-photo thumbnails, avatar and support
 * attachments behind, and the opt-in full-size backup (walk-media-originals,
 * 20261020000000) would have left full-size photographs too. Each bucket below
 * is emptied of this user's files BEFORE the auth user is deleted, while their
 * id still identifies them.
 *
 * Not touched: community-walk-media. Those files live under the shared walk's
 * folder and appear in other walkers' memories; whether a leaving member's
 * photos are removed from everyone's memory is a product decision, not a
 * cleanup detail.
 *
 * ── Failure posture ─────────────────────────────────────────────────────────
 *
 * A storage failure is logged and does not stop the deletion: the person asked
 * to leave, and refusing because a file would not delete is worse than a
 * leftover file. Leftovers are findable later by the owner prefix.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Buckets whose keys start with `<user id>/`. */
const OWNER_FOLDER_BUCKETS = ['walk-media-thumbs', 'walk-media-originals', 'support-attachments'];

const PAGE = 100;

/** Every object path under `prefix`, descending into sub-folders. */
async function listAll(admin: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const paths: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: PAGE, offset });
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const path = `${prefix}/${entry.name}`;
      // Folders come back with a null id.
      if (entry.id == null) paths.push(...(await listAll(admin, bucket, path)));
      else paths.push(path);
    }
    if (data.length < PAGE) break;
  }
  return paths;
}

async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += PAGE) {
    const { error } = await admin.storage.from(bucket).remove(paths.slice(i, i + PAGE));
    if (error) throw error;
  }
}

/** Removes this user's files. Returns how many buckets failed, for the log. */
async function deleteUserFiles(admin: SupabaseClient, userId: string): Promise<number> {
  let failures = 0;

  for (const bucket of OWNER_FOLDER_BUCKETS) {
    try {
      const paths = await listAll(admin, bucket, userId);
      await removeAll(admin, bucket, paths);
      console.log(`[delete-account] ${bucket}: removed ${paths.length}`);
    } catch (e) {
      failures++;
      console.error(`[delete-account] ${bucket}: ${e instanceof Error ? e.message : e}`);
    }
  }

  // Avatars sit at the bucket root as `<user id>_<timestamp>.<ext>`.
  try {
    const paths: string[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await admin.storage
        .from('avatars')
        .list('', { limit: PAGE, offset, search: `${userId}_` });
      if (error) throw error;
      if (!data || data.length === 0) break;
      paths.push(...data.filter((f) => f.name.startsWith(`${userId}_`)).map((f) => f.name));
      if (data.length < PAGE) break;
    }
    await removeAll(admin, 'avatars', paths);
    console.log(`[delete-account] avatars: removed ${paths.length}`);
  } catch (e) {
    failures++;
    console.error(`[delete-account] avatars: ${e instanceof Error ? e.message : e}`);
  }

  return failures;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Use the caller's JWT to identify the user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: 'Missing Authorization header' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    // Verify the JWT and get the user
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 401,
      });
    }

    const userId = user.id;
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);

    // 1. Get all pets for this user
    const { data: pets } = await adminClient
      .from('pets')
      .select('id')
      .eq('owner_id', userId);

    const petIds = (pets || []).map((p: { id: string }) => p.id);

    // 2. Delete all pet-related data in dependency order
    if (petIds.length > 0) {
      await adminClient.from('food_scans').delete().in('pet_id', petIds);
      await adminClient.from('activities').delete().in('pet_id', petIds);
      await adminClient.from('daily_logs').delete().in('pet_id', petIds);
      await adminClient.from('schedules').delete().in('pet_id', petIds);
      await adminClient.from('food_pantry').delete().in('pet_id', petIds);
      await adminClient.from('pets').delete().in('id', petIds);
    }

    // 3. Delete user-level data
    await adminClient.from('streaks').delete().eq('owner_id', userId);
    await adminClient.from('coin_transactions').delete().eq('owner_id', userId);

    // 4. Delete the user's stored files (no cascade reaches Storage)
    const storageFailures = await deleteUserFiles(adminClient, userId);
    if (storageFailures > 0) {
      console.error(`[delete-account] ${storageFailures} bucket(s) not fully cleaned for this user`);
    }

    // 5. Delete the auth user last; cascades take the remaining rows
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[delete-account] Error:', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});

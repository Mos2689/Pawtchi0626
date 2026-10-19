-- Undo 20261020000000_walk_photo_backup.sql. Run in the SQL editor.
--
-- Removes the policies (so no client can read or write backups), the index and
-- the three columns. The bucket and any objects in it are deliberately LEFT:
-- deleting users' photographs is not something a rollback should do silently.
-- Empty and drop the bucket by hand from the dashboard only once you are sure
-- nobody needs a restore from it.

BEGIN;

DROP POLICY IF EXISTS "owner_can_read_own_walk_media_originals" ON storage.objects;
DROP POLICY IF EXISTS "owner_can_insert_own_walk_media_originals" ON storage.objects;
DROP POLICY IF EXISTS "owner_can_update_own_walk_media_originals" ON storage.objects;
DROP POLICY IF EXISTS "owner_can_delete_own_walk_media_originals" ON storage.objects;

DROP INDEX IF EXISTS public.walk_media_owner_needs_backup_idx;

ALTER TABLE public.walk_media
  DROP COLUMN IF EXISTS original_path,
  DROP COLUMN IF EXISTS backed_up_at;

ALTER TABLE public.owner_preferences
  DROP COLUMN IF EXISTS walk_photo_backup;

COMMIT;

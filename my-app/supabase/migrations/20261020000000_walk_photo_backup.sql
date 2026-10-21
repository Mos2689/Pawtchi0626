-- Opt-in backup of full-size walk photos.
--
-- ── Why ──
-- Since Sep 2026 a walk photo's full-size copy lives only in the app container
-- on the phone that took it (lib/walk/keepsakeFile.ts); the server holds a
-- 320 px thumbnail. A reinstall, a new phone without a full device restore, an
-- Android "clear storage", or opening Pawtchi on an iPad leaves only that
-- thumbnail. A user lost the full-size photos of a month of walks this way
-- (Oct 2026).
--
-- ── Opt-in, by decision ──
-- Off by default (owner_preferences.walk_photo_backup). The camera's permission
-- gate promises photos stay on the phone; turning backup on is the owner
-- changing that promise for themselves, from Settings.
--
-- ── What goes in the bucket ──
-- The container copy: normally the 2048 px downscale (~400 KB), occasionally a
-- full-size capture when the downscale failed and keepsakeFile.copyCaptureAsIs
-- kept the original instead. Hence a ceiling that fits a full-size phone JPEG
-- and still refuses video.
--
-- Rollback: supabase/rollbacks/20261020000000_walk_photo_backup.down.sql

-- ── The setting ─────────────────────────────────────────────────────────────
ALTER TABLE public.owner_preferences
  ADD COLUMN IF NOT EXISTS walk_photo_backup BOOLEAN NOT NULL DEFAULT FALSE;

-- ── Where a photo's backup is, once it has one ──────────────────────────────
-- Writable by the owner through the existing owner_can_rw_own_walk_media
-- policy, exactly like thumb_path.
ALTER TABLE public.walk_media
  ADD COLUMN IF NOT EXISTS original_path TEXT,
  ADD COLUMN IF NOT EXISTS backed_up_at TIMESTAMPTZ;

-- The backup queue's lookup: this owner's photos with a phone copy and no
-- backup yet. Partial, so it stays tiny once everything is backed up.
CREATE INDEX IF NOT EXISTS walk_media_owner_needs_backup_idx
  ON public.walk_media (owner_id, captured_at)
  WHERE backed_up_at IS NULL AND local_path IS NOT NULL;

-- ── The bucket ──────────────────────────────────────────────────────────────
-- Private for the same reason as walk-media-thumbs: photographs of homes,
-- streets, children and dogs. Clients read through short-lived signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'walk-media-originals',
  'walk-media-originals',
  FALSE,
  -- 8 MB: a full-size phone JPEG fits; video does not.
  8388608,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Keys are `{owner_id}/{keepsake_id}.jpg`; every policy checks the first
-- segment, the same shape as walk-media-thumbs.
CREATE POLICY "owner_can_read_own_walk_media_originals"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'walk-media-originals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "owner_can_insert_own_walk_media_originals"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'walk-media-originals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE for the `upsert: true` retry path, as in walk-media-thumbs.
CREATE POLICY "owner_can_update_own_walk_media_originals"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'walk-media-originals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'walk-media-originals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deleting a moment, or turning backup off and clearing it, must actually
-- delete the image.
CREATE POLICY "owner_can_delete_own_walk_media_originals"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'walk-media-originals'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

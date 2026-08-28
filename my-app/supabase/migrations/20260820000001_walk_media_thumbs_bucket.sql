-- Storage for keepsake thumbnails.
--
-- ── What goes in here, and what never does ──
-- Long-edge-320 JPEGs, ~20 KB each. Never an original. The whole cost and
-- privacy argument for the feature (see 20260820000000_walk_media.sql) depends
-- on that line holding, so the bucket carries a hard file-size ceiling rather
-- than trusting every future call site to resize first.
--
-- ── Why private ──
-- These are photographs of people's homes, streets, children and dogs. A public
-- bucket would make every one of them retrievable by anyone who could guess a
-- uuid, which for a table keyed on uuids is a weaker guarantee than it sounds
-- and an indefensible one to have chosen deliberately. Clients render through
-- short-lived signed URLs instead (lib/walk/keepsakeThumbnail.ts).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'walk-media-thumbs',
  'walk-media-thumbs',
  FALSE,
  -- 256 KB. A correctly-generated thumbnail is ~20 KB, so this is ten times
  -- the expected size: generous enough that an unusual image never silently
  -- fails, tight enough that a full-resolution photo cannot be uploaded here
  -- by mistake.
  262144,
  ARRAY['image/jpeg']
)
ON CONFLICT (id) DO NOTHING;

-- Object keys are `{owner_id}/{keepsake_id}.jpg`. The first path segment is the
-- owner, and every policy below checks it — the same shape the support
-- attachment bucket uses.
--
-- storage.foldername() returns the path segments as an array; [1] is the first.

CREATE POLICY "owner_can_read_own_walk_media_thumbs"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'walk-media-thumbs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "owner_can_insert_own_walk_media_thumbs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'walk-media-thumbs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE is needed for the `upsert: true` retry path: a sync that failed
-- halfway must be able to overwrite its own object rather than collide with it.
CREATE POLICY "owner_can_update_own_walk_media_thumbs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'walk-media-thumbs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'walk-media-thumbs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Deleting a moment must actually delete the image. The archive belongs to the
-- owner, which has to include the right to remove things from it.
CREATE POLICY "owner_can_delete_own_walk_media_thumbs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'walk-media-thumbs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

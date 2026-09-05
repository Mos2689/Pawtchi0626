-- Keepsakes get a copy Pawtchi actually owns.
--
-- ── What was wrong ──
-- 20260820000000_walk_media.sql wrote the capture into the USER'S photo library
-- and kept only `local_asset_id`, a receipt. Everything painful about the
-- feature descends from that one decision:
--
--   * Reading the library back needs photo permission, so iOS put its own
--     "Would Like to Access Your Photos" sheet over the Home screen at launch
--     for anyone on limited access — unprompted, before they touched anything.
--   * Android deliberately never requests READ_MEDIA_IMAGES, so Android users
--     could NEVER see their own originals. Only the 20 KB thumbnail. Ever.
--   * `ph://` ids do not survive device migration, which is why
--     matchAssetForKeepsake exists: a capture-time matching heuristic written
--     to re-find photos we chose to give away.
--
-- Instagram and Snapchat do the opposite, and it is why they never prompt: the
-- capture lives in their own app container, which an app may read without any
-- permission on either platform. The photo library is touched only when the
-- user asks for a copy, and that is write-only — a mode with no "limited"
-- state and therefore no sheet.
--
-- ── What this column is ──
-- The FILENAME of Pawtchi's own copy inside the app's document directory.
-- Relative, never absolute: iOS re-generates the app container UUID on update,
-- so a stored `file:///var/mobile/Containers/Data/Application/<UUID>/...` path
-- is broken by the next release. The client joins it to the current document
-- directory at read time — see lib/walk/keepsakeFile.ts.
--
-- Still no photograph reaches this database. The file named here sits on the
-- device; what syncs is what always synced, the metadata and the thumbnail.
-- The ladder in lib/walk/keepsakeResolve.ts simply gains a rung above the
-- library one, and that rung needs no permission to climb.
--
-- ── Why local_asset_id stays ──
-- Two reasons. Rows written before this migration have nothing else, so
-- dropping the library path would silently downgrade every existing moment to
-- a thumbnail. And the camera-roll copy remains a real courtesy — people want
-- their walk photos in Photos with everything else. It is now what it always
-- claimed to be: a receipt for a copy we gave away, never a thing we read to
-- render.

ALTER TABLE walk_media
  ADD COLUMN IF NOT EXISTS local_path TEXT;

-- The thumbnail work queue asks "which moments still owe us an upload". It used
-- to qualify rows by `local_asset_id IS NOT NULL`, because that was the only
-- proof an image existed anywhere. A capture whose owner declined the camera-roll
-- copy now has a local_path and no asset id, and must still be uploadable.
COMMENT ON COLUMN walk_media.local_path IS
  'Filename (not path) of Pawtchi''s own copy in the app document directory. Relative because iOS container paths change on update.';

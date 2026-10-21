-- Support runbook: "my walk photos are gone".
-- Read-only. Run in the Supabase SQL editor; replace the email in all three.
--
-- Where photos live (since Sep 2026): the full-size copy is inside the app on
-- the phone that took it (Documents/keepsakes); the server keeps a 320 px
-- thumbnail plus time and position; with "Back up walk photos" on, a private
-- full-size copy too (bucket walk-media-originals).
--
-- How to read the results:
--   photos = 0, walks > 0      → photos never reached the account. Since build
--                                1.0.28 recovery re-attaches journaled photos on
--                                the next launch; before that they were lost.
--   with_server_thumbnail < photos → some thumbnails never uploaded. Recovery
--                                retries them on launch/foreground while the
--                                phone still has the originals.
--   backed_up = photos         → everything is restorable full-size on any phone.
--   thumbs present but user sees nothing → a display bug; get a screenshot.

-- 1. The overall picture
WITH u AS (SELECT id FROM auth.users WHERE email = 'user@example.com')
SELECT
  (SELECT count(*) FROM walk_sessions ws WHERE ws.owner_id = (SELECT id FROM u)) AS walks,
  count(m.id)              AS photos,
  count(m.thumb_path)      AS with_server_thumbnail,
  count(m.local_path)      AS saved_in_app,
  count(m.local_asset_id)  AS older_camera_roll_photos,
  count(m.backed_up_at)    AS backed_up,
  (SELECT walk_photo_backup FROM owner_preferences op WHERE op.owner_id = (SELECT id FROM u)) AS backup_on,
  min(m.captured_at)       AS first_photo,
  max(m.captured_at)       AS last_photo
FROM walk_media m
WHERE m.owner_id = (SELECT id FROM u);

-- 2. Photos per walk (last 30 walks)
WITH u AS (SELECT id FROM auth.users WHERE email = 'user@example.com')
SELECT ws.started_at::date AS day, round(ws.distance_m) AS metres,
       count(m.id) AS photos, count(m.thumb_path) AS thumbs,
       count(m.local_path) AS in_app, count(m.backed_up_at) AS backed_up
FROM walk_sessions ws
LEFT JOIN walk_media m ON m.walk_session_id = ws.id
WHERE ws.owner_id = (SELECT id FROM u)
GROUP BY ws.id, ws.started_at, ws.distance_m
ORDER BY ws.started_at DESC
LIMIT 30;

-- 3. Do the stored files actually exist?
WITH u AS (SELECT id FROM auth.users WHERE email = 'user@example.com')
SELECT
  count(m.thumb_path)                    AS thumbs_recorded,
  count(t.id)                            AS thumbs_present,
  count(m.original_path)                 AS backups_recorded,
  count(o.id)                            AS backups_present
FROM walk_media m
LEFT JOIN storage.objects t ON t.bucket_id = 'walk-media-thumbs'    AND t.name = m.thumb_path
LEFT JOIN storage.objects o ON o.bucket_id = 'walk-media-originals' AND o.name = m.original_path
WHERE m.owner_id = (SELECT id FROM u);

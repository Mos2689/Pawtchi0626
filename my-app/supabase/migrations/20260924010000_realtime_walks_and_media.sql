-- Realtime for the two community tables the app already subscribes to.
--
-- ── The bug ────────────────────────────────────────────────────────────────
--
-- `supabase_realtime` published exactly two tables: community_live_locations
-- and community_walk_attendance. The app has subscribed to two more since the
-- live walk shipped —
--
--   * community_walks (UPDATE)      — how a member's phone learns the host has
--                                     closed the walk (TrailRecording, live.tsx)
--   * community_shared_media (*)    — how the live map shows a photo the rest
--                                     of the pack just took
--
-- — and neither was in the publication, so neither subscription ever received
-- a single event. Postgres does not complain about a subscription to an
-- unpublished table; it simply never sends anything.
--
-- Found on device 2026-09-24: the host closed the walk and the member, screen
-- on and looking at the live map, kept walking and taking photos until they
-- backed out. Only the foreground check caught the close.
--
-- ── Cost ───────────────────────────────────────────────────────────────────
--
-- Both tables change rarely: a walk row a handful of times in its life, a
-- photo row once per shared photo. Realtime evaluates RLS per subscriber per
-- change, and subscribers exist only while someone has a live walk open. This
-- is nothing like the every-minute cron that took the nano instance down
-- (see 20260922030000_slow_community_cron).
--
-- Idempotent: adding a table that is already published raises, so each is
-- guarded.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'community_walks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_walks;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'community_shared_media'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.community_shared_media;
  END IF;
END;
$$;

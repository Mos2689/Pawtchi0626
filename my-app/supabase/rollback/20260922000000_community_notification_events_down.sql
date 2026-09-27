-- Teardown for 20260922000000_community_notification_events.
--
-- ⚠ NOT A MIGRATION. Lives outside supabase/migrations/ so `supabase db push`
-- can never pick it up. Run it deliberately.
--
-- Four things went in; all four come out, and the ORDER matters for one of
-- them. The event_type CHECK must be narrowed LAST, after the three producers
-- of the new types are gone — narrow it first and any trigger still firing
-- would start raising a constraint violation inside somebody's RSVP.
--
-- Rows already enqueued under the new types are deleted rather than left. They
-- would otherwise fail the narrowed constraint on any future write that
-- touches them, and an undelivered notification about a walk that has since
-- happened is worth nothing to anyone.

BEGIN;

-- 1. The cron first: it is the only one of these that runs unattended, and
--    leaving it scheduled against a dropped function logs an error every five
--    minutes for ever.
SELECT cron.unschedule('community-walk-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-walk-reminders');
-- The fast lane goes too. Left scheduled it would keep invoking the dispatcher
-- every minute in a mode that, after a rollback of the deployed function, may
-- no longer exist — a no-op at best and a minute-by-minute error log at worst.
-- `notify-dispatch` on */15 is untouched and keeps delivering everything.
SELECT cron.unschedule('notify-dispatch-community')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'notify-dispatch-community');

-- 2. The two triggers, then their functions.
DROP TRIGGER IF EXISTS community_attendance_answered_notify ON public.community_walk_attendance;
DROP TRIGGER IF EXISTS community_media_shared_notify ON public.community_shared_media;

DROP FUNCTION IF EXISTS public.on_community_attendance_answered();
DROP FUNCTION IF EXISTS public.on_community_media_shared();
DROP FUNCTION IF EXISTS public.sweep_community_walk_reminders();

-- 3. Now nothing can produce the new types, so the queue can be cleared.
DELETE FROM public.community_notification_events
 WHERE event_type IN ('community_rsvp', 'community_moment', 'community_walk_soon');

-- 4. And the constraint can go back to the three types 20260917000000 allowed.
ALTER TABLE public.community_notification_events
  DROP CONSTRAINT IF EXISTS community_notification_events_event_type_check;
ALTER TABLE public.community_notification_events
  ADD CONSTRAINT community_notification_events_event_type_check
  CHECK (event_type IN (
    'community_invite',
    'community_walk_change',
    'community_memory_ready'
  ));

COMMIT;

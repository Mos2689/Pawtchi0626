-- Down for 20260922050000_notify_dispatch_on_enqueue.
--
-- Removes the trigger and its function. Community notifications then fall back
-- entirely to the */15 notify-dispatch cron, which still delivers every queued
-- event — latency goes from sub-second to up to a quarter of an hour, and
-- nothing is lost.
--
-- Do NOT "restore" the every-minute cron as part of reverting this. That job is
-- what took production down on 22 Sep 2026; 20260922030000 documents it. If
-- you need the fast lane back without the trigger, */5 is the floor for this
-- instance size.

DROP TRIGGER IF EXISTS community_notification_events_dispatch ON public.community_notification_events;
DROP FUNCTION IF EXISTS public.ping_notify_dispatch();

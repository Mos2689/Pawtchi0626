-- Down for 20260922060000_dispatch_trigger_per_row.
--
-- Restores the statement-level trigger. Note what that costs: every
-- deduplicated enqueue — every photo after the first on a walk — wakes
-- notify-dispatch for a row that was never inserted.
--
-- Nothing breaks, so this is safe to run; it is just wasteful. If you are
-- reverting because the trigger itself is the problem, revert 20260922050000
-- instead and let the */15 notify-dispatch cron carry the queue.

DROP TRIGGER IF EXISTS community_notification_events_dispatch ON public.community_notification_events;
CREATE TRIGGER community_notification_events_dispatch
  AFTER INSERT ON public.community_notification_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.ping_notify_dispatch();

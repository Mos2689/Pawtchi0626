-- Stop waking the dispatcher for notifications that were deduplicated away.
--
-- 20260922050000 attached community_notification_events_dispatch as FOR EACH
-- STATEMENT. A statement-level trigger fires once per statement whether that
-- statement inserted a thousand rows or none — and enqueue_community_
-- notification is ON CONFLICT DO NOTHING, so "none" is a designed outcome
-- here, not an edge case.
--
-- community_moment is the clearest example: one notification per recipient per
-- walk, EVER, because the first photo already says there is something to go
-- and look at. Every photo after the first is a deliberate conflict. Under the
-- statement trigger each of those still posted to notify-dispatch, which woke,
-- claimed nothing, and returned. Ten photos, one notification, ten calls.
--
-- FOR EACH ROW fires only for rows that were actually inserted, so a conflict
-- costs nothing.
--
-- The reason STATEMENT was chosen — a bulk insert becoming one call per row —
-- is already handled by the queue check inside ping_notify_dispatch(). The
-- reminder sweep writes all its rows in a single transaction, so the first
-- row's fire queues the request and every subsequent row sees that queue entry
-- and skips. The coalescing was never the trigger granularity's job.
--
-- 20260922050000 is corrected in place for fresh environments; this migration
-- is what moves a database that already has the statement version.

DROP TRIGGER IF EXISTS community_notification_events_dispatch ON public.community_notification_events;
CREATE TRIGGER community_notification_events_dispatch
  AFTER INSERT ON public.community_notification_events
  FOR EACH ROW EXECUTE FUNCTION public.ping_notify_dispatch();

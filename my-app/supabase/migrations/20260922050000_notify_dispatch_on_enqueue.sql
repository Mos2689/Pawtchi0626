-- Dispatch community notifications when one is enqueued, not when a clock ticks.
--
-- ── The polling was never the design ────────────────────────────────────────
--
-- This pipeline has been event-driven since 20260917000000. Triggers on real
-- user actions — an RSVP answered, a photo shared, a walk edited, an invite
-- sent — call enqueue_community_notification, which writes one row to
-- community_notification_events behind a UNIQUE dedupe_key.
--
-- The only polled part was the last hop: a cron waking notify-dispatch to
-- drain that queue. It asked 1,440 times a day whether anything had happened,
-- and on a t4g.nano that question cost more than the answers were worth. It
-- took production down on 22 Sep — see 20260922030000.
--
-- A queue that already knows the instant it gains a row does not need to be
-- asked. So the trigger below posts to notify-dispatch when a row lands, and
-- the polling goes away entirely rather than being slowed down.
--
--   idle cost            1,440 calls/day  →  0
--   invite latency       up to 5 minutes  →  sub-second
--   load is proportional to                  real activity, not to time
--
-- ── Coalescing, which is the part that would otherwise be the same bug ──────
--
-- A host editing a walk notifies a whole pack. Naively that is one HTTP call
-- per member, each waking a dispatcher that drains the same queue — the same
-- pile-up that caused the outage, triggered by a burst instead of a clock.
--
-- The debounce is pg_net's own queue rather than a time window. If a request
-- to notify-dispatch is still sitting in net.http_request_queue, it has not
-- been picked up yet, so it WILL see the row we just wrote — and we skip.
--
-- That is what makes this correct rather than merely cheaper. A time-window
-- debounce ("not more than once per 10s") strands the event that arrives one
-- second after a ping: it is skipped, and nothing else is coming for it until
-- the reaper. The queue check cannot strand anything, because the only thing
-- it skips for is a call that has not run yet.
--
-- Worst case it posts one redundant call — when the worker picked the queue
-- row up microseconds before we looked. Redundant is the right direction to
-- fail in; the dispatcher claims rows, so a second drain finds nothing.
--
-- Inside a single transaction this collapses a whole pack to one call: the
-- first insert queues the request, and every later insert sees that row.
--
-- ── What still needs a clock ────────────────────────────────────────────────
--
-- `community_walk_soon` — "your walk starts in half an hour" — cannot be
-- event-driven. As 20260922000000 puts it, a walk approaching its start time
-- is the ABSENCE of a write. Nothing happens to trigger on.
--
-- So sweep_community_walk_reminders stays on a schedule. It is pure SQL with
-- no HTTP call, it is cheap, and */15 is ample for a 30-minute window. It also
-- composes: the sweep INSERTS events, which fires this trigger, which
-- dispatches them at once. The clock decides WHEN the event exists; the
-- trigger still decides when it is sent.
--
-- The */15 notify-dispatch cron stays too, as the reaper. If pg_net drops a
-- request, or the function is mid-deploy, or the post fails silently, nothing
-- is stranded for longer than a quarter of an hour. That is the job a
-- scheduler should have here: a backstop, never the primary path.

CREATE OR REPLACE FUNCTION public.ping_notify_dispatch()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url TEXT := 'https://mbvpjbwukhypvmgeuyyw.supabase.co/functions/v1/notify-dispatch';
  v_secret TEXT;
BEGIN
  -- A call already queued has not run yet, so it will see the row that fired
  -- this trigger. Nothing to do.
  IF EXISTS (SELECT 1 FROM net.http_request_queue q WHERE q.url = v_url) THEN
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets WHERE name = 'cron_secret';
  IF v_secret IS NULL THEN
    -- Without the secret the dispatcher would reject us anyway. Stay quiet and
    -- let the */15 reaper carry it; a missing secret is an operator problem,
    -- not something to fail somebody's RSVP over.
    RETURN NULL;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{"mode":"community"}'::jsonb,
    timeout_milliseconds := 20000
  );
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- This runs inside somebody's INSERT. A notification that cannot be
  -- dispatched is a delayed notification; an exception here would be a failed
  -- RSVP, a lost photo, an invite that did not send. The reaper exists for
  -- exactly this case, so swallow it and let the row wait.
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.ping_notify_dispatch() FROM PUBLIC, anon, authenticated;

-- CORRECTED IN PLACE (see 20260922060000): this shipped as FOR EACH STATEMENT
-- and is now FOR EACH ROW.
--
-- enqueue_community_notification is ON CONFLICT DO NOTHING, and a
-- statement-level trigger fires even when the statement inserted NOTHING. So
-- every deduplicated enqueue woke the dispatcher for an event that does not
-- exist. That is not a rare path: community_moment is deliberately one per
-- recipient per walk EVER, so a tenth photo is a conflict by design, and ten
-- photos meant ten calls for one notification.
--
-- FOR EACH ROW does not fire on a conflict that inserted no row.
--
-- The bulk insert that STATEMENT was chosen to protect (the reminder sweep)
-- needs no protecting: its rows land in one transaction, so the first fire
-- queues a call and every later one sees that queue row and skips. One call
-- either way.
DROP TRIGGER IF EXISTS community_notification_events_dispatch ON public.community_notification_events;
CREATE TRIGGER community_notification_events_dispatch
  AFTER INSERT ON public.community_notification_events
  FOR EACH ROW EXECUTE FUNCTION public.ping_notify_dispatch();

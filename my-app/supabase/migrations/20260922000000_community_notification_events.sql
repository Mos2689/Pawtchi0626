-- Together notifications: the three kinds nothing was enqueuing.
--
-- ── What already worked ─────────────────────────────────────────────────────
--
-- More of this pipeline existed than it looked. `community_notification_events`
-- is written by `on_community_walk_changed` (plan changes, memory ready), by
-- `invite_community_username` / `claim_external_community_invite` (trail
-- invites) and by `invite_to_community_walk` (walk invites), and
-- `get_community_notification_candidates` already joins tokens, timezone, quiet
-- hours, the global push switch and the per-pack mute, and already dedupes
-- against `notification_history`. Production holds 79 events proving all of it
-- runs.
--
-- None had been delivered, for a reason that is not in this file: the deployed
-- notify-dispatch predates the community tables and has no pass that reads
-- them. That is a deploy, not a migration.
--
-- ── What was genuinely missing, and is added here ───────────────────────────
--
--   1. community_rsvp   — a host is never told somebody answered their walk.
--   2. community_moment — a photo shared to a walk notifies nobody.
--   3. community_walk_soon — nothing is time-based, so "the walk starts in
--      half an hour" could not exist at all. Triggers fire on writes; a walk
--      approaching its start time is the absence of a write.
--
-- ── The noise budget, which is the whole design ─────────────────────────────
--
-- Every one of these fires on somebody ELSE's action, so the failure mode is a
-- pack of six turning into six notifications. `dedupe_key` is UNIQUE and
-- `enqueue_community_notification` is ON CONFLICT DO NOTHING, which makes the
-- key the rate limit. Each one below is chosen so the worst case is bounded:
--
--   rsvp      → one per responder per walk, to the organiser only.
--   moment    → one per recipient per walk, EVER. The first photo says photos
--               are landing; the twentieth says nothing new.
--   walk_soon → one per person per walk.

-- ── 1. The new event types ──────────────────────────────────────────────────
ALTER TABLE public.community_notification_events
  DROP CONSTRAINT IF EXISTS community_notification_events_event_type_check;
ALTER TABLE public.community_notification_events
  ADD CONSTRAINT community_notification_events_event_type_check
  CHECK (event_type IN (
    'community_invite',
    'community_walk_change',
    'community_memory_ready',
    'community_rsvp',
    'community_moment',
    'community_walk_soon'
  ));

-- ── 2. Someone answered your walk ───────────────────────────────────────────
--
-- The organiser only. A pack does not need to watch each other RSVP, and
-- telling them would turn one host's walk into everybody's notification.
--
-- Fires on the transition INTO an answer, never out of it and never on the
-- later status moves ('checked_in', 'walking', 'finished') — those are the walk
-- happening, not somebody deciding.
CREATE OR REPLACE FUNCTION public.on_community_attendance_answered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_walk public.community_walks;
  v_name TEXT;
BEGIN
  IF NEW.status NOT IN ('coming', 'cant_make_it') THEN RETURN NEW; END IF;
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;

  SELECT * INTO v_walk FROM public.community_walks w WHERE w.id = NEW.walk_id;
  IF NOT FOUND OR v_walk.organizer_id = NEW.user_id THEN RETURN NEW; END IF;

  -- The name the host would recognise. Falls back to the username, then to
  -- "Someone" — never to a bare UUID, which is the one thing worse than vague.
  SELECT coalesce(nullif(trim(p.full_name), ''), nullif(p.username, ''), 'Someone')
    INTO v_name
    FROM public.profiles p WHERE p.id = NEW.user_id;

  PERFORM public.enqueue_community_notification(
    v_walk.organizer_id,
    'community_rsvp',
    v_walk.pack_id,
    v_walk.id,
    CASE WHEN NEW.status = 'coming'
      THEN coalesce(v_name, 'Someone') || ' is coming'
      ELSE coalesce(v_name, 'Someone') || ' can''t make it' END,
    v_walk.title || ' · ' || v_walk.meeting_label,
    '/community/walk/' || v_walk.id::TEXT,
    -- Keyed on the responder, not on the answer: somebody who says yes, then
    -- no, then yes again is one person making up their mind, not three events.
    'community_rsvp:' || v_walk.id::TEXT || ':' || NEW.user_id::TEXT
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_attendance_answered_notify ON public.community_walk_attendance;
CREATE TRIGGER community_attendance_answered_notify
  AFTER UPDATE ON public.community_walk_attendance
  FOR EACH ROW EXECUTE FUNCTION public.on_community_attendance_answered();

-- ── 3. Photos are landing on this walk ──────────────────────────────────────
--
-- Once per recipient per walk, and that bound is the point. Somebody emptying
-- a camera roll into a walk must not be able to send twenty notifications to
-- five people; the first one has already done the only job this has, which is
-- to say there is something to go and look at.
CREATE OR REPLACE FUNCTION public.on_community_media_shared()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_walk public.community_walks;
BEGIN
  IF NEW.removed_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_walk FROM public.community_walks w WHERE w.id = NEW.walk_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  PERFORM public.enqueue_community_notification(
    recipient.user_id,
    'community_moment',
    v_walk.pack_id,
    v_walk.id,
    'A moment from ' || v_walk.title,
    'Someone on the walk shared a photo.',
    '/community/walk/' || v_walk.id::TEXT || '/memory',
    'community_moment:' || v_walk.id::TEXT || ':' || recipient.user_id::TEXT
  )
  -- Everyone who was ON the walk, not everyone in the pack: a photo from a
  -- walk you skipped is somebody else's afternoon.
  FROM public.community_walk_attendance recipient
  WHERE recipient.walk_id = NEW.walk_id
    AND recipient.user_id <> NEW.contributor_id
    AND recipient.status IN ('coming', 'checked_in', 'walking', 'finished');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS community_media_shared_notify ON public.community_shared_media;
CREATE TRIGGER community_media_shared_notify
  AFTER INSERT ON public.community_shared_media
  FOR EACH ROW EXECUTE FUNCTION public.on_community_media_shared();

-- ── 4. The walk starts soon ─────────────────────────────────────────────────
--
-- The only one of these that cannot be a trigger. A walk approaching its start
-- time is the ABSENCE of a write, so something has to go and look.
--
-- Swept in SQL on its own cron rather than through an edge function: there is
-- nothing here that needs a runtime, and one less HTTP hop is one less thing
-- that can be down at the moment a reminder matters.
--
-- 30 minutes is the lead time because the action it supports is leaving the
-- house. An hour is forgettable; ten minutes is too late to be useful.
CREATE OR REPLACE FUNCTION public.sweep_community_walk_reminders()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count INTEGER := 0;
BEGIN
  -- ONE query, deliberately. It was briefly written as a counting CTE plus an
  -- identical subquery for the enqueue, which is two copies of a predicate
  -- that must never disagree — the kind of duplication that silently starts
  -- reminding the wrong people the first time one side is edited.
  PERFORM public.enqueue_community_notification(
    due.user_id,
    'community_walk_soon',
    due.pack_id,
    due.id,
    due.title || ' starts soon',
    'Meeting at ' || due.meeting_label || '.',
    '/community/walk/' || due.id::TEXT,
    'community_walk_soon:' || due.id::TEXT || ':' || due.user_id::TEXT
  )
  FROM (
    SELECT w.id, w.pack_id, w.title, w.meeting_label, a.user_id
    FROM public.community_walks w
    JOIN public.community_walk_attendance a ON a.walk_id = w.id
    WHERE w.state = 'planned'
      AND w.scheduled_for IS NOT NULL
      -- Bounded at BOTH ends. Without the lower bound a walk whose start time
      -- passed and was never marked complete would be swept for ever; the
      -- dedupe key would hold the line, but the sweep would keep paying to
      -- rediscover that.
      AND w.scheduled_for > now()
      AND w.scheduled_for <= now() + interval '30 minutes'
      -- Only people who said they were coming. Reminding someone about a walk
      -- they declined is the app arguing with them.
      AND a.status IN ('coming', 'checked_in')
  ) AS due;

  -- Rows considered, not rows enqueued: most sweeps re-see the same walk and
  -- ON CONFLICT DO NOTHING drops it. Useful as a "the sweep is alive" signal,
  -- which is all it is read for.
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_community_walk_reminders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_community_walk_reminders() TO service_role;

-- CORRECTED IN PLACE (see 20260922030000): this was */5 and is now */15. The
-- reminder is a 30-minute window, so a quarter-hour of jitter still lands it
-- inside the window, and this database has no headroom to spend on precision
-- nobody can perceive.
SELECT cron.unschedule('community-walk-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'community-walk-reminders');
SELECT cron.schedule(
  'community-walk-reminders',
  '*/15 * * * *',
  $cron$SELECT public.sweep_community_walk_reminders();$cron$
);

-- ── 5. The fast lane ────────────────────────────────────────────────────────
--
-- The SAME notify-dispatch function, every five minutes, with
-- `{"mode":"community"}` so it runs only the community pass.
--
-- Fifteen minutes is the wrong latency for everything Together produces. An
-- invitation that lands a quarter of an hour after it was sent has missed the
-- conversation it belongs to, and a "starts soon" reminder can arrive after
-- the walk has started — which is worse than not sending it.
--
-- It is a mode on the existing dispatcher rather than a second function
-- because this project has exactly one notification engine, one copy source
-- and one claim-and-send path, and a second one would be free to disagree with
-- the first. What the mode skips is the rule-driven pass: that gates on the
-- owner's local hour and rations itself with intensity and frequency caps, so
-- running it far more often would be far more scans to arrive at the same
-- daily cap.
--
-- CORRECTED IN PLACE: there is no cron here any more, and the mode is not
-- reached by a schedule at all.
--
-- This shipped as a `* * * * *` job and took production down — every minute,
-- on a t4g.nano, against a dispatcher deploy that did not yet understand
-- `mode` and so ran its entire workload each time. Runs stacked faster than
-- they finished until the connection pool was gone. 20260922030000 is the
-- incident record; read it before adding any cron to this project.
--
-- The replacement is not a slower cron. 20260922050000 puts a trigger on
-- community_notification_events that posts `{"mode":"community"}` the instant
-- a row is enqueued: sub-second, and zero when nobody is using Together.
-- Polling a queue that is written by triggers was always the wrong shape.
--
-- `notify-dispatch` stays on */15 and keeps doing everything, which also makes
-- it the backstop if the trigger's post is ever lost.

-- Notification inbox — let an owner read their own delivery ledger, and only read it.
--
-- `notification_history` has been the send-side ledger since
-- 20260805000000_notification_pipeline.sql: campaign_key, sent_at, opened_at,
-- dedupe_key, receipt state. The app now has a notification center, and a
-- center that cannot show a push the owner already received is only half an
-- inbox: a notification swiped out of the OS tray at 7am was, until now, gone
-- forever. So the client needs to read this table.
--
-- ── What auditing that access turned up ─────────────────────────────────────
--
-- RLS was already enabled, with exactly one policy:
--
--     "Users can manage their notification history"
--     FOR ALL TO public USING (auth.uid() = user_id)
--
-- FOR ALL is SELECT, INSERT, UPDATE and DELETE. Combined with the default
-- `authenticated` grants, any signed-in client could rewrite or delete its own
-- ledger rows. That is not merely untidy — `dedupe_key` carries a UNIQUE index
-- and is the dispatcher's idempotency claim (notify-dispatch upserts on it with
-- ignoreDuplicates before sending). A client able to edit it could:
--
--   * DELETE a ledger row, so a campaign it already received sends again;
--   * rewrite dedupe_key to a value matching a future claim of its own,
--     silently suppressing that send;
--   * rewrite dedupe_key to collide with the key of ANOTHER user's future
--     claim, making the dispatcher drop that user's notification as a
--     duplicate. A cross-account denial, from a table nobody thought of as
--     dangerous.
--
-- Nothing has ever needed those writes. Every writer is an edge function
-- holding the service-role key (notify-dispatch, notify-receipts,
-- notify-email-dispatch, notify-weekly-digest, email-events), and service role
-- bypasses RLS. The app's only write path is already the SECURITY DEFINER
-- function `mark_notification_opened`, which likewise bypasses it. So the write
-- half of that policy grants nothing legitimate and is removed here.

-- ── Read state ──────────────────────────────────────────────────────────────
-- Separate from `opened_at`, which already means something specific: "this push
-- was tapped in the tray". Reading an item in the center is a weaker signal and
-- conflating the two would corrupt open-rate reporting on every campaign.
ALTER TABLE public.notification_history
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

COMMENT ON COLUMN public.notification_history.read_at IS
  'Set when the owner viewed this item in the in-app notification center. Distinct from opened_at, which means the push itself was tapped in the OS tray.';

-- ── Read-only for the owner ─────────────────────────────────────────────────
-- Already enabled; restated so a fresh database reaches the same state.
ALTER TABLE public.notification_history ENABLE ROW LEVEL SECURITY;

-- The old policy has to GO, not just be joined by a narrower one. Permissive
-- policies are OR'd together, so adding a SELECT-only policy alongside a
-- FOR ALL policy would change precisely nothing.
DROP POLICY IF EXISTS "Users can manage their notification history" ON public.notification_history;

DROP POLICY IF EXISTS notification_history_own_read ON public.notification_history;
CREATE POLICY notification_history_own_read
  ON public.notification_history
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- ── The one write a client may make ─────────────────────────────────────────
-- Postgres has no column-level restriction inside a policy, so "may set read_at
-- and nothing else" cannot be expressed as one. It is expressed as a function
-- instead: SECURITY DEFINER for the bypass, with an explicit user_id predicate
-- doing the work the policy would have done. Same shape as
-- `register_push_token` (20260805000000) and `mark_notification_opened`.
CREATE OR REPLACE FUNCTION public.mark_notification_read(p_dedupe_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mark_notification_read requires an authenticated session';
  END IF;

  IF p_dedupe_key IS NULL OR length(p_dedupe_key) = 0 THEN
    RETURN;
  END IF;

  -- The user_id predicate is what makes SECURITY DEFINER safe: the function
  -- runs as owner, so without it any caller could mark any row in the table.
  -- Idempotent — a second call on an already-read row is a no-op rather than a
  -- timestamp that creeps forward.
  UPDATE public.notification_history
     SET read_at = NOW()
   WHERE dedupe_key = p_dedupe_key
     AND user_id = auth.uid()
     AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notification_read(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_read(TEXT) TO authenticated;

-- Bulk "mark all read", so opening the center does not fire one round trip per
-- unread row. Same ownership predicate, same single-column write.
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'mark_all_notifications_read requires an authenticated session';
  END IF;

  UPDATE public.notification_history
     SET read_at = NOW()
   WHERE user_id = auth.uid()
     AND read_at IS NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read() TO authenticated;

-- ── The badge query ─────────────────────────────────────────────────────────
-- "How many unread does this owner have", run on every app foreground.
CREATE INDEX IF NOT EXISTS notification_history_unread_idx
  ON public.notification_history (user_id, sent_at DESC)
  WHERE read_at IS NULL;

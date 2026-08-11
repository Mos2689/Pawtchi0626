-- Email as a first-class engagement channel.
--
-- ── Why this exists ─────────────────────────────────────────────────────────
--
-- Push reaches almost nobody. Measured against production the day this was
-- written, via the existing public.notification_reach view:
--
--     never_asked   148 users   (44 signed in within 30 days)
--     no_pet_yet     21 users
--     reachable      13 users
--
-- 13 of 182. Meanwhile all 182 accounts have a confirmed email address. Email
-- is not a "second channel" for Pawtchi, it is the only one that currently
-- reaches the user base, and 44 people are actively using the app with no way
-- for us to reach them at all.
--
-- ── The bug this fixes ──────────────────────────────────────────────────────
--
-- get_weekly_digest_candidates (20260805000003) gates on:
--
--     AND COALESCE(op.push_enabled, TRUE) IS TRUE
--
-- so an owner who declined the OS push prompt, or turned pushes off in the app,
-- also receives no email. That inverts the entire reason for having the
-- channel. Email consent and push consent are different consents and are now
-- stored, read and revoked separately. That RPC is corrected in the migration
-- that follows this one.
--
-- ── Design notes ────────────────────────────────────────────────────────────
--
-- The category columns intentionally mirror the push ones by name but not by
-- value. An owner who silences meal reminders on their lock screen has said
-- nothing about whether they want a monthly walk report in their inbox, and
-- reusing cat_* for both would silently conflate the two.
--
-- Deliberately NOT added: an email_last_sent_at column. Frequency capping reads
-- notification_history, which already records every send on both channels. A
-- second counter would be a second thing to keep in sync and a second thing to
-- get wrong.

-- ── Preferences ─────────────────────────────────────────────────────────────

ALTER TABLE public.owner_preferences
  ADD COLUMN IF NOT EXISTS email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_email_lifecycle BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_email_digest BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_email_insights BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_email_walk BOOLEAN NOT NULL DEFAULT TRUE,
  -- Unguessable, per-owner, and the only credential the one-click unsubscribe
  -- endpoint accepts. 122 bits of entropy: a UUID is appropriate here precisely
  -- because the worst an attacker can do with a guessed one is stop us emailing
  -- somebody, which the RPC below enforces as the only possible outcome.
  ADD COLUMN IF NOT EXISTS email_unsubscribe_token UUID NOT NULL DEFAULT gen_random_uuid(),
  -- Kept for the compliance trail. Gmail and Yahoo require honouring an
  -- unsubscribe within two days; this is how we can prove when it landed.
  ADD COLUMN IF NOT EXISTS email_unsubscribed_at TIMESTAMPTZ;

-- The one-click endpoint looks an owner up by token and nothing else.
CREATE UNIQUE INDEX IF NOT EXISTS owner_preferences_email_token_idx
  ON public.owner_preferences (email_unsubscribe_token);

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Only 43 of 182 owners have a preferences row at all, because the row is
-- created lazily the first time somebody edits a setting. Every owner we email
-- needs a token, and resolving that at send time would mean the sender doing
-- writes. Giving everyone a row now makes the token a plain indexed read.
--
-- Every column here takes its schema default, so this is a no-op behaviourally.
-- In particular quiet_hours_start/end are left NULL rather than filled with the
-- app's 22:00-07:00 display defaults: fallsInQuietWindow() treats NULL as "no
-- quiet hours", and writing real values would silently start suppressing pushes
-- for 139 owners who never asked for it.
INSERT INTO public.owner_preferences (owner_id)
SELECT u.id FROM auth.users u
ON CONFLICT (owner_id) DO NOTHING;

-- ── Delivery correlation ────────────────────────────────────────────────────
-- notification_history already carries expo_ticket_id for the push side. Email
-- needs the equivalent: Resend returns a message id at send time and quotes it
-- back in every webhook, and without somewhere to put it there is no way to
-- turn "delivered", "bounced" or "complained" into a fact about a specific row.
--
-- Not folded into expo_ticket_id. Two providers with different id formats in
-- one column is the kind of saving that reads fine today and is impossible to
-- query in six months.
ALTER TABLE public.notification_history
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT;

-- The webhook's only lookup key, and it arrives out of order and often.
CREATE INDEX IF NOT EXISTS notification_history_provider_msg_idx
  ON public.notification_history (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ── One-click unsubscribe (RFC 8058) ────────────────────────────────────────
--
-- Gmail and Yahoo require a machine-readable unsubscribe that works in a single
-- POST with no landing page and no auth. That means this function is reachable
-- by anon, so its safety rests on one property, enforced below rather than
-- assumed: it can only ever set a flag to FALSE. It cannot re-enable email, it
-- cannot read anything back about the owner, and it cannot touch any other
-- column. Re-subscribing requires a real authenticated session in the app.
--
-- Returns TRUE/FALSE only so the edge function can log a hit rate. The endpoint
-- itself must answer 200 either way — telling an unauthenticated caller whether
-- a token exists would turn this into an oracle.
CREATE OR REPLACE FUNCTION public.unsubscribe_email_by_token(
  p_token UUID,
  p_scope TEXT DEFAULT 'all'
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT owner_id INTO v_owner
    FROM owner_preferences
   WHERE email_unsubscribe_token = p_token;

  IF v_owner IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Note every branch sets FALSE and only FALSE. An unrecognised scope falls
  -- through to the global opt-out: if we cannot tell which list somebody meant
  -- to leave, the honest reading is all of them.
  UPDATE owner_preferences
     SET cat_email_digest   = CASE WHEN p_scope = 'digest'   THEN FALSE ELSE cat_email_digest   END,
         cat_email_insights = CASE WHEN p_scope = 'insights' THEN FALSE ELSE cat_email_insights END,
         cat_email_walk     = CASE WHEN p_scope = 'walk'     THEN FALSE ELSE cat_email_walk     END,
         cat_email_lifecycle= CASE WHEN p_scope = 'lifecycle'THEN FALSE ELSE cat_email_lifecycle END,
         email_enabled      = CASE
                                WHEN p_scope IN ('digest','insights','walk','lifecycle')
                                THEN email_enabled
                                ELSE FALSE
                              END,
         email_unsubscribed_at = COALESCE(email_unsubscribed_at, NOW()),
         updated_at = NOW()
   WHERE owner_id = v_owner;

  RETURN TRUE;
END;
$$;

-- anon is required: the one-click POST carries no session by design.
REVOKE ALL ON FUNCTION public.unsubscribe_email_by_token(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_email_by_token(UUID, TEXT)
  TO anon, authenticated, service_role;

-- ── Reach, measured ─────────────────────────────────────────────────────────
-- The email counterpart of notification_reach. The whole business case for this
-- channel is the gap between the two, so it should be one query to check that
-- the gap is still there and that opt-outs are not quietly eroding it.
CREATE OR REPLACE VIEW public.email_reach AS
  SELECT
    CASE
      WHEN u.email IS NULL                          THEN 'no_address'
      WHEN u.email_confirmed_at IS NULL             THEN 'unconfirmed'
      WHEN COALESCE(op.email_enabled, TRUE) IS FALSE THEN 'unsubscribed'
      ELSE 'reachable'
    END AS segment,
    count(*) AS users,
    count(*) FILTER (WHERE u.last_sign_in_at > NOW() - INTERVAL '30 days') AS active_30d
  FROM auth.users u
  LEFT JOIN owner_preferences op ON op.owner_id = u.id
  GROUP BY 1
  ORDER BY 2 DESC;

REVOKE ALL ON public.email_reach FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.email_reach TO service_role;

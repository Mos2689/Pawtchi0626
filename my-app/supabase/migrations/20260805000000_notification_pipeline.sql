-- Notification pipeline — foundations.
--
-- Audit (Aug 2026) found the push pipeline structurally unable to deliver:
--   * check-reminders / vet-checkins read `profiles.push_token`, a column that
--     has never existed. Tokens live in `push_tokens`.
--   * Nothing in the codebase reads Expo ticket/receipt responses, so dead
--     tokens accumulate forever and delivery was never observable.
--   * There is no timezone anywhere in the schema, so the dispatcher evaluated
--     every time-of-day rule against a hardcoded (and wrong) UTC offset.
--   * Cron authenticated with a publishable key against verify_jwt functions
--     and got a 401 on every run for months.
--
-- This migration adds the columns those fixes need, plus a fail-closed cron
-- secret that lives in Vault rather than being pasted into `cron.job` (which is
-- readable by anyone with database access).

-- ── Timezone ────────────────────────────────────────────────────────────────
-- On `profiles`, not `owner_preferences`: profiles is 1:1 with auth.users
-- (177/177 at time of writing) while owner_preferences covers only the users
-- who finished the routine step (42). The dispatcher needs a timezone for
-- everyone it might message.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN public.profiles.timezone IS
  'IANA timezone (e.g. Australia/Sydney) reported by the device. Drives all server-side send timing and quiet hours.';

-- ── Push tokens: lifecycle + platform ───────────────────────────────────────
ALTER TABLE public.push_tokens
  ADD COLUMN IF NOT EXISTS platform TEXT,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS disabled_reason TEXT;

COMMENT ON COLUMN public.push_tokens.disabled_at IS
  'Set by notify-receipts when Expo returns DeviceNotRegistered, or by data hygiene for malformed tokens. Disabled tokens are never sent to.';

-- register_push_token already relies on ON CONFLICT (token); make the
-- constraint explicit rather than incidental.
CREATE UNIQUE INDEX IF NOT EXISTS push_tokens_token_key
  ON public.push_tokens (token);

-- The dispatcher's hot path: "every live token for these users".
CREATE INDEX IF NOT EXISTS push_tokens_active_user_idx
  ON public.push_tokens (user_id)
  WHERE disabled_at IS NULL;

-- Retire the 7 rows that are JavaScript error strings stored as tokens (the
-- client bug that produced them is already fixed in usePushNotifications.ts).
-- Disabled rather than deleted so the corruption stays auditable — the effect
-- on sending is identical because every query filters on disabled_at.
UPDATE public.push_tokens
   SET disabled_at = NOW(),
       disabled_reason = 'malformed_token'
 WHERE token NOT LIKE 'ExponentPushToken%'
   AND disabled_at IS NULL;

-- Everything surviving that is a real, currently-trusted token.
UPDATE public.push_tokens
   SET last_seen_at = COALESCE(last_seen_at, updated_at, created_at)
 WHERE last_seen_at IS NULL;

-- ── Preferences: a real opt-out surface ─────────────────────────────────────
-- quiet_hours_start/end, nudge_lead_minutes and notification_intensity already
-- exist (20260624000000) but were only ever honoured by the *local* scheduler.
-- These add the master switch and per-category control the settings screen and
-- the server dispatcher both read.
ALTER TABLE public.owner_preferences
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_care_reminders BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_health_insights BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_milestones BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_digest BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS cat_lifecycle BOOLEAN NOT NULL DEFAULT TRUE;

-- ── notification_history becomes the delivery ledger ────────────────────────
-- It was a dedupe scratchpad ("did we send event X to user Y today?"). It now
-- also has to answer: did it arrive, was it opened, which campaign and variant,
-- and how many have we sent this week. Existing rows keep their meaning —
-- event_type and sent_date are untouched.
ALTER TABLE public.notification_history
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'push',
  ADD COLUMN IF NOT EXISTS campaign_key TEXT,
  ADD COLUMN IF NOT EXISTS variant TEXT,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS push_token TEXT,
  ADD COLUMN IF NOT EXISTS expo_ticket_id TEXT,
  ADD COLUMN IF NOT EXISTS receipt_status TEXT,
  ADD COLUMN IF NOT EXISTS receipt_error TEXT,
  ADD COLUMN IF NOT EXISTS receipt_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

-- Backfill sent_at for the 1353 historical rows so time-series reporting does
-- not start with a hole. created_at is when the send was recorded.
UPDATE public.notification_history
   SET sent_at = created_at
 WHERE sent_at IS NULL;

-- Frequency capping reads "everything sent to this user recently".
CREATE INDEX IF NOT EXISTS notification_history_user_sent_idx
  ON public.notification_history (user_id, sent_at DESC);

-- The dispatcher's idempotency guarantee: one row per (user, campaign, window).
--
-- Deliberately NOT a partial index. Postgres cannot infer an arbiter for
-- `ON CONFLICT (dedupe_key)` from a partial index unless the statement repeats
-- the predicate, and PostgREST's `on_conflict=` never does — the dispatcher's
-- claim-before-send upsert would fail on every run with "no unique or exclusion
-- constraint matching the ON CONFLICT specification".
--
-- A plain unique index is correct anyway: NULLs are distinct in Postgres, so
-- the 1,353 historical rows (all NULL here) coexist without conflict.
CREATE UNIQUE INDEX IF NOT EXISTS notification_history_dedupe_key
  ON public.notification_history (dedupe_key);

-- Receipt polling: "tickets we have not resolved yet".
CREATE INDEX IF NOT EXISTS notification_history_pending_receipt_idx
  ON public.notification_history (sent_at)
  WHERE expo_ticket_id IS NOT NULL AND receipt_status IS NULL;

-- ── Token registration ──────────────────────────────────────────────────────
-- Extends the existing RPC with platform + timezone. Defaults keep the old
-- one-argument call site working, so installs running the current build do not
-- break the moment this lands.
CREATE OR REPLACE FUNCTION public.register_push_token(
  push_token TEXT,
  platform TEXT DEFAULT NULL,
  timezone TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'register_push_token requires an authenticated session';
  END IF;

  -- Defend the table at the boundary. The client used to store thrown error
  -- strings here; a shape check means that can never silently recur.
  IF push_token IS NULL OR push_token NOT LIKE 'ExponentPushToken%' THEN
    RAISE EXCEPTION 'register_push_token: malformed token';
  END IF;

  INSERT INTO push_tokens (user_id, token, platform, last_seen_at)
  VALUES (auth.uid(), register_push_token.push_token, register_push_token.platform, NOW())
  ON CONFLICT (token) DO UPDATE
    SET user_id         = EXCLUDED.user_id,
        platform        = COALESCE(EXCLUDED.platform, push_tokens.platform),
        last_seen_at    = NOW(),
        updated_at      = NOW(),
        -- A token that just re-registered is demonstrably alive again; clear
        -- any DeviceNotRegistered mark from a previous uninstall.
        disabled_at     = NULL,
        disabled_reason = NULL;

  IF register_push_token.timezone IS NOT NULL THEN
    UPDATE profiles
       SET timezone = register_push_token.timezone,
           updated_at = NOW()
     WHERE id = auth.uid();
  END IF;
END;
$$;

-- ── Cron authentication ─────────────────────────────────────────────────────
-- The old scheme sent `Bearer sb_publishable_...` — a publishable key, not a
-- JWT — to verify_jwt functions, which 401'd every run. Replacement: cron-only
-- functions run with verify_jwt disabled and prove themselves with a shared
-- secret held in Vault. The secret never appears in the cron command text.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'cron_secret') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'cron_secret',
      'Shared secret proving a request to a cron-only edge function came from pg_cron.'
    );
  END IF;
END;
$$;

-- Edge functions call this with the service-role key. Fail-closed: any NULL,
-- any mismatch, any missing secret returns false. Constant-time-ish comparison
-- avoids leaking the secret through response timing.
CREATE OR REPLACE FUNCTION public.verify_cron_secret(candidate TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  expected TEXT;
BEGIN
  IF candidate IS NULL OR length(candidate) = 0 THEN
    RETURN FALSE;
  END IF;

  SELECT decrypted_secret INTO expected
    FROM vault.decrypted_secrets
   WHERE name = 'cron_secret'
   LIMIT 1;

  IF expected IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN hashtext(candidate) = hashtext(expected) AND candidate = expected;
END;
$$;

-- Only the service role may ask. Nothing client-facing can probe this.
REVOKE ALL ON FUNCTION public.verify_cron_secret(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_cron_secret(TEXT) TO service_role;

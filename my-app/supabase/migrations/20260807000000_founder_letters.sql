-- Write to the Founder — a direct line from an owner to the person who makes
-- the app.
--
-- This is deliberately NOT a support-ticket schema. There are no categories,
-- no tags, no status enum, no priority, no assignee. The moment a letter has a
-- dropdown it stops being a letter, and the entire emotional effect of the
-- feature is gone. One body of prose in, one reply out.
--
-- The reply is the point. Sending a letter is a one-off act; a reply arriving
-- days later is a return visit, which is why `founder_letter_replies` carries
-- its own delivery state (`push_sent_at`) and read state (`read_at`).

CREATE TABLE IF NOT EXISTS founder_letters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Captured so a reply can name the animal — the single biggest reason this
  -- lands harder for Pawtchi than for a food-delivery app. SET NULL rather than
  -- CASCADE: losing a pet must never silently delete what its owner wrote.
  pet_id UUID REFERENCES pets(id) ON DELETE SET NULL,

  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),

  -- Which door they came through. The whole point of instrumenting this is to
  -- learn whether the Home Screen quick action is worth its native-build cost.
  entry_source TEXT NOT NULL DEFAULT 'profile'
    CHECK (entry_source IN ('quick_action', 'profile', 'cancel_intent')),

  app_version TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS founder_letter_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  letter_id UUID NOT NULL REFERENCES founder_letters(id) ON DELETE CASCADE,

  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  -- Stamped when the owner opens the thread.
  read_at TIMESTAMP WITH TIME ZONE,
  -- Stamped by notify-dispatch. NULL means "still owed a push"; the dispatcher
  -- selects on exactly this, so it is also the de-dupe guard.
  push_sent_at TIMESTAMP WITH TIME ZONE
);

-- One reply per letter for v1. A back-and-forth thread is a different product
-- with different expectations, and this constraint is the cheapest way to stop
-- us drifting into it by accident.
CREATE UNIQUE INDEX IF NOT EXISTS idx_founder_letter_replies_one_per_letter
  ON founder_letter_replies (letter_id);

CREATE INDEX IF NOT EXISTS idx_founder_letters_owner_created
  ON founder_letters (owner_id, created_at DESC);

-- Drives the dispatcher's "who is owed a push" pass. Partial, because the rows
-- it needs are always the small unsent minority.
CREATE INDEX IF NOT EXISTS idx_founder_letter_replies_unsent
  ON founder_letter_replies (created_at)
  WHERE push_sent_at IS NULL;

ALTER TABLE founder_letters ENABLE ROW LEVEL SECURITY;
ALTER TABLE founder_letter_replies ENABLE ROW LEVEL SECURITY;

-- Owners read their own letters. They do NOT insert directly — every write goes
-- through submit_founder_letter() so the rate cap cannot be bypassed by talking
-- to PostgREST directly.
CREATE POLICY "owner_can_read_own_letters" ON founder_letters
  FOR SELECT
  USING (owner_id = auth.uid());

-- Read-only, and only for replies to letters they wrote. There is deliberately
-- no INSERT or UPDATE policy: an owner must never be able to forge a reply
-- that appears to come from the founder. Writes are service-role only, which
-- bypasses RLS.
CREATE POLICY "owner_can_read_replies_to_own_letters" ON founder_letter_replies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM founder_letters l
      WHERE l.id = founder_letter_replies.letter_id
        AND l.owner_id = auth.uid()
    )
  );

-- ── Submission ──────────────────────────────────────────────────────────────
-- The cap is the operational half of the promise. The screen says the founder
-- reads every letter; that stays true only while volume per person is bounded,
-- so it is enforced here rather than in the client where it is advisory at best.
CREATE OR REPLACE FUNCTION public.submit_founder_letter(
  p_body TEXT,
  p_entry_source TEXT DEFAULT 'profile',
  p_pet_id UUID DEFAULT NULL,
  p_app_version TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
  v_recent INTEGER;
  v_id UUID;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  IF char_length(btrim(coalesce(p_body, ''))) = 0 THEN
    RAISE EXCEPTION 'empty_body' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_recent
  FROM founder_letters
  WHERE owner_id = v_owner
    AND created_at > TIMEZONE('utc', NOW()) - INTERVAL '24 hours';

  IF v_recent >= 3 THEN
    RAISE EXCEPTION 'daily_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  -- Trimmed and truncated defensively: the client enforces 2000 too, but the
  -- client is not a security boundary.
  INSERT INTO founder_letters (owner_id, pet_id, body, entry_source, app_version)
  VALUES (
    v_owner,
    p_pet_id,
    left(btrim(p_body), 2000),
    coalesce(p_entry_source, 'profile'),
    p_app_version
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Read receipts ───────────────────────────────────────────────────────────
-- Owners have no UPDATE policy on replies (by design), so marking one read has
-- to run definer-side. Scoped to letters the caller actually wrote.
CREATE OR REPLACE FUNCTION public.mark_founder_reply_read(p_letter_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner UUID := auth.uid();
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  UPDATE founder_letter_replies r
  SET read_at = TIMEZONE('utc', NOW())
  FROM founder_letters l
  WHERE r.letter_id = l.id
    AND l.id = p_letter_id
    AND l.owner_id = v_owner
    AND r.read_at IS NULL;
END;
$$;

-- ── Reply delivery ──────────────────────────────────────────────────────────
-- Everything notify-dispatch needs to push "you have a reply", shaped like
-- get_notification_candidates() so the dispatcher can treat both the same way.
--
-- This is a separate pass rather than a new rule because a founder reply is
-- event-driven, not rule-derived: the owner may not appear in the candidate set
-- at all (no pet, gone quiet, capped out), and none of that should stop a reply
-- to something they personally wrote from reaching them.
--
-- push_enabled is honoured — an owner who turned pushes off entirely still
-- means it — but the per-category toggles are not consulted. There is no
-- category for this, deliberately: see CAMPAIGN_CATEGORY in copy.ts.
CREATE OR REPLACE FUNCTION public.get_founder_reply_pushes()
RETURNS TABLE (
  user_id UUID,
  letter_id UUID,
  reply_id UUID,
  tokens TEXT[],
  timezone TEXT,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH live_tokens AS (
    SELECT pt.user_id, array_agg(pt.token ORDER BY pt.last_seen_at DESC NULLS LAST) AS tokens
      FROM push_tokens pt
     WHERE pt.disabled_at IS NULL
       AND pt.token LIKE 'ExponentPushToken%'
     GROUP BY pt.user_id
  )
  SELECT
    l.owner_id,
    l.id,
    r.id,
    lt.tokens,
    pr.timezone,
    op.quiet_hours_start::TEXT,
    op.quiet_hours_end::TEXT
  FROM founder_letter_replies r
  JOIN founder_letters l ON l.id = r.letter_id
  JOIN live_tokens lt    ON lt.user_id = l.owner_id
  LEFT JOIN profiles pr  ON pr.id = l.owner_id
  LEFT JOIN owner_preferences op ON op.owner_id = l.owner_id
  WHERE r.push_sent_at IS NULL
    AND COALESCE(op.push_enabled, TRUE) IS TRUE;
$$;

-- Called only after Expo accepted the ticket, so a send failure leaves the row
-- eligible for the next run rather than silently swallowing the reply.
CREATE OR REPLACE FUNCTION public.mark_founder_replies_pushed(p_ids UUID[])
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE founder_letter_replies
     SET push_sent_at = TIMEZONE('utc', NOW())
   WHERE id = ANY(p_ids)
     AND push_sent_at IS NULL;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
-- PostgREST exposes every public function to `anon` by default; both of these
-- require a session, so anon should not reach them at all.
REVOKE ALL ON FUNCTION public.submit_founder_letter(TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_founder_letter(TEXT, TEXT, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_founder_reply_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_founder_reply_read(UUID) TO authenticated;

-- Dispatcher-only. Nothing client-side has any business reading other people's
-- delivery state or stamping it as sent.
REVOKE ALL ON FUNCTION public.get_founder_reply_pushes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_founder_reply_pushes() TO service_role;

REVOKE ALL ON FUNCTION public.mark_founder_replies_pushed(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_founder_replies_pushed(UUID[]) TO service_role;

COMMENT ON TABLE founder_letters IS
  'Owner-written letters to the founder. Inserts go through submit_founder_letter() only, so the 3-per-24h cap cannot be bypassed via PostgREST.';
COMMENT ON TABLE founder_letter_replies IS
  'Founder replies. Service-role write only — no client INSERT/UPDATE policy exists, so a reply can never be forged by the owner it is addressed to.';

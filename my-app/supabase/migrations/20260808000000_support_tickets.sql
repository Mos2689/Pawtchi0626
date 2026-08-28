-- Pawtchi Support v1 — the structured channel.
--
-- This is the sibling of founder_letters, not an extension of it. That file
-- says, emphatically, that a letter must never grow a dropdown; this table is
-- where the dropdowns are allowed to live. The split is the whole design:
--
--   founder_letters  "here's what I think"  → named humans, no structure,
--                                             nothing about the pet attached
--   support_tickets  "something is wrong"   → the Pawtchi team, one topic +
--                                             one area, full diagnostics
--
-- Keeping them apart is what lets the letter stay a letter. Merging them with a
-- `kind` column would have been fewer lines and would have quietly destroyed the
-- feature the comment in founder_letters.sql exists to protect.
--
-- Structurally this mirrors founder_letters closely on purpose — that shape is
-- proven in this codebase (RLS via SECURITY DEFINER RPC, service-role-only
-- replies, a push pass shaped for notify-dispatch). Four things differ, and each
-- one is a deliberate bet on Phase 2:
--
--   1. `status` ships now and is never rendered in v1. The Phase 2 status chip
--      becomes a UI change rather than a migration on a table with live rows.
--   2. There is NO one-reply-per-ticket unique index. founder_letters has one
--      (deliberately capping the exchange at a single reply); support is a
--      conversation waiting to happen, so the data model already allows it.
--   3. `diagnostics` is JSONB, not columns. New diagnostic fields must never
--      require a migration — the client will grow them faster than the schema.
--   4. `topic` / `area` are TEXT + CHECK, not PG enums. Adding a value is a
--      one-line migration; ALTER TYPE ... ADD VALUE is not, and cannot run in a
--      transaction alongside the rest of a deploy.

CREATE TABLE IF NOT EXISTS support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- SET NULL rather than CASCADE, for the same reason as founder_letters: losing
  -- a pet must never silently delete what their owner reported.
  pet_id UUID REFERENCES pets(id) ON DELETE SET NULL,

  topic TEXT NOT NULL CHECK (topic IN ('bug', 'question')),

  -- The single structured field the owner touches, and it arrives pre-selected.
  -- 'other' is always available so nobody is ever forced to mis-file.
  area TEXT NOT NULL DEFAULT 'other'
    CHECK (area IN ('meals', 'walks', 'health', 'notifications', 'subscription', 'other')),

  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 2000),

  -- Never shown to the owner in v1. A status they cannot influence is anxiety,
  -- not information — but the team needs it from day one to work a queue.
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'answered', 'closed')),

  -- Everything the client knew at submit time: app version, OS, device, screen,
  -- error kind/context, subscription state, and a breadcrumb trail of recent
  -- event NAMES (never their props — see lib/support/breadcrumbs.ts).
  diagnostics JSONB,

  -- Storage object path in the private `support-attachments` bucket. NULL is
  -- the common case; the text is the payload and the screenshot is a bonus.
  attachment_path TEXT,

  entry_source TEXT NOT NULL DEFAULT 'profile'
    CHECK (entry_source IN ('profile', 'error_state', 'paywall', 'billing_row', 'deep_link')),

  -- Stamped by notify-dispatch once the team's digest email naming this ticket
  -- has actually been accepted. NULL means "still owed a mention", so the
  -- dispatcher selects on exactly this.
  --
  -- A watermark column rather than a "tickets since <timestamp>" query, for the
  -- same reason founder_letter_replies.push_sent_at is one: it is self-healing.
  -- If a run crashes between reading and emailing, the rows stay NULL and the
  -- next run picks them up. A timestamp watermark advanced on read would lose
  -- them silently, which for a support inbox means a person who wrote in and
  -- never heard back.
  team_notified_at TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE IF NOT EXISTS support_ticket_replies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,

  body TEXT NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  -- Stamped when the owner opens the thread.
  read_at TIMESTAMP WITH TIME ZONE,
  -- Stamped by notify-dispatch. NULL means "still owed a push"; the dispatcher
  -- selects on exactly this, so it doubles as the de-dupe guard.
  push_sent_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_owner_created
  ON support_tickets (owner_id, created_at DESC);

-- The team's queue: everything still owed an answer, oldest first. Partial,
-- because a healthy inbox is a small slice of the table.
CREATE INDEX IF NOT EXISTS idx_support_tickets_open
  ON support_tickets (created_at)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_ticket
  ON support_ticket_replies (ticket_id, created_at);

-- Drives the dispatcher's "who is owed a push" pass.
CREATE INDEX IF NOT EXISTS idx_support_ticket_replies_unsent
  ON support_ticket_replies (created_at)
  WHERE push_sent_at IS NULL;

-- Drives the dispatcher's "what has the team not been told about" pass.
CREATE INDEX IF NOT EXISTS idx_support_tickets_unnotified
  ON support_tickets (created_at)
  WHERE team_notified_at IS NULL;

ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_ticket_replies ENABLE ROW LEVEL SECURITY;

-- Owners read their own tickets. They do NOT insert directly — every write goes
-- through submit_support_ticket() so the daily cap cannot be bypassed by talking
-- to PostgREST directly.
CREATE POLICY "owner_can_read_own_tickets" ON support_tickets
  FOR SELECT
  USING (owner_id = auth.uid());

-- Read-only, and only for replies to tickets they opened. There is deliberately
-- no INSERT or UPDATE policy: an owner must never be able to forge a reply that
-- appears to come from the Pawtchi team. Writes are service-role only, which
-- bypasses RLS. This is the single most important policy in the file — a
-- forgeable support reply would be worse than having no support system at all.
CREATE POLICY "owner_can_read_replies_to_own_tickets" ON support_ticket_replies
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM support_tickets t
      WHERE t.id = support_ticket_replies.ticket_id
        AND t.owner_id = auth.uid()
    )
  );

-- ── Submission ──────────────────────────────────────────────────────────────
-- The cap is the operational half of the promise. The confirmation screen says
-- someone answers within two business days; that stays true only while volume
-- per person is bounded. Five is deliberately looser than the letter's three —
-- a person chasing a real bug may legitimately need more than one attempt, and
-- rate-limiting someone who cannot use the app is the wrong instinct.
CREATE OR REPLACE FUNCTION public.submit_support_ticket(
  p_body TEXT,
  p_topic TEXT,
  p_area TEXT DEFAULT 'other',
  p_entry_source TEXT DEFAULT 'profile',
  p_pet_id UUID DEFAULT NULL,
  p_diagnostics JSONB DEFAULT NULL,
  p_attachment_path TEXT DEFAULT NULL
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

  IF coalesce(p_topic, '') NOT IN ('bug', 'question') THEN
    RAISE EXCEPTION 'invalid_topic' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(*) INTO v_recent
  FROM support_tickets
  WHERE owner_id = v_owner
    AND created_at > TIMEZONE('utc', NOW()) - INTERVAL '24 hours';

  IF v_recent >= 5 THEN
    RAISE EXCEPTION 'daily_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  -- Trimmed and truncated defensively: the client enforces 2000 too, but the
  -- client is not a security boundary.
  --
  -- Unrecognised area / entry_source values fall back rather than raising. A
  -- stale build sending an area this migration has not heard of should still
  -- get its bug report through; losing the report to protect a taxonomy field
  -- would be exactly the wrong trade.
  INSERT INTO support_tickets (
    owner_id, pet_id, topic, area, body, entry_source, diagnostics, attachment_path
  )
  VALUES (
    v_owner,
    p_pet_id,
    p_topic,
    CASE
      WHEN p_area IN ('meals', 'walks', 'health', 'notifications', 'subscription', 'other')
        THEN p_area
      ELSE 'other'
    END,
    left(btrim(p_body), 2000),
    CASE
      WHEN p_entry_source IN ('profile', 'error_state', 'paywall', 'billing_row', 'deep_link')
        THEN p_entry_source
      ELSE 'profile'
    END,
    p_diagnostics,
    p_attachment_path
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Attach a screenshot after the fact. The upload can only start once the ticket
-- id exists (it is part of the object path), so this is a second step by
-- necessity. Scoped to the caller's own ticket, and refuses to overwrite an
-- attachment that is already set.
CREATE OR REPLACE FUNCTION public.attach_support_screenshot(
  p_ticket_id UUID,
  p_path TEXT
)
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

  UPDATE support_tickets
     SET attachment_path = p_path
   WHERE id = p_ticket_id
     AND owner_id = v_owner
     AND attachment_path IS NULL;
END;
$$;

-- ── Read receipts ───────────────────────────────────────────────────────────
-- Owners have no UPDATE policy on replies (by design), so marking one read has
-- to run definer-side. Scoped to tickets the caller actually opened.
CREATE OR REPLACE FUNCTION public.mark_support_reply_read(p_ticket_id UUID)
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

  UPDATE support_ticket_replies r
  SET read_at = TIMEZONE('utc', NOW())
  FROM support_tickets t
  WHERE r.ticket_id = t.id
    AND t.id = p_ticket_id
    AND t.owner_id = v_owner
    AND r.read_at IS NULL;
END;
$$;

-- ── Reply delivery ──────────────────────────────────────────────────────────
-- Shaped exactly like get_founder_reply_pushes() so notify-dispatch can run
-- both passes through the same code path.
--
-- push_enabled is honoured — an owner who turned pushes off entirely still
-- means it — but the per-category toggles are not consulted. A reply to a
-- question you personally asked is not a campaign you can unsubscribe from.
CREATE OR REPLACE FUNCTION public.get_support_reply_pushes()
RETURNS TABLE (
  user_id UUID,
  ticket_id UUID,
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
    t.owner_id,
    t.id,
    r.id,
    lt.tokens,
    pr.timezone,
    op.quiet_hours_start::TEXT,
    op.quiet_hours_end::TEXT
  FROM support_ticket_replies r
  JOIN support_tickets t ON t.id = r.ticket_id
  JOIN live_tokens lt    ON lt.user_id = t.owner_id
  LEFT JOIN profiles pr  ON pr.id = t.owner_id
  LEFT JOIN owner_preferences op ON op.owner_id = t.owner_id
  WHERE r.push_sent_at IS NULL
    AND COALESCE(op.push_enabled, TRUE) IS TRUE;
$$;

-- Called only after Expo accepted the ticket, so a send failure leaves the row
-- eligible for the next run rather than silently swallowing the reply.
CREATE OR REPLACE FUNCTION public.mark_support_replies_pushed(p_ids UUID[])
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE support_ticket_replies
     SET push_sent_at = TIMEZONE('utc', NOW())
   WHERE id = ANY(p_ids)
     AND push_sent_at IS NULL;
$$;

-- ── Team inbox ──────────────────────────────────────────────────────────────
-- Everything the team has not been told about yet, for the digest email
-- notify-dispatch sends. Returns the owner's email so a reply can be written
-- without a second lookup, and truncates the body — the digest is a nudge to go
-- and read the row, not a replacement for reading it.
CREATE OR REPLACE FUNCTION public.get_unnotified_support_tickets()
RETURNS TABLE (
  id UUID,
  topic TEXT,
  area TEXT,
  body_preview TEXT,
  owner_email TEXT,
  app_version TEXT,
  platform TEXT,
  has_attachment BOOLEAN,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id,
    t.topic,
    t.area,
    left(t.body, 280),
    u.email::TEXT,
    t.diagnostics ->> 'app_version',
    t.diagnostics ->> 'os',
    t.attachment_path IS NOT NULL,
    t.created_at
  FROM support_tickets t
  LEFT JOIN auth.users u ON u.id = t.owner_id
  WHERE t.team_notified_at IS NULL
  ORDER BY t.created_at ASC
  LIMIT 50;
$$;

-- Called only after the digest email was accepted, so a send failure leaves the
-- rows eligible for the next run rather than losing them.
CREATE OR REPLACE FUNCTION public.mark_support_tickets_notified(p_ids UUID[])
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE support_tickets
     SET team_notified_at = TIMEZONE('utc', NOW())
   WHERE id = ANY(p_ids)
     AND team_notified_at IS NULL;
$$;

-- ── Attachments ─────────────────────────────────────────────────────────────
-- Private bucket. Objects are keyed {owner_id}/{ticket_id}.jpg, so the first
-- path segment is the authorisation check.
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', FALSE)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "owner_can_upload_own_support_attachment" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'support-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

CREATE POLICY "owner_can_read_own_support_attachment" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'support-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

-- ── Grants ──────────────────────────────────────────────────────────────────
-- PostgREST exposes every public function to `anon` by default; all of these
-- require a session, so anon should not reach them at all.
REVOKE ALL ON FUNCTION public.submit_support_ticket(TEXT, TEXT, TEXT, TEXT, UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_support_ticket(TEXT, TEXT, TEXT, TEXT, UUID, JSONB, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.attach_support_screenshot(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_support_screenshot(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.mark_support_reply_read(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_support_reply_read(UUID) TO authenticated;

-- Dispatcher-only. Nothing client-side has any business reading other people's
-- delivery state, stamping it as sent, or listing the team's inbox.
REVOKE ALL ON FUNCTION public.get_support_reply_pushes() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_support_reply_pushes() TO service_role;

REVOKE ALL ON FUNCTION public.mark_support_replies_pushed(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_support_replies_pushed(UUID[]) TO service_role;

REVOKE ALL ON FUNCTION public.get_unnotified_support_tickets() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unnotified_support_tickets() TO service_role;

REVOKE ALL ON FUNCTION public.mark_support_tickets_notified(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_support_tickets_notified(UUID[]) TO service_role;

-- ── Letter entry source ─────────────────────────────────────────────────────
-- The support hub's third door ("Share an idea") hands off to the founder
-- letter, which is a better home for a feature request than any form. That door
-- needs its own entry_source so the hand-off is measurable, and the existing
-- CHECK constraint does not know about it yet.
ALTER TABLE founder_letters DROP CONSTRAINT IF EXISTS founder_letters_entry_source_check;
ALTER TABLE founder_letters ADD CONSTRAINT founder_letters_entry_source_check
  CHECK (entry_source IN ('quick_action', 'profile', 'cancel_intent', 'support'));

COMMENT ON TABLE support_tickets IS
  'Structured support requests. The sibling of founder_letters: this is where topics, areas and diagnostics are allowed to live, so the letter never needs them. Inserts go through submit_support_ticket() only, so the 5-per-24h cap cannot be bypassed via PostgREST.';
COMMENT ON TABLE support_ticket_replies IS
  'Pawtchi team replies. Service-role write only — no client INSERT/UPDATE policy exists, so a reply can never be forged by the owner it is addressed to. Deliberately has NO one-per-ticket unique index (unlike founder_letter_replies): multi-turn threads are a Phase 2 UI change, not a migration.';

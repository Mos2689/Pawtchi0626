-- Admin access for the support/letters panel at admin.pawtchi.com.
--
-- ── The constraint that shapes this whole file ──────────────────────────────
--
-- The panel is a static Vite bundle on Vercel. A static bundle ships to the
-- browser, so it can only ever hold the ANON key — the service_role key in
-- that build would be a full database compromise readable from view-source.
--
-- Therefore admin permission cannot live in the frontend. Hiding a route, or
-- checking a flag in React, is not access control: anyone can call PostgREST
-- directly with the same anon key. The gate has to be RLS, which is what this
-- migration adds.
--
-- ── The guarantee that must survive ─────────────────────────────────────────
--
-- support_ticket_replies and founder_letter_replies currently have NO INSERT
-- policy at all. That is what makes a forged reply impossible: an owner cannot
-- manufacture a message that appears to come from us. This migration adds an
-- INSERT policy scoped to `is_admin()`, which leaves that guarantee exactly
-- where it was for everyone else — a non-admin still matches no INSERT policy
-- and is still refused. The verification for this migration re-runs the same
-- forgery test that was run when the tables were created.
--
-- Policies on a table are OR'd together, so each admin policy added below
-- widens access for admins only; the existing owner-scoped policies are
-- untouched and keep working as they did.

-- ── Who is an admin ─────────────────────────────────────────────────────────
-- An explicit allowlist table rather than a boolean on `profiles`. Two reasons:
-- profiles is a row users can already write to for their own id, so a flag
-- there is a privilege-escalation surface a policy bug could open; and a
-- separate table makes "who can read every support request in the database"
-- a single, auditable list.
CREATE TABLE IF NOT EXISTS admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  note TEXT,
  added_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Deliberately NO policies. RLS with no policy denies everything, so this table
-- is unreadable and unwritable from any client, with or without a session.
-- Membership is granted from the dashboard (service role) only — an admin list
-- that an admin can edit from the browser is one compromised session away from
-- being permanent.

COMMENT ON TABLE admin_users IS
  'Allowlist of accounts that may read every support ticket and founder letter and write replies. Service-role managed only: RLS is enabled with no policies, so no client can read or modify it.';

-- ── The gate ────────────────────────────────────────────────────────────────
-- SECURITY DEFINER so it can read admin_users (which no client can). STABLE so
-- Postgres evaluates it once per statement rather than per row — this sits in
-- the USING clause of every policy below, and a VOLATILE function there would
-- re-run for every row scanned.
--
-- Safe to expose to `authenticated`: it takes no argument and reports only on
-- auth.uid(), so a caller can learn whether they themselves are an admin and
-- nothing else.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users a WHERE a.user_id = auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ── Support tickets ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_can_read_all_tickets" ON support_tickets;
CREATE POLICY "admin_can_read_all_tickets" ON support_tickets
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Only the triage fields are meant to move from the panel. There is no column
-- allowlist in RLS, so this is enforced by the panel writing status alone; the
-- body is never editable in the UI. Rewriting what someone reported would be
-- indefensible, so it must not become a feature by accident.
DROP POLICY IF EXISTS "admin_can_update_ticket_status" ON support_tickets;
CREATE POLICY "admin_can_update_ticket_status" ON support_tickets
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_can_read_all_ticket_replies" ON support_ticket_replies;
CREATE POLICY "admin_can_read_all_ticket_replies" ON support_ticket_replies
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- The one that replaces service-role-only writes. Non-admins match no INSERT
-- policy and are still refused, so reply forgery remains impossible.
DROP POLICY IF EXISTS "admin_can_write_ticket_replies" ON support_ticket_replies;
CREATE POLICY "admin_can_write_ticket_replies" ON support_ticket_replies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ── Founder letters ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "admin_can_read_all_letters" ON founder_letters;
CREATE POLICY "admin_can_read_all_letters" ON founder_letters
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_can_read_all_letter_replies" ON founder_letter_replies;
CREATE POLICY "admin_can_read_all_letter_replies" ON founder_letter_replies
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_can_write_letter_replies" ON founder_letter_replies;
CREATE POLICY "admin_can_write_letter_replies" ON founder_letter_replies
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

-- ── Attachments ─────────────────────────────────────────────────────────────
-- Screenshots are the point of allowing attachments at all; an admin who cannot
-- open them is back to asking the owner to describe what they already sent.
DROP POLICY IF EXISTS "admin_can_read_support_attachments" ON storage.objects;
CREATE POLICY "admin_can_read_support_attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'support-attachments' AND public.is_admin());

-- ── Reading the queue ───────────────────────────────────────────────────────
-- The panel needs the owner's email to know who it is talking to, and auth.users
-- is not reachable through PostgREST. Rather than exposing that table, this
-- returns just the addresses for a given set of ids, admin-gated inside the
-- function so the grant to `authenticated` cannot be abused by a normal user.
CREATE OR REPLACE FUNCTION public.admin_emails_for(p_ids UUID[])
RETURNS TABLE (user_id UUID, email TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
    SELECT u.id, u.email::TEXT
    FROM auth.users u
    WHERE u.id = ANY(p_ids);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_emails_for(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_emails_for(UUID[]) TO authenticated;

-- ── Replying, as one action ─────────────────────────────────────────────────
-- Writing the reply and marking the ticket answered belong together: done
-- separately, a crash between them leaves a reply that is sent but still shows
-- as open, so it gets answered twice.
--
-- Admin-gated inside the function as well as by the policies, because a
-- SECURITY DEFINER function is its own trust boundary and should not rely on
-- the caller having come through a policy first.
CREATE OR REPLACE FUNCTION public.admin_reply_to_ticket(
  p_ticket_id UUID,
  p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reply UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) = 0 THEN
    RAISE EXCEPTION 'empty_body' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM support_tickets WHERE id = p_ticket_id) THEN
    RAISE EXCEPTION 'ticket_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO support_ticket_replies (ticket_id, body)
  VALUES (p_ticket_id, btrim(p_body))
  RETURNING id INTO v_reply;

  UPDATE support_tickets SET status = 'answered' WHERE id = p_ticket_id;

  -- push_sent_at stays NULL, which is what makes notify-dispatch deliver it.
  RETURN v_reply;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reply_to_ticket(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reply_to_ticket(UUID, TEXT) TO authenticated;

-- The letter equivalent. founder_letter_replies has a UNIQUE index on
-- letter_id — one reply per letter, on purpose — so a second attempt raises
-- unique_violation and is translated into something the panel can show calmly
-- rather than surfacing a constraint name to a human.
CREATE OR REPLACE FUNCTION public.admin_reply_to_letter(
  p_letter_id UUID,
  p_body TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reply UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF char_length(btrim(coalesce(p_body, ''))) = 0 THEN
    RAISE EXCEPTION 'empty_body' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM founder_letters WHERE id = p_letter_id) THEN
    RAISE EXCEPTION 'letter_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM founder_letter_replies WHERE letter_id = p_letter_id) THEN
    RAISE EXCEPTION 'already_replied' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO founder_letter_replies (letter_id, body)
  VALUES (p_letter_id, btrim(p_body))
  RETURNING id INTO v_reply;

  RETURN v_reply;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reply_to_letter(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reply_to_letter(UUID, TEXT) TO authenticated;

-- ── Telling the team a letter arrived ───────────────────────────────────────
-- Founder letters have had no inbound notification since they shipped: a letter
-- landed in a table and sat there until somebody thought to look. That quietly
-- breaks the promise printed on the letter screen ("We read every letter that
-- comes through here"), and it is worst exactly where it matters most — the
-- cancel-intent letters, which are the highest-signal churn feedback there is.
--
-- A panel alone does not fix this, because a panel you have to remember to open
-- is the same failure with extra steps. Same self-healing watermark as
-- support_tickets.team_notified_at.
ALTER TABLE founder_letters
  ADD COLUMN IF NOT EXISTS team_notified_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_founder_letters_unnotified
  ON founder_letters (created_at)
  WHERE team_notified_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_unnotified_founder_letters()
RETURNS TABLE (
  id UUID,
  body_preview TEXT,
  owner_email TEXT,
  entry_source TEXT,
  app_version TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    left(l.body, 280),
    u.email::TEXT,
    l.entry_source,
    l.app_version,
    l.created_at
  FROM founder_letters l
  LEFT JOIN auth.users u ON u.id = l.owner_id
  WHERE l.team_notified_at IS NULL
  ORDER BY l.created_at ASC
  LIMIT 50;
$$;

CREATE OR REPLACE FUNCTION public.mark_founder_letters_notified(p_ids UUID[])
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE founder_letters
     SET team_notified_at = TIMEZONE('utc', NOW())
   WHERE id = ANY(p_ids)
     AND team_notified_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_unnotified_founder_letters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_unnotified_founder_letters() TO service_role;

REVOKE ALL ON FUNCTION public.mark_founder_letters_notified(UUID[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_founder_letters_notified(UUID[]) TO service_role;

-- ── No seed, deliberately ───────────────────────────────────────────────────
-- This migration grants the *capability* for an admin to exist. It grants
-- nobody access: admin_users ships empty, so is_admin() is false for every
-- account in the database and every policy above evaluates to false.
--
-- Naming the first admin is a separate, deliberate act, because "who may read
-- every support request and every private letter in the database" is a decision
-- that deserves to be made explicitly rather than inherited from whichever
-- account a migration author happened to pick. Grant it with:
--
--   INSERT INTO admin_users (user_id, note)
--   SELECT id, 'why this person'
--   FROM auth.users WHERE email = '<the address>'
--   ON CONFLICT (user_id) DO NOTHING;
--
-- Revoke just as explicitly:
--
--   DELETE FROM admin_users WHERE user_id =
--     (SELECT id FROM auth.users WHERE email = '<the address>');
--
-- Both are service-role only — admin_users has RLS on and no policies, so this
-- can only be run from the dashboard or another service-role context. An admin
-- cannot promote anyone, including themselves.

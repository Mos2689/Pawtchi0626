-- Can this username be claimed, asked BEFORE an account exists?
--
-- ── Why a second function ────────────────────────────────────────────────────
--
-- Sign-up v2 (app/(auth)/signup.tsx) asks for the username on its last screen,
-- before "Create account". community_username_available (20260921000000)
-- answers only signed-in callers — auth.uid() IS NULL returns NULL — and is
-- not granted to anon, so on that screen it can never say anything. The
-- founder wants the same live "free / taken" answer the old screen gave
-- (25 Oct 2026), so this is that answer for a caller who has no account yet.
--
-- The signed-in function is left exactly as it is: it still treats your own
-- current username as available, which only makes sense for someone who has
-- one. This function has no "own name" case because the caller has no name.
--
-- ── What it returns ──────────────────────────────────────────────────────────
--
-- TRUE  — nothing holds it; the unique index will accept it.
-- FALSE — somebody has it.
-- NULL  — not a well-formed username. The client treats NULL as "unknown",
--         never as "available"; the unique index still decides at claim time
--         (onboarding/finish recovers if someone takes it in between).
--
-- ── The privacy trade, stated plainly ────────────────────────────────────────
--
-- Granted to anon, so anyone can ask whether an exact handle exists without
-- signing in. It returns a bare boolean — no id, no name, no avatar, no dogs —
-- and cannot list or search: you must already know the exact string, and
-- "taken" says nothing about whose it is. Usernames are already shown to
-- connections and on invite links. Accepted by the founder as the cost of a
-- live check on the sign-up screen.
--
-- Rollback: supabase/rollbacks/20261025000000_signup_username_available.down.sql

CREATE OR REPLACE FUNCTION public.signup_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN lower(trim(leading '@' from trim(coalesce(p_username, '')))) !~ '^[a-z0-9_]{3,24}$'
      THEN NULL
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE lower(pr.username) = lower(trim(leading '@' from trim(p_username)))
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.signup_username_available(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.signup_username_available(TEXT) TO anon, authenticated;

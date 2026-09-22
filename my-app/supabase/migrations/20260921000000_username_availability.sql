-- Can this username be claimed? Answered as a bare boolean, nothing else.
--
-- ── Why lookup_community_username cannot do this job ─────────────────────────
--
-- It is the obvious candidate and it is wrong on three counts, each of which
-- would ship a bug:
--
--   1. It is rate limited to 30 calls an hour and writes an audit row per call.
--      A field that checks as you type would burn a person's whole hour of
--      lookups picking one name, and then "invite someone you know" — the
--      feature that limit exists to protect — would fail for an hour.
--   2. It excludes `pr.id <> auth.uid()` AND anyone in a block relationship
--      with the caller. A blocked person's username still occupies the unique
--      index, so the lookup would report it free and the UPDATE would then fail
--      with 23505. Telling someone a name is available and then refusing it is
--      worse than not checking at all.
--   3. It returns a name, an avatar and a list of dogs. Availability needs to
--      know that a row exists, not who it belongs to.
--
-- A direct client SELECT is not an option either: the profiles policies require
-- a shared pack, so a stranger's row is invisible and EVERY name would look
-- free.
--
-- ── What this does return ────────────────────────────────────────────────────
--
-- TRUE  — nothing holds it; the unique index will accept it.
-- FALSE — somebody else has it.
-- NULL  — cannot answer (not signed in, or not a well-formed username). The
--         client must treat NULL as "unknown" and never as "available";
--         the unique index stays the thing that actually decides.
--
-- Your own current username answers TRUE on purpose. Updating your row to the
-- value it already holds is not a conflict, and the profile editor has to be
-- able to say "this is yours" rather than "this is taken".
--
-- ── The privacy trade, stated plainly ────────────────────────────────────────
--
-- This lets any signed-in caller probe whether an exact string is taken, with
-- no rate limit, because it has to answer at typing speed. That is inherent to
-- every unique-handle namespace and it is strictly less than the rate-limited
-- lookup already discloses: a boolean, no identity attached, and no way to turn
-- it into a directory — you would have to already know the exact handle, and
-- learning "taken" tells you nothing about whose it is. It is deliberately NOT
-- granted to anon, so it is not an open oracle.

CREATE OR REPLACE FUNCTION public.community_username_available(p_username TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN lower(trim(leading '@' from trim(coalesce(p_username, '')))) !~ '^[a-z0-9_]{3,24}$'
      THEN NULL
    ELSE NOT EXISTS (
      SELECT 1
      FROM public.profiles pr
      WHERE lower(pr.username) = lower(trim(leading '@' from trim(p_username)))
        AND pr.id <> auth.uid()
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.community_username_available(TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.community_username_available(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_username_available(TEXT) TO authenticated;

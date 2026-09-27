-- Pins search_path on normalize_creator_code.
--
-- It is not SECURITY DEFINER and touches no tables, so nothing is exploitable
-- today. But every other function in the creator-codes migration pins it, the
-- Supabase security advisor flags the omission, and the day someone adds a
-- table reference in here is the day the inconsistency would have mattered.
--
-- Recovered from production, Sep 22 2026 — see the note in
-- 20260906112344_creator_codes_claim_ordering.sql. Applied straight to the
-- database and never written to the repo; restored verbatim under the exact
-- version the remote history recorded.

CREATE OR REPLACE FUNCTION public.normalize_creator_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(regexp_replace(COALESCE(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

REVOKE ALL ON FUNCTION public.normalize_creator_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_creator_code(TEXT) TO authenticated, service_role;

-- Fix: lookup_community_username raised 42702 for every username.
--
-- ── The bug ────────────────────────────────────────────────────────────────
--
-- Reported from a device: typing any username into "Invite someone you know"
-- returned
--
--   column reference "user_id" is ambiguous
--
-- The function is declared RETURNS TABLE (user_id UUID, username TEXT, ...).
-- In PL/pgSQL those OUT columns are variables in scope for the entire body, so
-- the rate-limit check on line 8 —
--
--   WHERE user_id = auth.uid() AND looked_up_at > now() - interval '1 hour'
--
-- could mean the OUT variable `user_id` or `community_username_lookups.user_id`.
-- Postgres refuses to guess and aborts the call.
--
-- It failed closed, which is the one mercy here: the exception is raised before
-- the INSERT and before the SELECT, so no lookup was ever recorded and no
-- profile was ever returned. Username invitations simply never worked. The
-- usernames in the report (test1908, test2808) are incidental — every input
-- took the same path.
--
-- ── The fix ────────────────────────────────────────────────────────────────
--
-- Alias the table and qualify the two columns. Nothing else in the function
-- changes; the body below is byte-identical to 20260917000000 apart from those
-- three tokens.
--
-- `list_external_community_claims` is the only other plpgsql function here that
-- declares RETURNS TABLE. It is not affected: every column in its body is
-- already qualified with i. / pr. / pet., so none of its OUT names can collide.
-- The two `LANGUAGE sql` functions cannot hit this at all — SQL functions do
-- not put their output column names in scope as variables.
--
-- CREATE OR REPLACE keeps the existing ownership and ACL, so the anon revoke
-- from 20260917133459 stays in force.

CREATE OR REPLACE FUNCTION public.lookup_community_username(p_username TEXT)
RETURNS TABLE (
  user_id UUID,
  username TEXT,
  full_name TEXT,
  avatar_url TEXT,
  dogs JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_username TEXT := lower(trim(leading '@' from trim(coalesce(p_username, ''))));
BEGIN
  IF auth.uid() IS NULL OR v_username !~ '^[a-z0-9_]{3,24}$' THEN
    RETURN;
  END IF;
  -- `lookups.` is the whole fix: without the alias, `user_id` here resolves to
  -- this function's own OUT parameter rather than to the column.
  IF (SELECT count(*) FROM public.community_username_lookups lookups
      WHERE lookups.user_id = auth.uid()
        AND lookups.looked_up_at > now() - interval '1 hour') >= 30 THEN
    RAISE EXCEPTION 'username_lookup_rate_limited';
  END IF;
  INSERT INTO public.community_username_lookups (user_id) VALUES (auth.uid());
  RETURN QUERY
  SELECT pr.id, pr.username, pr.full_name, pr.avatar_url,
    coalesce(jsonb_agg(jsonb_build_object('id', pet.id, 'name', pet.name, 'image_url', pet.image_url))
      FILTER (WHERE pet.id IS NOT NULL), '[]'::jsonb)
  FROM public.profiles pr
  LEFT JOIN public.pets pet ON pet.owner_id = pr.id AND pet.species = 'dog'
  WHERE lower(pr.username) = v_username AND pr.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM public.community_user_blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = pr.id)
         OR (b.blocker_id = pr.id AND b.blocked_id = auth.uid())
    )
  GROUP BY pr.id, pr.username, pr.full_name, pr.avatar_url;
END;
$$;

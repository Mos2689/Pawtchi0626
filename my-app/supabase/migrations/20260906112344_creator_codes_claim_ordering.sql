-- Fixes the rule order inside claim_creator_code.
--
-- The first version ran the redemption-cap check before the per-user checks. A
-- live test showed what that does: someone who had ALREADY redeemed the code
-- successfully was answered 'code_exhausted' — "every code has been claimed" —
-- which reads as bad luck and sends them to ask the creator for another one.
-- That is exactly the support ticket the already_redeemed sentence exists to
-- prevent.
--
-- What is true about the person is now answered before what is true about the
-- code. The single case that still falls through to the cap is a pending or
-- failed retry: those rows were never counted as granted, so re-granting one
-- against a full code would overshoot the cap by a person.
--
-- ── Recovered from production, Sep 22 2026 ─────────────────────────────────
--
-- This migration was applied straight to the database and never written to the
-- repo, so `supabase db push` reported it as a remote version with no local
-- file. It is restored here verbatim from
-- `supabase_migrations.schema_migrations.statements`, under the exact version
-- the remote recorded, so the two histories agree without re-running anything.
--
-- The local 20260906112122_creator_codes.sql still contains the ORIGINAL
-- claim_creator_code with the ordering bug. That is correct and deliberate:
-- migrations are a history, not a current state. This file is what fixes it,
-- and anything rebuilt from migrations replays both in order.

CREATE OR REPLACE FUNCTION public.claim_creator_code(p_code TEXT)
RETURNS TABLE (
  outcome       TEXT,
  creator_name  TEXT,
  duration      TEXT,
  redemption_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner      UUID := auth.uid();
  v_code       TEXT;
  v_row        creator_codes%ROWTYPE;
  v_existing   creator_code_redemptions%ROWTYPE;
  -- FOUND is clobbered by the cap's SELECT COUNT below, so the answer is kept
  -- in a variable rather than read twice from a moving target.
  v_has_existing BOOLEAN := FALSE;
  v_granted    INTEGER;
  v_entitled   TIMESTAMPTZ;
  v_new_id     UUID;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  v_code := public.normalize_creator_code(p_code);

  -- FOR UPDATE so the cap check and the insert that follows it cannot be
  -- interleaved by a second claim on the same code.
  SELECT * INTO v_row FROM creator_codes c WHERE c.code = v_code FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'not_found'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF NOT v_row.is_active THEN
    RETURN QUERY SELECT 'inactive'::TEXT, v_row.creator_name, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= NOW() THEN
    RETURN QUERY SELECT 'code_expired'::TEXT, v_row.creator_name, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- A creator redeeming their own code would burn a slot from their own cap,
  -- cap their access at three months rather than the year they were comped, and
  -- put them inside their own conversion numbers.
  IF v_row.creator_owner_id = v_owner THEN
    RETURN QUERY SELECT 'own_code'::TEXT, v_row.creator_name, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  SELECT * INTO v_existing
    FROM creator_code_redemptions r
   WHERE r.owner_id = v_owner;
  v_has_existing := FOUND;

  IF v_has_existing
     AND (v_existing.grant_status = 'granted' OR v_existing.code <> v_code)
  THEN
    RETURN QUERY SELECT 'already_redeemed'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  IF v_row.max_redemptions IS NOT NULL THEN
    SELECT COUNT(*) INTO v_granted
      FROM creator_code_redemptions r
     WHERE r.code = v_code AND r.grant_status = 'granted';

    IF v_granted >= v_row.max_redemptions THEN
      RETURN QUERY SELECT 'code_exhausted'::TEXT, v_row.creator_name, NULL::TEXT, NULL::UUID;
      RETURN;
    END IF;
  END IF;

  -- Same code, grant never landed → hand back the existing row so the caller
  -- can re-attempt RevenueCat. This is the one path that makes the UNIQUE
  -- constraint on owner_id survivable.
  IF v_has_existing THEN
    RETURN QUERY
      SELECT 'retry_grant'::TEXT, v_row.creator_name, v_existing.duration, v_existing.id;
    RETURN;
  END IF;

  -- Anyone who has ever held a REAL store entitlement is out, or a paying
  -- subscriber could stack free months on a live subscription and then cancel
  -- it. The mirror deliberately excludes promotional entitlements, so a
  -- previous creator-code holder is not caught here; their own UNIQUE row is.
  SELECT p.ever_entitled_at INTO v_entitled
    FROM paywall_interaction_counters p
   WHERE p.owner_id = v_owner;

  IF v_entitled IS NOT NULL THEN
    RETURN QUERY SELECT 'ever_subscribed'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  INSERT INTO creator_code_redemptions (owner_id, code, duration, grant_status)
  VALUES (v_owner, v_code, v_row.duration, 'pending')
  RETURNING id INTO v_new_id;

  RETURN QUERY SELECT 'claimed'::TEXT, v_row.creator_name, v_row.duration, v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_creator_code(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_creator_code(TEXT) TO authenticated;

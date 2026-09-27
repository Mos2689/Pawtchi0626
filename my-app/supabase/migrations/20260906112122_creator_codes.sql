-- Creator codes — a personalised code per collaborating creator, worth three
-- months of Pawtchi Plus to whoever redeems it.
--
-- ── Why there is almost nothing here ────────────────────────────────────────
--
-- Access is not granted by this schema. It is granted by a RevenueCat
-- *promotional entitlement*, written server-side by the redeem-creator-code
-- edge function. That matters because app/_layout.tsx calls
-- `Purchases.logIn(session.user.id)`, so the RevenueCat app user id already IS
-- the Supabase user id — a promotional entitlement keyed on that id lands in
-- `customerInfo.entitlements.active['Pawtchi Pro']`, which is the single thing
-- SubscriptionProvider reads. Nothing in the access model changes, and there is
-- no expiry sweep in this file because RevenueCat drops the entitlement itself.
--
-- So these tables are not an entitlement store. They are the ledger: who may
-- redeem, who already did, and what it was worth. RevenueCat remains
-- authoritative for whether someone actually has access right now.
--
-- ── Creators are our own users ──────────────────────────────────────────────
--
-- A collaborating creator has a Pawtchi account and a dog. `creator_owner_id`
-- links their code to that account, and the one RLS policy built on it is what
-- lets the app show them their own code and redemption count — no creator
-- login, no second web app, no new support surface. That column is the reason
-- the creator-facing side of this feature costs almost nothing.
--
-- ── A note on NOW() ─────────────────────────────────────────────────────────
--
-- Bare NOW() throughout, as in 20260822000000_pro_offer.sql and for the same
-- reason: this file does interval arithmetic on TIMESTAMPTZ columns (code
-- expiry, comp expiry), and `TIMEZONE('utc', NOW())` yields a plain `timestamp`
-- whose comparison against a timestamptz can silently shift by the server's
-- timezone.


-- ── Codes ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_codes (
  -- Canonical form is uppercase alphanumerics. Everything that reads a code
  -- normalises to this shape first, so "sarah-k", "Sarah K" and "SARAHK" are
  -- one code rather than three misses.
  code TEXT PRIMARY KEY CHECK (code ~ '^[A-Z0-9]{3,24}$'),

  -- Shown to the audience on the success screen: "Three months, from Sarah."
  creator_name   TEXT NOT NULL,
  creator_handle TEXT,

  -- The creator's own Pawtchi account.
  --
  -- Nullable, because a deal is often agreed before they have signed up — the
  -- code can exist first and be linked afterwards. UNIQUE, because one creator
  -- has one code. ON DELETE SET NULL rather than CASCADE: if they delete their
  -- account we lose the link, but the code and every redemption made against it
  -- survive, which is the only behaviour that keeps the ledger honest.
  creator_owner_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,

  -- A RevenueCat promotional duration, passed through verbatim to their API.
  -- Per-code rather than global config because different creators will be
  -- offered different terms — which is also why this feature has no
  -- `creator_program_config` singleton. Killing the whole programme is
  -- `UPDATE creator_codes SET is_active = FALSE`, one statement.
  duration TEXT NOT NULL DEFAULT 'three_month'
    CHECK (duration IN ('monthly', 'two_month', 'three_month', 'six_month', 'yearly')),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- NULL means uncapped / no end date. Both are the levers for a code that
  -- starts circulating somewhere it was not meant to.
  max_redemptions INTEGER CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  expires_at      TIMESTAMP WITH TIME ZONE,

  -- The creator's OWN access, so they can use and film the paid features.
  --
  -- Two columns here rather than a `creator_comps` table: it is one fact about
  -- a relationship this table already holds one row for. Keeping it out of
  -- creator_code_redemptions is the important part — a creator's comp must
  -- never be counted as a redemption, or every creator would appear in their
  -- own funnel and their conversion rate would be wrong.
  comp_granted_at TIMESTAMP WITH TIME ZONE,
  comp_expires_at TIMESTAMP WITH TIME ZONE,

  note TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE creator_codes ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE creator_codes IS
  'One row per collaborating creator. Not an entitlement store — access is a RevenueCat promotional entitlement written by the redeem-creator-code edge function.';

-- The policy that makes the in-app creator screen free. A creator reads their
-- own row and nothing else; there is no policy that exposes another creator''s
-- code, redemption count or comp.
DROP POLICY IF EXISTS "creator_can_read_own_code" ON creator_codes;
CREATE POLICY "creator_can_read_own_code" ON creator_codes
  FOR SELECT TO authenticated
  USING (creator_owner_id = auth.uid());

DROP POLICY IF EXISTS "admin_can_read_creator_codes" ON creator_codes;
CREATE POLICY "admin_can_read_creator_codes" ON creator_codes
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "admin_can_write_creator_codes" ON creator_codes;
CREATE POLICY "admin_can_write_creator_codes" ON creator_codes
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_can_update_creator_codes" ON creator_codes;
CREATE POLICY "admin_can_update_creator_codes" ON creator_codes
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Deliberately no DELETE policy. Deleting a code would orphan its redemptions
-- and erase the record of access we granted. Deactivating is the operation.


-- ── Redemptions ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS creator_code_redemptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE, and this single constraint is the entire anti-abuse story for
  -- accounts: one creator code per account, ever, enforced by the database
  -- rather than by application logic that a future caller could skip.
  owner_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,

  code TEXT NOT NULL REFERENCES creator_codes(code),

  -- pending — claimed in Postgres, RevenueCat not yet confirmed
  -- granted — the entitlement exists
  -- failed  — the RevenueCat call did not succeed; the user may retry
  --
  -- `failed` is not a dead end. Without it, a user whose grant failed once
  -- would be permanently locked out by their own UNIQUE row above — the ledger
  -- would say they had redeemed while they had nothing to show for it.
  grant_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (grant_status IN ('pending', 'granted', 'failed')),

  -- Frozen at claim time. If the code's terms are later changed, what this
  -- person was actually given must not change with it.
  duration TEXT NOT NULL,

  granted_at TIMESTAMP WITH TIME ZONE,
  -- Our record of when access ends. RevenueCat is authoritative; this exists so
  -- support and the admin table can answer "until when?" without an API call.
  expires_at TIMESTAMP WITH TIME ZONE,

  error_detail TEXT,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE creator_code_redemptions ENABLE ROW LEVEL SECURITY;

-- Counting granted redemptions is the cap check, and it runs inside a lock on
-- every claim. There is deliberately no denormalised counter on creator_codes:
-- a counter would have to be decremented when a grant fails, and a compensating
-- write that runs on the error path is a counter that drifts. COUNT(*) over
-- this partial index cannot.
CREATE INDEX IF NOT EXISTS idx_creator_redemptions_granted
  ON creator_code_redemptions (code)
  WHERE grant_status = 'granted';

-- Read-only for the owner. Every write goes through the functions below: an
-- owner who could INSERT here would be minting themselves free months.
DROP POLICY IF EXISTS "owner_can_read_own_redemption" ON creator_code_redemptions;
CREATE POLICY "owner_can_read_own_redemption" ON creator_code_redemptions
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid());

DROP POLICY IF EXISTS "admin_can_read_creator_redemptions" ON creator_code_redemptions;
CREATE POLICY "admin_can_read_creator_redemptions" ON creator_code_redemptions
  FOR SELECT TO authenticated
  USING (public.is_admin());


-- ── Normalisation ───────────────────────────────────────────────────────────
-- Mirrored by normalizeCreatorCode() in lib/creatorCode/normalize.ts, which the
-- app uses for display. This one is authoritative: it is what a lookup actually
-- matches on, so a client that normalises differently can only ever produce a
-- miss, never a wrong hit.

-- SET search_path even though this one is not SECURITY DEFINER and touches no
-- tables. Every other function in this file pins it, the Supabase security
-- advisor flags the omission, and the day someone adds a table reference in
-- here is the day the inconsistency would have mattered.
CREATE OR REPLACE FUNCTION public.normalize_creator_code(p_code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT upper(regexp_replace(COALESCE(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;


-- ── Claim ───────────────────────────────────────────────────────────────────
--
-- Every rule, decided atomically under a row lock, BEFORE the RevenueCat call.
-- Two devices racing therefore produce one redemption row, not two grants.
--
-- Returns an outcome rather than raising, because most of these are ordinary
-- product states with their own copy ("that code has already been used"), not
-- errors. The caller maps outcome → sentence.

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

  -- FOR UPDATE so the cap check below and the insert that follows it cannot be
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
  -- cap their access at their audience's three months rather than the year they
  -- were comped, and put them in their own conversion numbers.
  IF v_row.creator_owner_id = v_owner THEN
    RETURN QUERY SELECT 'own_code'::TEXT, v_row.creator_name, NULL::TEXT, NULL::UUID;
    RETURN;
  END IF;

  -- ── Order of the next two blocks is load-bearing ──────────────────────────
  --
  -- What is true about THIS person is answered before what is true about the
  -- code. The first draft ran the cap check first, and a live test caught what
  -- that does: someone who had already redeemed successfully was told
  -- "every code has been claimed" — which reads as bad luck and sends them to
  -- ask the creator for another one. That is precisely the support ticket the
  -- already_redeemed sentence exists to prevent.
  --
  -- The one case that must still fall through to the cap is a pending or failed
  -- retry. Those rows were never counted as granted, so re-granting one against
  -- a full code would overshoot the cap by a person.

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
  -- constraint on owner_id survivable: without it, a user whose grant failed
  -- once would be locked out for good by their own ledger row.
  IF v_has_existing THEN
    RETURN QUERY
      SELECT 'retry_grant'::TEXT, v_row.creator_name, v_existing.duration, v_existing.id;
    RETURN;
  END IF;

  -- Anyone who has ever held a REAL store entitlement is out. Without this a
  -- paying subscriber could stack free months on a live subscription and then
  -- cancel it. The column is a client-reported mirror and may be stale, so this
  -- is a filter rather than a guarantee — the client also checks live isPro
  -- before it ever calls this.
  --
  -- The mirror deliberately excludes promotional entitlements (see the
  -- `store !== 'PROMOTIONAL'` guard in SubscriptionProvider), so a previous
  -- creator-code holder is not caught here. Their own UNIQUE row is.
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


-- ── Post-grant bookkeeping ──────────────────────────────────────────────────
-- Service-role only: called by the edge function once RevenueCat has answered.
-- No auth.uid() here, and no GRANT to `authenticated` below — a user who could
-- call this could mark their own pending row 'granted' without an entitlement
-- ever existing, which would consume their one redemption for nothing.

CREATE OR REPLACE FUNCTION public.mark_creator_redemption(
  p_redemption_id UUID,
  p_status        TEXT,
  p_expires_at    TIMESTAMPTZ DEFAULT NULL,
  p_error         TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('pending', 'granted', 'failed') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = '22023';
  END IF;

  UPDATE creator_code_redemptions SET
    grant_status = p_status,
    -- COALESCE so a repeat grant (a retry that turns out to have succeeded the
    -- first time) does not move the original timestamp forward.
    granted_at   = CASE WHEN p_status = 'granted'
                        THEN COALESCE(granted_at, NOW()) ELSE granted_at END,
    expires_at   = COALESCE(p_expires_at, expires_at),
    error_detail = p_error
  WHERE id = p_redemption_id;
END;
$$;

-- Records the creator's own comped access. Separate from redemptions on
-- purpose — see the column comments on creator_codes.
CREATE OR REPLACE FUNCTION public.record_creator_comp(
  p_code       TEXT,
  p_expires_at TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE creator_codes SET
    comp_granted_at = NOW(),
    comp_expires_at = p_expires_at,
    updated_at      = NOW()
  WHERE code = public.normalize_creator_code(p_code);
END;
$$;


-- ── Reads ───────────────────────────────────────────────────────────────────

-- The creator's own view. Returns zero rows for very nearly every user, which
-- is exactly how the app decides whether to render the Creator row in Profile
-- at all — no separate "am I a creator?" flag to keep in sync.
--
-- An RPC rather than a plain select on creator_codes so the redemption count
-- comes back in the same round trip. The count is an aggregate over rows the
-- creator cannot read directly, which is the other reason this is DEFINER.
CREATE OR REPLACE FUNCTION public.get_my_creator_code()
RETURNS TABLE (
  code                TEXT,
  creator_name        TEXT,
  is_active           BOOLEAN,
  redemptions_granted INTEGER,
  comp_expires_at     TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    c.code,
    c.creator_name,
    c.is_active,
    (SELECT COUNT(*)::INTEGER
       FROM creator_code_redemptions r
      WHERE r.code = c.code AND r.grant_status = 'granted'),
    c.comp_expires_at
  FROM creator_codes c
  WHERE c.creator_owner_id = auth.uid();
$$;

-- The admin table, in one call.
--
-- `converted_to_paid` is the number that decides whether a collaboration gets
-- renewed, and it costs nothing extra: paywall_interaction_counters.
-- ever_entitled_at is already maintained by the app, and it excludes
-- promotional entitlements, so it means "went on to actually pay" and not
-- "received the free months we gave them".
CREATE OR REPLACE FUNCTION public.get_creator_code_stats()
RETURNS TABLE (
  code                TEXT,
  creator_name        TEXT,
  creator_handle      TEXT,
  creator_owner_id    UUID,
  creator_email       TEXT,
  is_active           BOOLEAN,
  duration            TEXT,
  max_redemptions     INTEGER,
  expires_at          TIMESTAMPTZ,
  comp_expires_at     TIMESTAMPTZ,
  redemptions_granted INTEGER,
  redemptions_failed  INTEGER,
  converted_to_paid   INTEGER,
  created_at          TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  -- Raises rather than returning nothing. An admin panel that silently shows an
  -- empty table when the caller lacks permission is indistinguishable from a
  -- programme with no creators in it.
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    c.code,
    c.creator_name,
    c.creator_handle,
    c.creator_owner_id,
    u.email::TEXT,
    c.is_active,
    c.duration,
    c.max_redemptions,
    c.expires_at,
    c.comp_expires_at,
    COALESCE(g.n, 0),
    COALESCE(f.n, 0),
    COALESCE(p.n, 0),
    c.created_at
  FROM creator_codes c
  LEFT JOIN auth.users u ON u.id = c.creator_owner_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS n FROM creator_code_redemptions r
     WHERE r.code = c.code AND r.grant_status = 'granted'
  ) g ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS n FROM creator_code_redemptions r
     WHERE r.code = c.code AND r.grant_status = 'failed'
  ) f ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::INTEGER AS n
      FROM creator_code_redemptions r
      JOIN paywall_interaction_counters pc ON pc.owner_id = r.owner_id
     WHERE r.code = c.code
       AND r.grant_status = 'granted'
       AND pc.ever_entitled_at IS NOT NULL
  ) p ON TRUE
  ORDER BY c.created_at DESC;
END;
$$;

-- Resolves an email to a user id so the admin panel can link a code to a
-- creator's account without the panel being able to enumerate the user table.
-- Exact match only, and it returns an id or nothing — never a list, never a
-- profile.
CREATE OR REPLACE FUNCTION public.find_user_id_by_email(p_email TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT u.id INTO v_id
    FROM auth.users u
   WHERE lower(u.email) = lower(trim(COALESCE(p_email, '')))
   LIMIT 1;

  RETURN v_id;
END;
$$;


-- ── Grants ──────────────────────────────────────────────────────────────────
--
-- REVOKE before GRANT throughout. Postgres grants EXECUTE on a new function to
-- PUBLIC by default, so without the revokes the `anon` role reaches every one
-- of these through /rest/v1/rpc/ — including find_user_id_by_email, which is an
-- email-to-uuid oracle for anyone with the app's anon key. (Same lesson as
-- migration 20260822000002.)

REVOKE ALL ON FUNCTION public.normalize_creator_code(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_creator_code(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_my_creator_code() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_creator_code_stats() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.find_user_id_by_email(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.normalize_creator_code(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_creator_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_creator_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_creator_code_stats() TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_user_id_by_email(TEXT) TO authenticated;

-- Service-role only. These two write the ledger's outcome, so a client that
-- could call them could claim a grant that never happened.
REVOKE ALL ON FUNCTION public.mark_creator_redemption(UUID, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_creator_comp(TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_creator_redemption(UUID, TEXT, TIMESTAMPTZ, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_creator_comp(TEXT, TIMESTAMPTZ) TO service_role;

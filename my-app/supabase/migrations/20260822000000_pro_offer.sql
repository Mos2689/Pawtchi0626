-- Pro offer — the conditional AUD $6.99 win-back for users who refused $9.99.
--
-- ── Why any of this is server-side ──────────────────────────────────────────
--
-- Two hard constraints shaped this file.
--
-- 1. There is no `expo-updates` channel in this project (checked: no dependency,
--    no `updates` block in app.json, no channel in eas.json). Every line of
--    client code needs a store release. So `pro_offer_config` is not a
--    convenience — it is the ONLY way to change eligibility thresholds, the
--    allocation percentage, or the price without shipping a build, and that is
--    why it carries a knob for every number in the design rather than the two
--    or three that seemed interesting on day one.
--
-- 2. Eligibility must survive reinstall, logout and a second device. A device
--    flag cannot: delete the app and the discount is farmable. So the grant is
--    a row keyed on auth.users(id), and the client only ever reads it.
--
-- ── Shape ───────────────────────────────────────────────────────────────────
--
-- Mirrors the notification pipeline deliberately (20260805000001): SQL returns
-- *candidates* with every signal attached, and the decision is made in
-- TypeScript so it is unit-testable against lib/proOffer/eligibility.ts. The
-- thresholds live in config and are applied in TS, NOT in this SQL, so that a
-- threshold change is an UPDATE on one row rather than a migration.
--
-- ── The one thing this schema cannot know ───────────────────────────────────
--
-- Postgres has no idea whether someone has an App Store subscription. That
-- lives in RevenueCat. `ever_entitled_at` below is a client-reported mirror and
-- is therefore allowed to be stale (someone who subscribes on device B and
-- never reopens device A). It is a filter, not a gate. The authoritative check
-- is `isPro` read from RevenueCat at render time in useProOffer — a stale
-- column can only ever cost us a grant we then revoke, never show a discount to
-- a paying subscriber.

-- ── A note on NOW() ─────────────────────────────────────────────────────────
--
-- Neighbouring migrations write `TIMEZONE('utc', NOW())` into TIMESTAMPTZ
-- columns. That produces a plain `timestamp`, which the column then interprets
-- in the server's timezone — harmless while the server is UTC, which Supabase's
-- is. This file uses bare `NOW()` instead, because unlike those tables it does
-- interval *arithmetic* on these columns (impression spacing, window expiry,
-- days-since-dismissal), and mixing `timestamp` with `timestamptz` in a
-- comparison is where that harmless quirk would stop being harmless. Same
-- values today; one fewer thing that could quietly shift by hours.

-- ── Config ──────────────────────────────────────────────────────────────────
-- Exactly one row, id = TRUE. The CHECK is what makes it a singleton: a second
-- row cannot exist, so no reader has to pick between rows or ORDER BY anything.

CREATE TABLE IF NOT EXISTS pro_offer_config (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),

  -- Kill switch. Ships FALSE, and Phase 6 ships a build with it still FALSE so
  -- the release can be verified as behaviourally identical to today before a
  -- single discount is offered.
  enabled BOOLEAN NOT NULL DEFAULT FALSE,

  -- Percentage of newly eligible users assigned to the discount arm. The rest
  -- become the holdback control: they get a grant row (so both arms share a
  -- denominator) but never see the offer. Start at 5.
  variant_allocation_pct INTEGER NOT NULL DEFAULT 5
    CHECK (variant_allocation_pct BETWEEN 0 AND 100),

  -- The RevenueCat offering the win-back paywall renders. This is the pricing
  -- experiment lever: point it at an offering wrapping a $7.99 SKU and the
  -- price changes with no app build. Never a product id — always an offering,
  -- so the store-specific SKU mapping stays in RevenueCat where it belongs.
  offering_id TEXT NOT NULL DEFAULT 'winback_monthly',

  -- ── Eligibility thresholds (rules A–G) ──
  -- 45 = the 30-day freemium wall plus 14 days of genuine full-price exposure.
  min_account_age_days           INTEGER NOT NULL DEFAULT 45,
  -- Dismissals during freemium are weightless: nothing was refused, because
  -- nothing was withheld. Only post-freemium dismissals are real refusals.
  min_dismissals_post_freemium   INTEGER NOT NULL DEFAULT 2,
  min_dismissals_total           INTEGER NOT NULL DEFAULT 3,
  -- The single most important anti-cannibalisation number. A discount that
  -- arrives days after a dismissal cannot be learned as a response to it.
  dismissal_cooldown_days        INTEGER NOT NULL DEFAULT 5,
  min_active_days_14             INTEGER NOT NULL DEFAULT 3,
  -- Checkout abandoners are warm, not necessarily price-resistant: a StoreKit
  -- sheet abandon is as often a failed Face ID as a refused price. They cool
  -- longer rather than being excluded outright.
  purchase_started_cooldown_days INTEGER NOT NULL DEFAULT 14,

  -- ── Window shape ──
  offer_window_days       INTEGER NOT NULL DEFAULT 14,
  max_impressions         INTEGER NOT NULL DEFAULT 3,
  impression_spacing_hours INTEGER NOT NULL DEFAULT 72,

  inbox_enabled BOOLEAN NOT NULL DEFAULT TRUE,

  -- App Review cannot satisfy a 45-day-old account with three dismissals. These
  -- accounts are force-granted by the sweep. A data row, not hidden app code —
  -- the distinction Apple actually cares about.
  review_bypass_user_ids UUID[] NOT NULL DEFAULT '{}',

  -- Stamped onto every grant and every analytics event, so a mid-experiment
  -- threshold change is visible in the data rather than silently mixing two
  -- populations into one number. Bump it by hand whenever a threshold moves.
  config_version INTEGER NOT NULL DEFAULT 1,

  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

INSERT INTO pro_offer_config (id) VALUES (TRUE) ON CONFLICT (id) DO NOTHING;

ALTER TABLE pro_offer_config ENABLE ROW LEVEL SECURITY;

-- RLS on, and deliberately NO policy: nothing reaches this table through
-- PostgREST. Clients read through get_pro_offer_config() below, which returns
-- the columns a device needs and omits `review_bypass_user_ids` — a
-- world-readable list of the App Review test accounts is a needless thing to
-- publish, and no client has any use for it. The sweep uses the service role,
-- which bypasses RLS and sees the whole row.


-- ── Paywall interaction counters ────────────────────────────────────────────
-- One row per user. Counters rather than an event table on purpose: the six
-- eligibility rules need aggregates, never individual events, and an append-only
-- events table for every paywall view is a lot of rows to store for numbers we
-- can maintain in place. PostHog keeps the event stream; this keeps the state.

CREATE TABLE IF NOT EXISTS paywall_interaction_counters (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  views_total              INTEGER NOT NULL DEFAULT 0,
  dismissals_total         INTEGER NOT NULL DEFAULT 0,
  -- Split out because the 30-day freemium makes a dismissal mean two entirely
  -- different things depending on when it happened.
  dismissals_post_freemium INTEGER NOT NULL DEFAULT 0,
  last_dismissed_at        TIMESTAMP WITH TIME ZONE,

  purchase_started_count   INTEGER NOT NULL DEFAULT 0,
  last_purchase_started_at TIMESTAMP WITH TIME ZONE,

  -- Client-reported mirror of RevenueCat. See the header: a filter, not a gate.
  ever_entitled_at         TIMESTAMP WITH TIME ZONE,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE paywall_interaction_counters ENABLE ROW LEVEL SECURITY;

-- Read-only for owners. Every write goes through record_paywall_interaction()
-- so the counters cannot be inflated by talking to PostgREST directly — an
-- owner who could UPDATE this table could grant themselves the discount.
CREATE POLICY "owner_can_read_own_paywall_counters" ON paywall_interaction_counters
  FOR SELECT
  USING (owner_id = auth.uid());


-- ── Grants ──────────────────────────────────────────────────────────────────
-- One row per user, ever. The absence of a row IS "not eligible" — there is no
-- NOT_ELIGIBLE status, because storing a row for every user who does not
-- qualify would be a row per account to express nothing.

CREATE TABLE IF NOT EXISTS pro_offer_grants (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Assigned once at grant time from a deterministic hash of owner_id, and
  -- never recomputed. A sweep re-run must not be able to move anyone between
  -- arms; that would silently corrupt the experiment rather than fail loudly.
  cohort TEXT NOT NULL CHECK (cohort IN ('control', 'variant')),

  -- granted  — eligible, nothing shown yet
  -- shown    — seen at least once, window still open
  -- converted— purchased the discounted SKU
  -- expired  — window elapsed, or impressions exhausted
  -- revoked  — withdrawn: subscribed at full price, kill switch, review cleanup
  --
  -- Deliberately NOT a status: "dismissed". A dismissal is not terminal — it is
  -- shown_count incrementing. Modelling it as a status makes "dismissed once,
  -- then bought" unrepresentable, which is the outcome we most want to see.
  status TEXT NOT NULL DEFAULT 'granted'
    CHECK (status IN ('granted', 'shown', 'converted', 'expired', 'revoked')),

  eligible_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMP WITH TIME ZONE NOT NULL,

  first_shown_at TIMESTAMP WITH TIME ZONE,
  last_shown_at  TIMESTAMP WITH TIME ZONE,
  shown_count    INTEGER NOT NULL DEFAULT 0,

  converted_at         TIMESTAMP WITH TIME ZONE,
  converted_product_id TEXT,

  revoked_reason TEXT,

  -- Which thresholds produced this grant.
  config_version INTEGER NOT NULL DEFAULT 1,

  -- Frozen at grant time so the analysis can segment on who these people were
  -- when they qualified, not on who they became. Recomputing these at read time
  -- would make the cohort definition drift under the experiment.
  signals JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

ALTER TABLE pro_offer_grants ENABLE ROW LEVEL SECURITY;

-- Read-only. Writes are service-role (the sweep) or SECURITY DEFINER RPCs.
-- An owner who could UPDATE this row could set their own cohort to 'variant'
-- and reset shown_count — i.e. mint themselves an unlimited discount.
CREATE POLICY "owner_can_read_own_pro_offer_grant" ON pro_offer_grants
  FOR SELECT
  USING (owner_id = auth.uid());

-- Drives the sweep's expiry pass.
CREATE INDEX IF NOT EXISTS idx_pro_offer_grants_open
  ON pro_offer_grants (expires_at)
  WHERE status IN ('granted', 'shown');


-- ── Writes ──────────────────────────────────────────────────────────────────

-- Called from the existing track() sites in app/paywall.tsx. `p_post_freemium`
-- is decided client-side because the client already holds the answer
-- (SubscriptionProvider computes isFreemiumActive from the session), and
-- re-deriving it here would mean this function and the access model could
-- disagree about who is behind the wall.
CREATE OR REPLACE FUNCTION public.record_paywall_interaction(
  p_kind TEXT,
  p_post_freemium BOOLEAN DEFAULT FALSE
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

  IF coalesce(p_kind, '') NOT IN ('view', 'dismiss', 'purchase_started') THEN
    RAISE EXCEPTION 'invalid_kind' USING ERRCODE = '22023';
  END IF;

  INSERT INTO paywall_interaction_counters (owner_id)
  VALUES (v_owner)
  ON CONFLICT (owner_id) DO NOTHING;

  UPDATE paywall_interaction_counters SET
    views_total = views_total + (CASE WHEN p_kind = 'view' THEN 1 ELSE 0 END),

    dismissals_total = dismissals_total
      + (CASE WHEN p_kind = 'dismiss' THEN 1 ELSE 0 END),
    dismissals_post_freemium = dismissals_post_freemium
      + (CASE WHEN p_kind = 'dismiss' AND p_post_freemium THEN 1 ELSE 0 END),
    last_dismissed_at = CASE
      WHEN p_kind = 'dismiss' THEN NOW() ELSE last_dismissed_at END,

    purchase_started_count = purchase_started_count
      + (CASE WHEN p_kind = 'purchase_started' THEN 1 ELSE 0 END),
    last_purchase_started_at = CASE
      WHEN p_kind = 'purchase_started' THEN NOW()
      ELSE last_purchase_started_at END,

    updated_at = NOW()
  WHERE owner_id = v_owner;
END;
$$;

-- Mirrors RevenueCat's "has this account ever held the entitlement" into
-- Postgres so the sweep can filter on it. Write-once: entitlement history is
-- monotonic, and a lapsed subscriber must stay excluded from a NEVER-subscribed
-- offer, so this must never be cleared.
CREATE OR REPLACE FUNCTION public.record_entitlement_seen()
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

  INSERT INTO paywall_interaction_counters (owner_id, ever_entitled_at)
  VALUES (v_owner, NOW())
  ON CONFLICT (owner_id) DO UPDATE
    SET ever_entitled_at = COALESCE(paywall_interaction_counters.ever_entitled_at,
                                    NOW()),
        updated_at = NOW();
END;
$$;

-- Records that the win-back paywall was actually shown.
--
-- Idempotent within the configured spacing window, which is what makes the
-- impression budget safe across devices: two phones opening the paywall in the
-- same hour burn one impression, not two. Returns the resulting shown_count so
-- the client can report impression_index without a second round trip.
CREATE OR REPLACE FUNCTION public.record_pro_offer_impression()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner   UUID := auth.uid();
  v_spacing INTEGER;
  v_max     INTEGER;
  v_grant   pro_offer_grants%ROWTYPE;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'auth_required' USING ERRCODE = '42501';
  END IF;

  SELECT impression_spacing_hours, max_impressions
    INTO v_spacing, v_max
    FROM pro_offer_config WHERE id;

  SELECT * INTO v_grant FROM pro_offer_grants WHERE owner_id = v_owner FOR UPDATE;

  IF NOT FOUND OR v_grant.status NOT IN ('granted', 'shown') THEN
    RETURN 0;
  END IF;

  -- Inside the spacing window: same impression, seen again. Not a new one.
  -- NOW() on both sides of the comparison — see get_pro_offer_candidates.
  IF v_grant.last_shown_at IS NOT NULL
     AND v_grant.last_shown_at > NOW() - (v_spacing || ' hours')::INTERVAL
  THEN
    RETURN v_grant.shown_count;
  END IF;

  UPDATE pro_offer_grants SET
    status         = 'shown',
    shown_count    = shown_count + 1,
    first_shown_at = COALESCE(first_shown_at, NOW()),
    last_shown_at  = NOW(),
    updated_at     = NOW()
  WHERE owner_id = v_owner
  RETURNING * INTO v_grant;

  -- Budget exhausted by this impression — close the window now rather than
  -- waiting for the sweep, so the next paywall open is already the standard one.
  IF v_grant.shown_count >= v_max THEN
    UPDATE pro_offer_grants
       SET status = 'expired', updated_at = NOW()
     WHERE owner_id = v_owner;
  END IF;

  RETURN v_grant.shown_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_pro_offer_conversion(p_product_id TEXT)
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

  -- Terminal states are not overwritten: a conversion recorded twice (restore,
  -- a second device) must not move converted_at forward.
  UPDATE pro_offer_grants SET
    status               = 'converted',
    converted_at         = COALESCE(converted_at, NOW()),
    converted_product_id = COALESCE(converted_product_id, p_product_id),
    updated_at           = NOW()
  WHERE owner_id = v_owner
    AND status IN ('granted', 'shown');
END;
$$;

-- Withdraws an open offer. The client calls this the moment RevenueCat reports
-- an entitlement, which is the path that stops a full-price subscriber from
-- ever seeing a discount screen — including the case where they bought on
-- another device between two opens of this one.
CREATE OR REPLACE FUNCTION public.revoke_pro_offer(p_reason TEXT)
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

  UPDATE pro_offer_grants SET
    status         = 'revoked',
    revoked_reason = COALESCE(p_reason, 'unspecified'),
    updated_at     = NOW()
  WHERE owner_id = v_owner
    AND status IN ('granted', 'shown');
END;
$$;


-- ── Read ────────────────────────────────────────────────────────────────────

-- The client's view of the config. Every threshold, because the device applies
-- the same rule engine the sweep does — minus `review_bypass_user_ids`, which
-- only the sweep needs and which nobody should be able to enumerate.
CREATE OR REPLACE FUNCTION public.get_pro_offer_config()
RETURNS TABLE (
  enabled                        BOOLEAN,
  variant_allocation_pct         INTEGER,
  offering_id                    TEXT,
  min_account_age_days           INTEGER,
  min_dismissals_post_freemium   INTEGER,
  min_dismissals_total           INTEGER,
  dismissal_cooldown_days        INTEGER,
  min_active_days_14             INTEGER,
  purchase_started_cooldown_days INTEGER,
  offer_window_days              INTEGER,
  max_impressions                INTEGER,
  impression_spacing_hours       INTEGER,
  inbox_enabled                  BOOLEAN,
  config_version                 INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT c.enabled, c.variant_allocation_pct, c.offering_id,
         c.min_account_age_days, c.min_dismissals_post_freemium,
         c.min_dismissals_total, c.dismissal_cooldown_days,
         c.min_active_days_14, c.purchase_started_cooldown_days,
         c.offer_window_days, c.max_impressions, c.impression_spacing_hours,
         c.inbox_enabled, c.config_version
    FROM pro_offer_config c
   WHERE c.id;
$$;

-- One call returns everything the client needs to decide what to render, so the
-- paywall never has to fan out to three tables before it can paint. Returns a
-- row even when there is no grant (all NULLs) so callers can distinguish
-- "asked, no offer" from "never asked".

CREATE OR REPLACE FUNCTION public.get_pro_offer_state()
RETURNS TABLE (
  cohort         TEXT,
  status         TEXT,
  eligible_at    TIMESTAMPTZ,
  expires_at     TIMESTAMPTZ,
  last_shown_at  TIMESTAMPTZ,
  shown_count    INTEGER,
  config_version INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.cohort, g.status, g.eligible_at, g.expires_at,
         g.last_shown_at, g.shown_count, g.config_version
    FROM pro_offer_grants g
   WHERE g.owner_id = auth.uid();
$$;


-- ── Candidates ──────────────────────────────────────────────────────────────
-- Every signal the six rules need, one row per user who could conceivably
-- qualify, in a single pass. Thresholds are NOT applied here — they live in
-- config and are applied by lib/proOffer/eligibility.ts, so tuning them is an
-- UPDATE rather than a migration, and so the logic is unit-testable.
--
-- The only filters applied here are the ones that are structural rather than
-- tunable: already granted, already entitled, no account age at all. Those can
-- never be relaxed by config, so excluding them early is free.

CREATE OR REPLACE FUNCTION public.get_pro_offer_candidates()
RETURNS TABLE (
  owner_id                 UUID,
  account_age_days         INTEGER,
  views_total              INTEGER,
  dismissals_total         INTEGER,
  dismissals_post_freemium INTEGER,
  days_since_last_dismissal INTEGER,
  purchase_started_count   INTEGER,
  days_since_purchase_started INTEGER,
  active_days_14           INTEGER,
  walks_30d                INTEGER,
  is_review_bypass         BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH cfg AS (SELECT * FROM pro_offer_config WHERE id),
  -- A day counts as active if anything was logged (daily_logs is one row per
  -- pet per day) or a walk was recorded. Walks are unioned separately because a
  -- walk-first dog owner may never touch a meal log, and treating them as
  -- inactive would exclude exactly the segment the app is now built around.
  -- LEFT JOIN LATERAL, not JOIN LATERAL: an inner join drops every owner whose
  -- pet has logged nothing in a fortnight, and those are precisely the rows the
  -- engagement rule needs to see in order to reject them. Without this the
  -- dry-run funnel would report zero users blocked by `not_engaged_enough`.
  active AS (
    SELECT p.owner_id, COUNT(DISTINCT d.day)::INTEGER AS active_days
      FROM pets p
      LEFT JOIN LATERAL (
        SELECT dl.log_date AS day
          FROM daily_logs dl
         WHERE dl.pet_id = p.id
           AND dl.log_date >= (NOW() - INTERVAL '14 days')::date
        UNION
        SELECT ws.started_at::date AS day
          FROM walk_sessions ws
         WHERE ws.pet_id = p.id
           AND ws.started_at >= NOW() - INTERVAL '14 days'
      ) d ON TRUE
     GROUP BY p.owner_id
  ),
  walks AS (
    SELECT ws.owner_id, COUNT(*)::INTEGER AS n
      FROM walk_sessions ws
     WHERE ws.started_at >= NOW() - INTERVAL '30 days'
       AND ws.validation_verdict = 'valid'
     GROUP BY ws.owner_id
  )
  SELECT
    u.id,
    -- NOW(), not TIMEZONE('utc', NOW()): both sides are timestamptz, so the
    -- interval is exact. Subtracting a timestamptz from a plain timestamp
    -- would silently shift by the server's timezone. Matches the house pattern
    -- in get_notification_candidates.
    GREATEST(0, EXTRACT(DAY FROM NOW() - u.created_at)::INTEGER),
    COALESCE(c.views_total, 0),
    COALESCE(c.dismissals_total, 0),
    COALESCE(c.dismissals_post_freemium, 0),
    CASE WHEN c.last_dismissed_at IS NULL THEN NULL
         ELSE EXTRACT(DAY FROM NOW() - c.last_dismissed_at)::INTEGER END,
    COALESCE(c.purchase_started_count, 0),
    CASE WHEN c.last_purchase_started_at IS NULL THEN NULL
         ELSE EXTRACT(DAY FROM NOW() - c.last_purchase_started_at)::INTEGER END,
    COALESCE(a.active_days, 0),
    COALESCE(w.n, 0),
    u.id = ANY(cfg.review_bypass_user_ids)
  FROM auth.users u
  -- One row, so this multiplies nothing. Joined rather than used as a scalar
  -- subquery so the array reference is an ordinary column.
  CROSS JOIN cfg
  LEFT JOIN paywall_interaction_counters c ON c.owner_id = u.id
  LEFT JOIN active a ON a.owner_id = u.id
  LEFT JOIN walks  w ON w.owner_id = u.id
  WHERE NOT EXISTS (SELECT 1 FROM pro_offer_grants g WHERE g.owner_id = u.id)
    -- NULL when there is no counters row at all, which is the common case for
    -- someone who has never opened the paywall. IS NULL is true for both.
    AND c.ever_entitled_at IS NULL;
$$;

-- Writes the grants the sweep decided on. Service-role only (no auth.uid()
-- here), and ON CONFLICT DO NOTHING so a re-run of a partially-completed sweep
-- can never re-grant someone or, worse, reassign their cohort.
CREATE OR REPLACE FUNCTION public.grant_pro_offer(
  p_owner_id       UUID,
  p_cohort         TEXT,
  p_window_days    INTEGER,
  p_config_version INTEGER,
  p_signals        JSONB
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- INTEGER, not BOOLEAN. GET DIAGNOSTICS yields an integer row count and
  -- Postgres has no integer→boolean cast, so assigning it to a BOOLEAN raises
  -- at runtime — on the sweep's very first grant, in production, at 6am.
  v_rows INTEGER := 0;
BEGIN
  INSERT INTO pro_offer_grants (
    owner_id, cohort, expires_at, config_version, signals
  )
  VALUES (
    p_owner_id,
    p_cohort,
    NOW() + (p_window_days || ' days')::INTERVAL,
    p_config_version,
    COALESCE(p_signals, '{}'::jsonb)
  )
  ON CONFLICT (owner_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

-- Closes windows that ran out of time. Called by the sweep on every run.
CREATE OR REPLACE FUNCTION public.expire_pro_offers()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE pro_offer_grants
     SET status = 'expired', updated_at = NOW()
   WHERE status IN ('granted', 'shown')
     AND expires_at <= NOW();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Owners read their own state; nobody calls the write side from a client
-- session except through the SECURITY DEFINER functions above.
REVOKE ALL ON FUNCTION public.get_pro_offer_candidates() FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.grant_pro_offer(UUID, TEXT, INTEGER, INTEGER, JSONB)
  FROM PUBLIC, authenticated, anon;
REVOKE ALL ON FUNCTION public.expire_pro_offers() FROM PUBLIC, authenticated, anon;

GRANT EXECUTE ON FUNCTION public.get_pro_offer_candidates() TO service_role;
GRANT EXECUTE ON FUNCTION public.grant_pro_offer(UUID, TEXT, INTEGER, INTEGER, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_pro_offers() TO service_role;

-- Revoke BEFORE granting. Postgres grants EXECUTE on a new function to PUBLIC
-- by default, so without this the `anon` role reaches every one of these
-- through /rest/v1/rpc/. The write paths were already safe — each raises
-- 'auth_required' when auth.uid() is NULL — but get_pro_offer_config() would
-- hand the eligibility thresholds to any unauthenticated caller. Nothing
-- secret, and no reason to publish it either. (Caught by the Supabase security
-- advisor after the first apply; see migration 20260822000002.)
REVOKE ALL ON FUNCTION public.record_paywall_interaction(TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_entitlement_seen() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_pro_offer_impression() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_pro_offer_conversion(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_pro_offer(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pro_offer_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_pro_offer_config() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.record_paywall_interaction(TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_entitlement_seen() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pro_offer_impression() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_pro_offer_conversion(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_pro_offer(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pro_offer_state() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pro_offer_config() TO authenticated;

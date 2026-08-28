-- Walk notification measurement foundation.
--
-- Per the Walk notification strategy, this lands *before* any walk campaign.
-- Two things have to be measurable first, or the whole strategy is unfalsifiable:
--
--   1. Which lifecycle stage each dog is in, exclusively. Most notification spam
--      is caused by a user matching two segments at once, not by bad copy.
--   2. The north-star metric: the share of tracked walks that start *without*
--      a push in the preceding hours. Open rate measures our copy; this measures
--      whether a habit is actually forming.
--
-- Both are read-only views over existing tables. No data is written or changed.
--
-- Service-role only, deliberately. These aggregate across owners, so they are
-- revoked from anon/authenticated at the bottom of this file rather than relying
-- on default privileges — a `prune_notification_cron_runs` grant slipped through
-- exactly that way in the August rebuild.

-- ── Stage assignment ────────────────────────────────────────────────────────
--
-- One row per dog. Walk is a dogs-only feature, so cats are excluded here rather
-- than filtered at every call site.
--
-- Stage is driven by *valid* walks, not total walks. A session that produced no
-- usable GPS cannot be the subject of a post-walk insight, and counting it would
-- promote an owner into a stage whose campaigns have nothing to say to them.
-- Both counts are exposed so the choice stays visible and reversible.
--
-- Order of the CASE arms matters and encodes two rules:
--   - Never-walked outranks lapsed, so an owner who has never tried the feature
--     is a discovery target, not a re-engagement target.
--   - Lapsed outranks every walk-count band, so a habitual owner who stops is
--     handled by the re-engagement path rather than kept on formation nudges.

CREATE OR REPLACE VIEW public.walk_notification_stage AS
WITH walks AS (
  SELECT
    w.pet_id,
    count(*)                                                        AS walks_total,
    count(*) FILTER (WHERE w.validation_verdict = 'valid')          AS walks_valid,
    min(w.started_at) FILTER (WHERE w.validation_verdict = 'valid') AS first_valid_walk_at,
    max(w.started_at) FILTER (WHERE w.validation_verdict = 'valid') AS last_valid_walk_at,
    max(w.started_at)                                               AS last_walk_any_at
  FROM public.walk_sessions w
  GROUP BY w.pet_id
),
-- Walks logged by hand, with no tracked session attached. This is the discovery
-- audience: people who demonstrably walk their dog and have never brought
-- Pawtchi along.
manual AS (
  SELECT
    a.pet_id,
    count(*)          AS manual_walks,
    max(a.completed_at) AS last_manual_walk_at
  FROM public.activities a
  WHERE a.activity_type = 'walk'
    AND a.status = 'completed'
    AND a.walk_session_id IS NULL
  GROUP BY a.pet_id
)
SELECT
  p.owner_id,
  p.id                                    AS pet_id,
  p.name                                  AS pet_name,
  p.walksign,
  p.walksign_status,
  coalesce(w.walks_total, 0)              AS walks_total,
  coalesce(w.walks_valid, 0)              AS walks_valid,
  coalesce(m.manual_walks, 0)             AS manual_walks,
  w.first_valid_walk_at,
  w.last_valid_walk_at,
  w.last_walk_any_at,
  m.last_manual_walk_at,
  CASE
    WHEN w.last_valid_walk_at IS NULL THEN NULL
    ELSE (EXTRACT(EPOCH FROM (now() - w.last_valid_walk_at)) / 86400)::int
  END                                     AS days_since_valid_walk,
  CASE
    WHEN coalesce(w.walks_valid, 0) = 0                              THEN 'discovery'
    WHEN now() - w.last_valid_walk_at >= interval '21 days'           THEN 'lapsed'
    WHEN w.walks_valid = 1                                            THEN 'first_walk'
    WHEN w.walks_valid BETWEEN 2 AND 4                                THEN 'fragile'
    WHEN w.walks_valid BETWEEN 5 AND 19                               THEN 'formation'
    ELSE                                                                   'regular'
  END                                     AS stage
FROM public.pets p
LEFT JOIN walks  w ON w.pet_id = p.id
LEFT JOIN manual m ON m.pet_id = p.id
WHERE p.species = 'dog';

COMMENT ON VIEW public.walk_notification_stage IS
  'Exclusive walk-lifecycle stage per dog: discovery | first_walk | fragile | formation | regular | lapsed. Stage is driven by valid walks; walks_total is exposed alongside so the distinction stays auditable. Service role only.';

-- ── North-star metric ───────────────────────────────────────────────────────
--
-- A walk is "prompted" if any push reached the owner in the window before it
-- started. The 4-hour window is deliberately generous: the claim we want to be
-- able to defend is "this walk happened without us", so attribution should err
-- toward crediting the notification.
--
-- The goal is for unprompted_pct to RISE while notification volume falls. If
-- both rise together the strategy has built a treadmill rather than a habit.

CREATE OR REPLACE VIEW public.walk_prompt_attribution AS
SELECT
  w.id            AS walk_id,
  w.owner_id,
  w.pet_id,
  w.started_at,
  w.validation_verdict,
  EXISTS (
    SELECT 1
    FROM public.notification_history nh
    WHERE nh.user_id = w.owner_id
      AND nh.sent_at IS NOT NULL
      AND nh.sent_at <= w.started_at
      AND nh.sent_at >  w.started_at - interval '4 hours'
  )               AS was_prompted
FROM public.walk_sessions w
WHERE w.validation_verdict = 'valid';

COMMENT ON VIEW public.walk_prompt_attribution IS
  'Per-walk attribution: did a push reach this owner in the 4h before the walk started? Grain for the unprompted walk rate. Service role only.';

CREATE OR REPLACE VIEW public.walk_unprompted_rate AS
SELECT
  date_trunc('week', started_at)::date              AS week,
  count(*)                                          AS walks,
  count(*) FILTER (WHERE NOT was_prompted)          AS unprompted_walks,
  round(
    100.0 * count(*) FILTER (WHERE NOT was_prompted) / nullif(count(*), 0),
    1
  )                                                 AS unprompted_pct
FROM public.walk_prompt_attribution
GROUP BY 1;

COMMENT ON VIEW public.walk_unprompted_rate IS
  'North-star metric for the walk habit: weekly share of valid walks started with no push in the preceding 4 hours. Success is this rising while notification volume falls. Service role only.';

-- ── Access ──────────────────────────────────────────────────────────────────
-- Operational views that aggregate across owners. No client ever reads these.

REVOKE ALL ON public.walk_notification_stage  FROM anon, authenticated;
REVOKE ALL ON public.walk_prompt_attribution  FROM anon, authenticated;
REVOKE ALL ON public.walk_unprompted_rate     FROM anon, authenticated;

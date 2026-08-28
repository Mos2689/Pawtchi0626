-- Candidate selection for the post-walk insight campaign.
--
-- Separate from get_notification_candidates() on purpose. That function answers
-- "who is due a scheduled push right now" and runs against every user. This one
-- is event-driven: it answers "which walks just ended and have something worth
-- saying about them", and its candidate set is a handful of rows per run.
--
-- All the arithmetic lives here rather than in the edge function because it is
-- all history comparison — longest in N days, streets not seen before, routes
-- repeated this week. Doing that per-candidate over the wire would be the same
-- N+1 pattern that made the retired pet-reminders function take 40 seconds at
-- 34 tokens.
--
-- The *decision* still belongs to lib/notifications/walkInsights.ts, which is
-- byte-mirrored into the edge function. This returns facts; the shared engine
-- picks the insight, so the app and the server can never disagree about what
-- counts as interesting.

CREATE OR REPLACE FUNCTION public.get_walk_insight_candidates(
  p_lookback_minutes int DEFAULT 180
)
RETURNS TABLE (
  owner_id                uuid,
  pet_id                  uuid,
  pet_name                text,
  pet_gender              text,
  walk_id                 uuid,
  walk_ended_at           timestamptz,
  timezone                text,
  quiet_hours_start       time,
  quiet_hours_end         time,
  notification_intensity  text,
  push_enabled            boolean,
  cat_walk                boolean,
  sniff_count             int,
  longest_pause_seconds   int,
  new_street_count        int,
  days_since_longer_walk  int,
  rising_weeks            int,
  route_repeats_this_week int,
  recent_kinds            text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH candidate AS (
    SELECT w.*
    FROM public.walk_sessions w
    WHERE w.validation_verdict = 'valid'
      AND w.ended_at IS NOT NULL
      AND w.ended_at > now() - make_interval(mins => p_lookback_minutes)
      -- Claim-before-send means a walk already notified has a ledger row keyed
      -- on its id. Without this the dispatcher would re-send every 15 minutes
      -- for the whole lookback window.
      AND NOT EXISTS (
        SELECT 1 FROM public.notification_history nh
        WHERE nh.dedupe_key = 'walk_insight:' || w.id::text
      )
  )
  SELECT
    c.owner_id,
    c.pet_id,
    p.name,
    p.gender,
    c.id,
    c.ended_at,
    pr.timezone,
    op.quiet_hours_start,
    op.quiet_hours_end,
    coalesce(op.notification_intensity, 'standard'),
    coalesce(op.push_enabled, true),
    coalesce(op.cat_walk, true),

    -- Sniff episodes are stored as [{lat,lng,dwellS}] by the v2 detector.
    jsonb_array_length(coalesce(c.sniff_points, '[]'::jsonb))::int,

    coalesce((
      SELECT max((e->>'dwellS')::int)
      FROM jsonb_array_elements(coalesce(c.sniff_points, '[]'::jsonb)) e
    ), 0),

    -- Reverse-geocoded labels this pet has never been recorded at before.
    -- Approximate by design: a label is a street, not a coordinate, so this
    -- answers "somewhere new" rather than "a step never taken".
    (
      SELECT count(*)::int
      FROM (VALUES (c.start_label), (c.end_label), (c.farthest_label)) AS l(label)
      WHERE l.label IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.walk_sessions prev
          WHERE prev.pet_id = c.pet_id
            AND prev.started_at < c.started_at
            AND l.label IN (prev.start_label, prev.end_label, prev.farthest_label)
        )
    ),

    -- "Longest in N days". Three distinct cases, and conflating them would put
    -- a false claim in a push:
    --   no prior walks           -> NULL, we cannot make the claim at all
    --   no prior walk this long  -> days since the first walk (longest ever)
    --   otherwise                -> days since the last one that beat it
    (
      SELECT CASE
        WHEN count(*) = 0 THEN NULL
        WHEN max(prev.started_at) FILTER (WHERE prev.distance_m >= c.distance_m) IS NULL
          THEN (EXTRACT(EPOCH FROM (c.started_at - min(prev.started_at))) / 86400)::int
        ELSE (EXTRACT(EPOCH FROM (
               c.started_at - max(prev.started_at) FILTER (WHERE prev.distance_m >= c.distance_m)
             )) / 86400)::int
      END
      FROM public.walk_sessions prev
      WHERE prev.pet_id = c.pet_id
        AND prev.validation_verdict = 'valid'
        AND prev.started_at < c.started_at
    ),

    -- Consecutive weeks of rising average duration, counting back from the most
    -- recent. bool_and over a newest-first window stays true only while every
    -- week so far rose, so counting those rows gives the current streak rather
    -- than the total number of rising weeks in the period.
    coalesce((
      WITH weekly AS (
        SELECT date_trunc('week', started_at) AS wk, avg(duration_s) AS avg_d
        FROM public.walk_sessions
        WHERE pet_id = c.pet_id
          AND validation_verdict = 'valid'
          AND started_at > c.started_at - interval '8 weeks'
          AND started_at <= c.started_at
        GROUP BY 1
      ),
      paired AS (
        SELECT wk, avg_d > lag(avg_d) OVER (ORDER BY wk) AS rose
        FROM weekly
      )
      SELECT count(*)::int
      FROM (
        SELECT bool_and(rose) OVER (
                 ORDER BY wk DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS unbroken
        FROM paired
        WHERE rose IS NOT NULL
      ) s
      WHERE s.unbroken
    ), 0),

    (
      SELECT count(*)::int
      FROM public.walk_sessions r
      WHERE r.pet_id = c.pet_id
        AND r.validation_verdict = 'valid'
        AND r.started_at > c.started_at - interval '7 days'
        AND r.started_at <= c.started_at
        AND r.start_label IS NOT DISTINCT FROM c.start_label
        AND r.farthest_label IS NOT DISTINCT FROM c.farthest_label
    ),

    -- Most recent insight shapes, newest first. The novelty guard in
    -- walkInsights.ts reads this so the same kind never lands twice running.
    coalesce((
      SELECT array_agg(v.variant ORDER BY v.sent_at DESC)
      FROM (
        SELECT nh.variant, nh.sent_at
        FROM public.notification_history nh
        WHERE nh.user_id = c.owner_id
          AND nh.campaign_key = 'walk_insight'
          AND nh.variant IS NOT NULL
        ORDER BY nh.sent_at DESC
        LIMIT 3
      ) v
    ), ARRAY[]::text[])

  FROM candidate c
  JOIN public.pets p           ON p.id = c.pet_id
  LEFT JOIN public.profiles pr ON pr.id = c.owner_id
  LEFT JOIN public.owner_preferences op ON op.owner_id = c.owner_id
  WHERE p.species = 'dog'
    AND coalesce(op.push_enabled, true)
    AND coalesce(op.cat_walk, true)
    -- A live token is a precondition, not a detail: without it the dispatcher
    -- would claim the dedupe key and burn the walk with nothing delivered.
    AND EXISTS (
      SELECT 1 FROM public.push_tokens t
      WHERE t.user_id = c.owner_id AND t.disabled_at IS NULL
    );
$$;

COMMENT ON FUNCTION public.get_walk_insight_candidates(int) IS
  'Facts for the post-walk insight campaign, one row per recently ended valid walk with no insight already sent. Returns data only — the choice of insight belongs to the mirrored engine in lib/notifications/walkInsights.ts.';

-- Service role only. This reads across owners, so no client may call it.
REVOKE ALL ON FUNCTION public.get_walk_insight_candidates(int) FROM anon, authenticated, public;

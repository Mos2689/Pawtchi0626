-- Adds tokens and cap counters to get_walk_insight_candidates().
--
-- The first cut checked that a live token *existed* but never returned it, and
-- returned no frequency-cap counters at all. Both are needed by the send path:
-- without the token there is nothing to send to, and without the counters the
-- walk pass would bypass the daily and weekly caps that every other
-- self-initiated campaign respects.
--
-- DROP then CREATE, not CREATE OR REPLACE. Postgres treats a different RETURNS
-- TABLE as a different function, so a replace either errors or — worse, as it
-- did with register_push_token in August — leaves two overloads live and makes
-- every call ambiguous.

DROP FUNCTION IF EXISTS public.get_walk_insight_candidates(int);

CREATE FUNCTION public.get_walk_insight_candidates(
  p_lookback_minutes int DEFAULT 600
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
  tokens                  text[],
  sent_today              int,
  sent_this_week          int,
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
      -- 10 hours, not 3. A walk that ends inside the owner's quiet window is
      -- held rather than dropped, and a shorter window would abandon it before
      -- the window closed. The per-walk dedupe key makes the wide lookback safe.
      AND w.ended_at > now() - make_interval(mins => p_lookback_minutes)
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

    -- Newest first, matching get_notification_candidates, so a reinstalled
    -- device wins over a stale one.
    (
      SELECT array_agg(t.token ORDER BY t.last_seen_at DESC NULLS LAST)
      FROM public.push_tokens t
      WHERE t.user_id = c.owner_id AND t.disabled_at IS NULL
    ),

    (
      SELECT count(*)::int FROM public.notification_history nh
      WHERE nh.user_id = c.owner_id AND nh.sent_at > now() - interval '1 day'
    ),
    (
      SELECT count(*)::int FROM public.notification_history nh
      WHERE nh.user_id = c.owner_id AND nh.sent_at > now() - interval '7 days'
    ),

    jsonb_array_length(coalesce(c.sniff_points, '[]'::jsonb))::int,

    coalesce((
      SELECT max((e->>'dwellS')::int)
      FROM jsonb_array_elements(coalesce(c.sniff_points, '[]'::jsonb)) e
    ), 0),

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
    AND EXISTS (
      SELECT 1 FROM public.push_tokens t
      WHERE t.user_id = c.owner_id AND t.disabled_at IS NULL
    );
$$;

COMMENT ON FUNCTION public.get_walk_insight_candidates(int) IS
  'Facts for the post-walk insight campaign, one row per recently ended valid walk with no insight already sent. Returns data only — the choice of insight belongs to the mirrored engine in lib/notifications/walkInsights.ts.';

REVOKE ALL ON FUNCTION public.get_walk_insight_candidates(int) FROM anon, authenticated, public;

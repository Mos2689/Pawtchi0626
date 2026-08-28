-- Persist OS notification permission state.
--
-- Without this we cannot tell four very different situations apart, and three
-- of them look identical in the database:
--
--   1. never asked          — 148 onboarded users who predate the primer
--   2. declined the primer  — OS prompt untouched, cheap to ask again
--   3. denied at OS level   — the one iOS prompt is spent; only recoverable
--                             through a manual trip to Settings
--   4. granted, then turned off in-app — visible today via push_enabled
--
-- Everything downstream depends on telling them apart: which recovery surface
-- to show, whether a re-ask is even possible, and whether the settings screen
-- is telling the truth. Until now `app/notifications.tsx` showed "Allow
-- notifications: ON" to someone who had denied at the OS level and would
-- never receive anything.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_permission TEXT
    CHECK (notification_permission IN ('granted', 'denied', 'undetermined')),
  ADD COLUMN IF NOT EXISTS notification_permission_at TIMESTAMPTZ,
  -- When the in-app primer was last shown. Drives the re-ask cooldown so a
  -- declined primer is retried on a value moment, not on every launch.
  ADD COLUMN IF NOT EXISTS notification_primer_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_primer_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.profiles.notification_permission IS
  'Last known OS permission status reported by the device. "denied" means the iOS prompt is spent and only Settings can recover it.';

/**
 * Records what the OS reported. Called by the app on launch and whenever the
 * permission is asked for, so the value tracks reality even when the owner
 * changes it outside the app and comes back.
 */
CREATE OR REPLACE FUNCTION public.record_notification_permission(
  p_status TEXT,
  p_primer_shown BOOLEAN DEFAULT FALSE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  IF p_status IS NOT NULL AND p_status NOT IN ('granted', 'denied', 'undetermined') THEN
    RAISE EXCEPTION 'record_notification_permission: unknown status %', p_status;
  END IF;

  UPDATE profiles
     SET notification_permission    = COALESCE(p_status, notification_permission),
         notification_permission_at = CASE
           WHEN p_status IS DISTINCT FROM notification_permission THEN NOW()
           ELSE notification_permission_at
         END,
         notification_primer_at    = CASE WHEN p_primer_shown THEN NOW()
                                          ELSE notification_primer_at END,
         notification_primer_count = notification_primer_count
                                     + CASE WHEN p_primer_shown THEN 1 ELSE 0 END,
         updated_at = NOW()
   WHERE id = auth.uid();
END;
$fn$;

REVOKE ALL ON FUNCTION public.record_notification_permission(TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_notification_permission(TEXT, BOOLEAN) TO authenticated;

-- ── Reach reporting ─────────────────────────────────────────────────────────
-- One query to answer "who can we actually reach, and why not?". This is the
-- number the whole notification engine is gated on: a perfect dispatcher that
-- reaches 18 of 161 owners is plumbing, not a growth lever.
CREATE OR REPLACE VIEW public.notification_reach AS
  WITH base AS (
    SELECT
      u.id,
      (SELECT COUNT(*) > 0 FROM pets p WHERE p.owner_id = u.id) AS has_pet,
      (SELECT COUNT(*) > 0 FROM push_tokens pt
        WHERE pt.user_id = u.id AND pt.disabled_at IS NULL) AS has_token,
      pr.notification_permission AS permission,
      COALESCE(op.push_enabled, TRUE) AS push_enabled,
      u.last_sign_in_at
    FROM auth.users u
    LEFT JOIN profiles pr ON pr.id = u.id
    LEFT JOIN owner_preferences op ON op.owner_id = u.id
  )
  SELECT
    CASE
      WHEN NOT has_pet                       THEN 'no_pet_yet'
      WHEN has_token AND push_enabled        THEN 'reachable'
      WHEN has_token AND NOT push_enabled    THEN 'off_in_app'
      WHEN permission = 'denied'             THEN 'denied_at_os'
      WHEN permission = 'undetermined'       THEN 'declined_primer'
      WHEN permission IS NULL                THEN 'never_asked'
      ELSE 'granted_no_token'
    END AS segment,
    COUNT(*) AS users,
    COUNT(*) FILTER (WHERE last_sign_in_at > NOW() - INTERVAL '30 days') AS active_30d
  FROM base
  GROUP BY 1
  ORDER BY users DESC;

REVOKE ALL ON public.notification_reach FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.notification_reach TO service_role;

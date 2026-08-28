-- Fix an overload collision introduced by 20260805000000, plus grant hygiene.
--
-- `CREATE OR REPLACE FUNCTION register_push_token(text, text, text)` does not
-- replace `register_push_token(text)` — a different argument list is a
-- different function. Both existed, and because the new one's extra arguments
-- have defaults, a one-argument call matched both:
--
--   ERROR 42725: function public.register_push_token(push_token => unknown)
--                is not unique
--
-- Every currently-installed build calls it with one argument, so push-token
-- registration was broken for all of them from the moment that migration
-- landed. Caught by `get_advisors(type: security)` flagging a mutable
-- search_path on a `register_push_token` that had supposedly been given one —
-- the giveaway that a second copy existed.
--
-- Dropping the old overload restores an unambiguous call while keeping the
-- one-argument form working through the defaults, so old and new builds both
-- resolve correctly.
--
-- Lesson for future signature changes: adding a parameter to an existing RPC
-- is a DROP-then-CREATE, never a CREATE OR REPLACE.
DROP FUNCTION IF EXISTS public.register_push_token(text);

-- ── Grant hygiene on the new SECURITY DEFINER functions ─────────────────────
-- These all guard themselves (auth.uid() checks, service-role-only callers),
-- but PostgREST exposes every public function to `anon` by default, so an
-- unauthenticated caller could at minimum probe them. Least privilege instead.

-- Housekeeping only; nothing outside the database should be able to delete
-- operational history. This one was missed entirely on first pass.
REVOKE ALL ON FUNCTION public.prune_notification_cron_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_notification_cron_runs() TO service_role;

-- Requires a session; anon has no legitimate use for it.
REVOKE ALL ON FUNCTION public.register_push_token(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_push_token(text, text, text) TO authenticated;

-- Scoped to auth.uid() internally, but anon should not reach it at all.
REVOKE ALL ON FUNCTION public.mark_notification_opened(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notification_opened(text) TO authenticated;

-- ── Document the deliberate RLS posture ─────────────────────────────────────
-- The linter flags "RLS enabled, no policies" as INFO. That is the intended
-- configuration here: RLS on with zero policies denies anon and authenticated
-- outright, while the service role bypasses RLS. These tables are operational
-- state and must never be client-readable.
COMMENT ON TABLE public.notification_alerts IS
  'Operational alerts from notify-monitor. RLS enabled with no policies on purpose: service role only, never client-readable.';
COMMENT ON TABLE public.notification_cron_runs IS
  'Maps each notification cron run to its pg_net request id so responses can be correlated. RLS enabled with no policies on purpose: service role only.';

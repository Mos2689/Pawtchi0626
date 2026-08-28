-- Create owner_preferences at signup, not lazily.
--
-- ── The bug ──────────────────────────────────────────────────────────────────
--
-- get_email_candidates() (20260809000002) INNER JOINs owner_preferences,
-- because every emailed owner needs an unsubscribe token. The 20260809000000
-- migration backfilled a row for every account that existed at the time, but
-- owner_preferences has only ever otherwise been created lazily, client-side,
-- the first time someone edits notification settings or the routine sheet
-- (useOwnerPrefsStore.upsertPrefs). Every account signed up since that backfill
-- has had no row until they happened to visit those screens — which most people
-- never do in their first session. The INNER JOIN means those owners are not
-- delayed, they are permanently invisible to the dispatcher: no welcome
-- "reading" email, no reassessment, nothing, ever, until they stumble into
-- settings.
--
-- Confirmed against production: every account created before 2026-08-11 has a
-- row (from the backfill); both accounts created after do not.
--
-- ── The fix ──────────────────────────────────────────────────────────────────
--
-- Mirror the row into existence the moment auth.users gets one, with the same
-- schema defaults the original backfill relied on. The client-side lazy
-- upsert keeps working unchanged (ON CONFLICT DO NOTHING / upsert by
-- owner_id), it just no longer has to be the *only* path that creates the row.

CREATE OR REPLACE FUNCTION public.handle_new_user_owner_preferences()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.owner_preferences (owner_id)
  VALUES (NEW.id)
  ON CONFLICT (owner_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_owner_preferences ON auth.users;

CREATE TRIGGER on_auth_user_created_owner_preferences
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_owner_preferences();

-- ── Catch-up backfill ────────────────────────────────────────────────────────
-- Covers the accounts created in the gap between the last backfill and this
-- trigger (currently 2: test1108@email.com and aptemousa@gmail.com).
INSERT INTO public.owner_preferences (owner_id)
SELECT u.id FROM auth.users u
ON CONFLICT (owner_id) DO NOTHING;

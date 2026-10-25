-- Rollback for 20261025000000_signup_username_available.sql
--
-- Safe at any time: the app treats a missing function as "unknown" (the field
-- simply stops showing free / taken), and the username is still checked when
-- it is claimed on onboarding/finish.

DROP FUNCTION IF EXISTS public.signup_username_available(TEXT);

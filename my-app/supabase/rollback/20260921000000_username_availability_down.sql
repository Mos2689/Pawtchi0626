-- Revert 20260921000000_username_availability.sql

DROP FUNCTION IF EXISTS public.community_username_available(TEXT);

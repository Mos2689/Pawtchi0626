-- Rollback for 20261007000000_pack_walk_cards.sql. Read-only function; the
-- meetup screen falls back to plain rows when it is missing.
DROP FUNCTION IF EXISTS public.community_pack_walk_cards(UUID, INTEGER);

-- Undo 20261002050000_trail_routes_rpc.sql. Run in the SQL editor.
-- The app falls back to its three reads the moment the function is gone.

DROP FUNCTION IF EXISTS public.community_trail_routes(UUID[]);

-- Migration: Add rate_limits table for per-user, per-endpoint rate limiting
-- Run this in Supabase SQL Editor

-- Rate limiting table: tracks request counts per user per endpoint
CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups: user + endpoint + time window
CREATE INDEX IF NOT EXISTS idx_rate_limits_lookup
  ON rate_limits (user_id, endpoint, created_at DESC);

-- Auto-cleanup: delete rate limit records older than 2 hours
-- (records only need to persist for the 1-hour window + buffer)
-- Run this as a Supabase cron job every hour:
--   SELECT cron.schedule('cleanup-rate-limits', '0 * * * *',
--     $$DELETE FROM rate_limits WHERE created_at < NOW() - INTERVAL '2 hours'$$
--   );

-- Note: RLS is intentionally NOT enabled on this table.
-- Only the service role key (used by Edge Functions) writes to it.
-- No client-side access is needed or allowed.

-- Grant usage to service role only
REVOKE ALL ON rate_limits FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON rate_limits TO service_role;

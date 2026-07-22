-- Paw Moment card v3 ("Two lines, one walk") — sniff-stop locations.
--
-- pause_points stores where each auto-pause began: [{"lat": .., "lng": ..}, ...]
-- in walk order, captured on-device at the transition into auto_paused. The
-- share card draws a loop in the dog's line at each one; rows from before
-- this column (NULL) render loop-less, which is the correct degradation.

ALTER TABLE walk_sessions
  ADD COLUMN IF NOT EXISTS pause_points JSONB;

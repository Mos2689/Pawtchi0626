-- Add completed_at timestamp to activities so feedingActivityLink (and any
-- future completion tracking) can record when an activity was marked done.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE;

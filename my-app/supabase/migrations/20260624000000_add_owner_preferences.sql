-- Owner-aware activity generation — Phase 1A
-- Adds an owner_preferences table for routine inputs (wake, sleep, work, walks,
-- weekend shift, notification prefs) and a per-meal gram target on pets so the
-- generate-schedule edge function can render feeding cards with the right
-- portion size without re-deriving it.

CREATE TABLE IF NOT EXISTS owner_preferences (
  owner_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Routine anchors
  wake_time TIME,
  bedtime TIME,
  work_start TIME,
  work_end TIME,

  -- Preferred walk windows (advisory — drives the AI archetype prompt, not the slot solver)
  walk_window_morning_start TIME,
  walk_window_morning_end TIME,
  walk_window_evening_start TIME,
  walk_window_evening_end TIME,

  -- How much later (or earlier) everything shifts on Sat/Sun. Range -2..+4.
  weekend_shifts_hours INTEGER DEFAULT 0,

  -- Notification controls
  nudge_lead_minutes INTEGER DEFAULT 10,
  quiet_hours_start TIME,
  quiet_hours_end TIME,
  notification_intensity TEXT DEFAULT 'standard'
    CHECK (notification_intensity IN ('minimal', 'standard', 'chatty')),

  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

ALTER TABLE owner_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_can_rw_own_prefs" ON owner_preferences
  FOR ALL
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

-- Per-meal portion target, stored at onboarding so the edge function doesn't
-- have to re-derive it from kcal + density. Null = caller should fall back to
-- showing "follow the bag's feeding guide" copy.
ALTER TABLE pets
  ADD COLUMN IF NOT EXISTS meal_grams_per_serving INTEGER;

-- Expand activities.activity_type CHECK to include the code-generated types
-- (feeding, water, medicine) that the schedule builder emits alongside the
-- AI-generated archetype types (walk, play, grooming, training, other).
--
-- Step 1: Drop the old constraint unconditionally.
-- Step 2: Normalise any legacy rows whose activity_type falls outside the
--         canonical set (map them to 'other' so the new constraint passes).
-- Step 3: Re-create the constraint with the full set.

ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_activity_type_check;

UPDATE activities
  SET activity_type = 'other'
  WHERE activity_type NOT IN ('walk', 'play', 'grooming', 'training', 'other', 'feeding', 'water', 'medicine');

ALTER TABLE activities
  ADD CONSTRAINT activities_activity_type_check
  CHECK (activity_type IN ('walk', 'play', 'grooming', 'training', 'other', 'feeding', 'water', 'medicine'));

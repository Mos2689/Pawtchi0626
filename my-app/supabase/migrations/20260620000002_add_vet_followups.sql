-- Migration: follow-ups + proactive check-ins for Second Opinion.
-- Run this in the Supabase SQL Editor.
--
-- A vet_questions row becomes a "case". The owner can add up to 3 follow-ups,
-- and Pawtchi can proactively check in (push + home nudge) once, extendable once.

-- ── Case-level state on the head row ──
ALTER TABLE vet_questions
  ADD COLUMN IF NOT EXISTS followup_count INT NOT NULL DEFAULT 0,   -- owner follow-ups used (cap 3)
  ADD COLUMN IF NOT EXISTS checkin_due_at TIMESTAMPTZ,              -- when the next proactive check-in fires (null = none)
  ADD COLUMN IF NOT EXISTS checkin_sent_at TIMESTAMPTZ,            -- when the last check-in push went out
  ADD COLUMN IF NOT EXISTS checkin_count INT NOT NULL DEFAULT 0,   -- proactive check-ins sent (cap 2)
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'open';    -- 'open' | 'resolved'

-- Fast lookup for the cron: cases with a due, unsent check-in.
CREATE INDEX IF NOT EXISTS idx_vet_questions_checkin_due
  ON vet_questions (checkin_due_at)
  WHERE checkin_due_at IS NOT NULL AND checkin_sent_at IS NULL;

-- ── Thread turns (one row per owner message + Pawtchi reply) ──
CREATE TABLE IF NOT EXISTS vet_followups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  question_id UUID REFERENCES vet_questions(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('followup', 'checkin')),
  owner_text TEXT NOT NULL,
  -- Pawtchi's structured reply: { answer, keyPoints[], steps[], watchFor[], vetNote, urgency, redFlag }
  answer JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vet_followups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage their own vet followups" ON vet_followups;
CREATE POLICY "Users manage their own vet followups" ON vet_followups
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_vet_followups_thread
  ON vet_followups (question_id, created_at);

-- Migration: Add vet_questions table for the "Ask Pawtchi" feature.
-- Run this in the Supabase SQL Editor.
--
-- Stores each owner-asked question and Pawtchi's structured answer. Doubles as
-- the monthly-quota source of truth: the ask-vet Edge Function counts a user's
-- rows since the start of the calendar month to enforce the 4/month cap.

CREATE TABLE IF NOT EXISTS vet_questions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  question TEXT NOT NULL,
  -- Structured answer: { answer, keyPoints[], suggestions[], vetNote, redFlag }
  answer JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE vet_questions ENABLE ROW LEVEL SECURITY;

-- Owners read/manage only their own questions (history + remaining-count query).
-- The Edge Function writes via the service-role key, which bypasses RLS.
DROP POLICY IF EXISTS "Users manage their own vet questions" ON vet_questions;
CREATE POLICY "Users manage their own vet questions" ON vet_questions
  FOR ALL USING (auth.uid() = user_id);

-- Fast monthly-count + history lookups (user + recency).
CREATE INDEX IF NOT EXISTS idx_vet_questions_user_created
  ON vet_questions (user_id, created_at DESC);

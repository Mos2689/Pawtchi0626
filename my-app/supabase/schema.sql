-- Supabase Schema Version 1.0 for PAWTCHI
-- Run this directly in your Supabase SQL Editor

-- 1. PROFILES 
-- Stores human owner information tied to Supabase Auth
CREATE TABLE profiles (
  id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL PRIMARY KEY,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
CREATE POLICY "Users can view own profile." ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON profiles FOR UPDATE USING (auth.uid() = id);

-- Function to auto-insert profile on auth signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (new.id, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();


-- 2. PETS
-- Stores pet configuration and generates RER/Macro targets
CREATE TABLE pets (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  species TEXT NOT NULL CHECK (species IN ('dog', 'cat')),
  breed TEXT,
  gender TEXT CHECK (gender IN ('male', 'female')),
  is_neutered BOOLEAN DEFAULT TRUE,
  age_years NUMERIC(4,2),
  current_weight_kg NUMERIC(5,2) NOT NULL,
  target_weight_kg NUMERIC(5,2),
  activity_level TEXT CHECK (activity_level IN ('sedentary', 'normal', 'active', 'highly_active')),
  image_url TEXT,
  target_daily_calories INTEGER,
  body_condition_score INTEGER CHECK (body_condition_score BETWEEN 1 AND 9),
  bcs_updated_at TIMESTAMP WITH TIME ZONE,
  reproductive_status TEXT,
  ideal_weight_kg NUMERIC(6,2),
  healthy_band_low_kg NUMERIC(6,2),
  healthy_band_high_kg NUMERIC(6,2),
  weight_assessment_kg NUMERIC(6,2),
  weight_assessment_bcs INTEGER CHECK (weight_assessment_bcs BETWEEN 1 AND 9),
  weight_assessed_at TIMESTAMP WITH TIME ZONE,
  weight_assessment_source TEXT,
  weight_assessment_confidence TEXT,
  weight_plan_status TEXT CHECK (weight_plan_status IN (
    'growth', 'active', 'maintenance', 'verify_change',
    'needs_reassessment', 'supervised'
  )),
  weight_plan_revision INTEGER NOT NULL DEFAULT 0,
  current_weight_logged_at TIMESTAMP WITH TIME ZONE,
  weight_journey_start_kg NUMERIC(6,2),
  weight_journey_started_at TIMESTAMP WITH TIME ZONE,
  allergies TEXT[],
  medical_conditions TEXT[],
  diet_type TEXT[],
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Enable RLS
ALTER TABLE pets ENABLE ROW LEVEL SECURITY;

-- Pets Policies
CREATE POLICY "Users can manage their own pets" ON pets 
  FOR ALL USING (auth.uid() = owner_id);

CREATE TABLE weight_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  weight_kg NUMERIC(6,2) NOT NULL CHECK (weight_kg > 0),
  notes TEXT,
  source TEXT,
  measurement_source TEXT CHECK (
    measurement_source IS NULL OR measurement_source IN (
      'manual', 'profile', 'vet_report', 'onboarding', 'device', 'migration'
    )
  ),
  source_event_id TEXT,
  logged_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (pet_id, source_event_id)
);

ALTER TABLE weight_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can manage weight logs for their pets" ON weight_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pets WHERE pets.id = weight_logs.pet_id AND pets.owner_id = auth.uid())
  );

CREATE TABLE weight_plan_assessments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  source TEXT NOT NULL CHECK (source IN (
    'onboarding', 'owner_bcs', 'guided_check', 'milestone', 'vet_report',
    'profile_change', 'life_stage', 'migration'
  )),
  assessed_at TIMESTAMP WITH TIME ZONE NOT NULL,
  assessment_weight_kg NUMERIC(6,2) NOT NULL CHECK (assessment_weight_kg > 0),
  bcs INTEGER NOT NULL CHECK (bcs BETWEEN 1 AND 9),
  breed TEXT,
  sex TEXT CHECK (sex IS NULL OR sex IN ('male', 'female')),
  age_months INTEGER,
  life_stage TEXT,
  reproductive_status TEXT,
  ideal_weight_kg NUMERIC(6,2),
  target_weight_kg NUMERIC(6,2),
  healthy_band_low_kg NUMERIC(6,2),
  healthy_band_high_kg NUMERIC(6,2),
  plan_status TEXT NOT NULL CHECK (plan_status IN (
    'growth', 'active', 'maintenance', 'verify_change',
    'needs_reassessment', 'supervised'
  )),
  confidence TEXT CHECK (confidence IS NULL OR confidence IN ('high', 'low')),
  previous_ideal_weight_kg NUMERIC(6,2),
  ideal_change_pct NUMERIC(8,5),
  superseded_revision INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  input_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (pet_id, revision)
);

ALTER TABLE weight_plan_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners manage their weight assessments" ON weight_plan_assessments
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pets WHERE pets.id = weight_plan_assessments.pet_id AND pets.owner_id = auth.uid())
  );
CREATE INDEX idx_weight_plan_assessments_pet
  ON weight_plan_assessments (pet_id, revision DESC);
CREATE INDEX idx_weight_plan_assessments_active
  ON weight_plan_assessments (pet_id, is_active)
  WHERE is_active = true;


-- 3. DAILY LOGS
-- Core habit tracking engine recording progress per pet, per day
CREATE TABLE daily_logs (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  calories_consumed INTEGER DEFAULT 0,
  treats_consumed INTEGER DEFAULT 0,
  water_ml INTEGER DEFAULT 0,
  walks_count INTEGER DEFAULT 0,
  was_goal_met BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE(pet_id, log_date) -- Ensures only one log payload per pet per day
);

-- Enable RLS
ALTER TABLE daily_logs ENABLE ROW LEVEL SECURITY;

-- Daily Logs Policies
CREATE POLICY "Users can manage logs for their pets" ON daily_logs
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pets WHERE pets.id = daily_logs.pet_id AND pets.owner_id = auth.uid())
  );


-- 4. ACTIVITIES
-- Tracks scheduled and completed activities for pets
CREATE TABLE activities (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  activity_type TEXT NOT NULL CHECK (activity_type IN ('walk', 'play', 'water', 'medicine', 'vet_visit', 'grooming', 'training', 'other')),
  title TEXT NOT NULL,
  notes TEXT,
  duration_minutes INTEGER,
  distance_km NUMERIC(5,2),
  water_ml INTEGER,
  intensity TEXT CHECK (intensity IN ('low', 'moderate', 'high')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'skipped')),
  scheduled_date DATE DEFAULT CURRENT_DATE,
  scheduled_time TIME,
  is_ai_generated BOOLEAN DEFAULT false,
  is_core_task BOOLEAN DEFAULT true
);

-- Enable RLS
ALTER TABLE activities ENABLE ROW LEVEL SECURITY;

-- Activities Policies
CREATE POLICY "Users can manage activities for their pets" ON activities
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pets WHERE pets.id = activities.pet_id AND pets.owner_id = auth.uid())
  );


-- 5. FOOD SCANS (AI Recognition History)
-- NOTE ON THIS FILE: it is a partial historical document, not the source of
-- truth. It does not describe food_pantry (added by migration) and it drifted
-- from production on food_scans for months without anyone noticing, because
-- nothing compared the two. The authoritative layout is the database itself;
-- `npm run schema:check` diffs it against supabase/schema-manifest.json.
CREATE TABLE food_scans (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  pet_id UUID REFERENCES pets(id) ON DELETE CASCADE NOT NULL,
  image_url TEXT NOT NULL,
  ai_identified_food TEXT,
  ai_estimated_calories INTEGER,
  ai_confidence_score NUMERIC(5,2),
  is_user_confirmed BOOLEAN DEFAULT FALSE,
  is_treat BOOLEAN DEFAULT FALSE,
  protein_g NUMERIC(8,2),
  carbs_g NUMERIC(8,2),
  fat_g NUMERIC(8,2),
  -- The AI's own pre-confirmation estimates, kept alongside the stored values.
  ai_estimated_protein_g REAL,
  ai_estimated_carbs_g REAL,
  ai_estimated_fats_g REAL,
  -- Which pantry item this meal counted against. Present in production since
  -- early on but absent from this file and from every migration until
  -- 20260831000001 — the exact drift that motivated schema:check.
  pantry_item_id UUID REFERENCES food_pantry(id) ON DELETE SET NULL,
  health_score SMALLINT CHECK (health_score BETWEEN 1 AND 10),
  ingredients JSONB DEFAULT '[]'::jsonb,
  food_analysis JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
  -- Provenance columns (log_date, portion_mode, meal_grams, nutrition_snapshot,
  -- kcal_basis, revision, quality, …) are added by 20260831000001.
);

CREATE INDEX food_scans_pet_treat_created_idx
  ON food_scans (pet_id, is_treat, created_at DESC);

-- Enable RLS
ALTER TABLE food_scans ENABLE ROW LEVEL SECURITY;

-- Food Scans Policies
CREATE POLICY "Users can view and create scans for their pets" ON food_scans
  FOR ALL USING (
    EXISTS (SELECT 1 FROM pets WHERE pets.id = food_scans.pet_id AND pets.owner_id = auth.uid())
  );


-- 5. STREAKS (Gamification)
CREATE TABLE streaks (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  owner_id UUID REFERENCES profiles(id) ON DELETE CASCADE UNIQUE NOT NULL,
  current_streak INTEGER DEFAULT 0,
  longest_streak INTEGER DEFAULT 0,
  paw_coins INTEGER DEFAULT 0,
  last_logged_date DATE
);

-- Enable RLS
ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;

-- Streaks Policies
CREATE POLICY "Users can view and update own streaks" ON streaks
  FOR ALL USING (auth.uid() = owner_id);

-- Setup Storage Bucket for Pet Images and Food Scans
INSERT INTO storage.buckets (id, name, public) VALUES ('public-assets', 'public-assets', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('scans', 'scans', false);

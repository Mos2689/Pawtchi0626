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
  health_score SMALLINT CHECK (health_score BETWEEN 1 AND 10),
  ingredients JSONB DEFAULT '[]'::jsonb,
  food_analysis JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
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

-- Emergency Fix: Recreate matches table with INTEGER id
-- Run this in Supabase SQL Editor

-- Step 1: Drop foreign key constraints first
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_match_id_fkey;
ALTER TABLE prediction_history DROP CONSTRAINT IF EXISTS prediction_history_match_id_fkey;

-- Step 2: Drop dependent tables (they reference matches)
DROP TABLE IF EXISTS prediction_history CASCADE;
DROP TABLE IF EXISTS gameweek_summary CASCADE;
DROP TABLE IF EXISTS predictions CASCADE;

-- Step 3: Drop and recreate matches table with INTEGER id
DROP TABLE IF EXISTS matches CASCADE;

CREATE TABLE matches (
  id INTEGER PRIMARY KEY,  -- FPL fixture ID (integer, not UUID)
  gameweek INTEGER NOT NULL,
  home_team VARCHAR(50) NOT NULL,
  away_team VARCHAR(50) NOT NULL,
  home_team_code VARCHAR(3) NOT NULL,
  away_team_code VARCHAR(3) NOT NULL,
  venue VARCHAR(100),
  kickoff_time TIMESTAMP WITH TIME ZONE NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  result VARCHAR(1), -- H, D, or A
  status VARCHAR(20) DEFAULT 'upcoming', -- upcoming, live, finished
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Step 4: Recreate predictions table with INTEGER match_id
CREATE TABLE predictions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  match_id INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  predicted_result VARCHAR(1) NOT NULL, -- H, D, or A
  home_score INTEGER NOT NULL,
  away_score INTEGER NOT NULL,
  points_earned INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, match_id)
);

-- Step 5: Recreate prediction_history table
CREATE TABLE prediction_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  match_id INTEGER REFERENCES matches(id),
  home_team VARCHAR(100),
  away_team VARCHAR(100),
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  predicted_result VARCHAR(1),
  actual_home_score INTEGER,
  actual_away_score INTEGER,
  actual_result VARCHAR(1),
  points_earned INTEGER DEFAULT 0,
  finalised_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, gameweek, match_id)
);

-- Step 6: Recreate gameweek_summary table
CREATE TABLE gameweek_summary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  total_predictions INTEGER DEFAULT 0,
  correct_results INTEGER DEFAULT 0,
  correct_scores INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  rank INTEGER,
  finalised_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, gameweek)
);

-- Step 7: Enable RLS on new tables
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gameweek_summary ENABLE ROW LEVEL SECURITY;

-- Step 8: Create RLS policies
CREATE POLICY "Anyone can read matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Users can read own predictions" ON predictions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own predictions" ON predictions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own predictions" ON predictions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can read own history" ON prediction_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can read own summary" ON gameweek_summary FOR SELECT USING (auth.uid() = user_id);

-- Step 9: Create indexes
CREATE INDEX idx_predictions_user_id ON predictions(user_id);
CREATE INDEX idx_predictions_match_id ON predictions(match_id);
CREATE INDEX idx_predictions_gameweek ON predictions(gameweek);
CREATE INDEX idx_matches_gameweek ON matches(gameweek);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_prediction_history_user ON prediction_history(user_id);
CREATE INDEX idx_prediction_history_gameweek ON prediction_history(gameweek);
CREATE INDEX idx_gameweek_summary_user ON gameweek_summary(user_id);
CREATE INDEX idx_gameweek_summary_gameweek ON gameweek_summary(gameweek);

-- Done! Now sync fixtures to populate the matches table

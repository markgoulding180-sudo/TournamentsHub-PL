-- Fix: Create missing tables after partial migration
-- Run this in Supabase SQL Editor

-- Create prediction_history table
CREATE TABLE IF NOT EXISTS prediction_history (
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

-- Create gameweek_summary table
CREATE TABLE IF NOT EXISTS gameweek_summary (
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

-- Create master_clock table
CREATE TABLE IF NOT EXISTS master_clock (
  id VARCHAR(10) PRIMARY KEY,
  current_gameweek INTEGER NOT NULL,
  last_finalised_gameweek INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  deadline TIMESTAMP WITH TIME ZONE,
  deadline_epoch BIGINT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE gameweek_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_clock ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can read own history" ON prediction_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can read own summary" ON gameweek_summary FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Anyone can read master clock" ON master_clock FOR SELECT USING (true);

-- Create indexes
CREATE INDEX idx_prediction_history_user ON prediction_history(user_id);
CREATE INDEX idx_prediction_history_gameweek ON prediction_history(gameweek);
CREATE INDEX idx_gameweek_summary_user ON gameweek_summary(user_id);
CREATE INDEX idx_gameweek_summary_gameweek ON gameweek_summary(gameweek);

-- Verify tables exist
SELECT 'matches' as table_name, COUNT(*) as rows FROM matches
UNION ALL
SELECT 'predictions', COUNT(*) FROM predictions
UNION ALL
SELECT 'prediction_history', COUNT(*) FROM prediction_history
UNION ALL
SELECT 'gameweek_summary', COUNT(*) FROM gameweek_summary
UNION ALL
SELECT 'master_clock', COUNT(*) FROM master_clock;

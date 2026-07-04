-- GB Fantasy Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table (extends Supabase Auth)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username VARCHAR(20) UNIQUE NOT NULL,
  display_name VARCHAR(50) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  total_points INTEGER DEFAULT 0,
  correct_scores INTEGER DEFAULT 0,
  current_streak INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Matches table (Premier League fixtures)
-- Uses FPL fixture ID as primary key (integer)
CREATE TABLE matches (
  id INTEGER PRIMARY KEY, -- FPL fixture ID
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

-- Predictions table (user predictions for matches)
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

-- Tournaments table
CREATE TABLE tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  gameweek INTEGER, -- NULL for season-long tournaments
  entry_fee INTEGER DEFAULT 0, -- in pounds/pence
  prize_pool INTEGER DEFAULT 0,
  top_prize INTEGER DEFAULT 0,
  max_entries INTEGER,
  current_entries INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'upcoming', -- upcoming, live, closed, finished
  opens_at TIMESTAMP WITH TIME ZONE,
  closes_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Tournament entries table
CREATE TABLE tournament_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  entry_points INTEGER DEFAULT 0,
  rank INTEGER,
  prize_won INTEGER DEFAULT 0,
  entered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

-- Row Level Security Policies

-- Users: Users can read all users, but only update their own
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read all users" ON users
  FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Matches: Everyone can read matches
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read matches" ON matches
  FOR SELECT USING (true);

-- Predictions: Users can read their own predictions, admins can read all
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own predictions" ON predictions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own predictions" ON predictions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own predictions" ON predictions
  FOR UPDATE USING (auth.uid() = user_id);

-- Tournaments: Everyone can read tournaments
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read tournaments" ON tournaments
  FOR SELECT USING (true);

-- Tournament entries: Users can read their own entries
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own entries" ON tournament_entries
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own entries" ON tournament_entries
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Functions

-- Function to calculate points for a prediction
CREATE OR REPLACE FUNCTION calculate_prediction_points()
RETURNS TRIGGER AS $$
DECLARE
  actual_result VARCHAR(1);
  predicted_result VARCHAR(1);
  points INTEGER := 0;
BEGIN
  -- Get actual match result
  SELECT result INTO actual_result FROM matches WHERE id = NEW.match_id;
  
  -- Only calculate if match is finished
  IF actual_result IS NOT NULL THEN
    predicted_result := NEW.predicted_result;
    
    -- 10 points for correct result
    IF predicted_result = actual_result THEN
      points := points + 10;
      
      -- Additional 10 points for correct score
      IF NEW.home_score = (SELECT home_score FROM matches WHERE id = NEW.match_id)
         AND NEW.away_score = (SELECT away_score FROM matches WHERE id = NEW.match_id) THEN
        points := points + 10;
      END IF;
    END IF;
    
    NEW.points_earned := points;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-calculate points
CREATE TRIGGER calculate_points_trigger
  BEFORE INSERT OR UPDATE ON predictions
  FOR EACH ROW
  EXECUTE FUNCTION calculate_prediction_points();

-- Function to update user stats after prediction
CREATE OR REPLACE FUNCTION update_user_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update user's total points
  UPDATE users
  SET total_points = (
    SELECT COALESCE(SUM(points_earned), 0) FROM predictions WHERE user_id = NEW.user_id
  ),
  correct_scores = (
    SELECT COUNT(*) FROM predictions 
    WHERE user_id = NEW.user_id AND points_earned = 20
  ),
  updated_at = NOW()
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_stats_trigger
  AFTER INSERT OR UPDATE ON predictions
  FOR EACH ROW
  EXECUTE FUNCTION update_user_stats();

-- Indexes for performance
CREATE INDEX idx_predictions_user_id ON predictions(user_id);
CREATE INDEX idx_predictions_match_id ON predictions(match_id);
CREATE INDEX idx_predictions_gameweek ON predictions(gameweek);
CREATE INDEX idx_matches_gameweek ON matches(gameweek);
CREATE INDEX idx_matches_status ON matches(status);
CREATE INDEX idx_tournaments_status ON tournaments(status);
CREATE INDEX idx_tournament_entries_tournament_id ON tournament_entries(tournament_id);
CREATE INDEX idx_tournament_entries_user_id ON tournament_entries(user_id);

-- Sample data for testing (optional - remove for production)
-- INSERT INTO matches (gameweek, home_team, away_team, home_team_code, away_team_code, venue, kickoff_time, status) VALUES
-- (34, 'Arsenal', 'Brighton', 'ARS', 'BHA', 'Emirates Stadium', '2026-04-26 12:30:00+00', 'upcoming'),
-- (34, 'Aston Villa', 'Newcastle', 'AVL', 'NEW', 'Villa Park', '2026-04-26 15:00:00+00', 'upcoming');

-- INSERT INTO tournaments (name, description, gameweek, entry_fee, prize_pool, top_prize, status, closes_at) VALUES
-- ('GW 34 Mega Pot', 'The biggest weekly tournament with massive prizes', 34, 20, 5000, 2000, 'live', '2026-04-26 12:30:00+00'),
-- ('Weekend Warrior', 'Compete in this weekend special', 34, 10, 2500, 1000, 'live', '2026-04-26 12:30:00+00');

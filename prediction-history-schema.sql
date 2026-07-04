-- Prediction History Table - Permanent record of all predictions vs actual results
CREATE TABLE prediction_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  match_id INTEGER REFERENCES matches(id),
  home_team VARCHAR(100),
  away_team VARCHAR(100),
  predicted_home_score INTEGER,
  predicted_away_score INTEGER,
  predicted_result VARCHAR(1), -- H, D, or A
  actual_home_score INTEGER,
  actual_away_score INTEGER,
  actual_result VARCHAR(1), -- H, D, or A
  points_earned INTEGER DEFAULT 0,
  finalised_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, gameweek, match_id)
);

-- Index for fast lookups
CREATE INDEX idx_prediction_history_user ON prediction_history(user_id);
CREATE INDEX idx_prediction_history_gameweek ON prediction_history(gameweek);
CREATE INDEX idx_prediction_history_user_gw ON prediction_history(user_id, gameweek);

-- Gameweek Summary Table - Stores totals per user per gameweek
CREATE TABLE gameweek_summary (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  total_predictions INTEGER DEFAULT 0,
  correct_results INTEGER DEFAULT 0,
  correct_scores INTEGER DEFAULT 0,
  total_points INTEGER DEFAULT 0,
  rank INTEGER,
  finalised_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, gameweek)
);

CREATE INDEX idx_gameweek_summary_user ON gameweek_summary(user_id);
CREATE INDEX idx_gameweek_summary_gameweek ON gameweek_summary(gameweek);

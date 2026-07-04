-- Create gameweek_summary table if it doesn't exist
CREATE TABLE IF NOT EXISTS gameweek_summary (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  gameweek integer NOT NULL,
  total_predictions integer DEFAULT 0,
  correct_results integer DEFAULT 0,
  correct_scores integer DEFAULT 0,
  total_points integer DEFAULT 0,
  finalised_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, gameweek)
);

-- Create prediction_history table if it doesn't exist
CREATE TABLE IF NOT EXISTS prediction_history (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  gameweek integer NOT NULL,
  match_id uuid REFERENCES matches(id) ON DELETE CASCADE,
  home_team text,
  away_team text,
  predicted_home_score integer,
  predicted_away_score integer,
  predicted_result text,
  actual_home_score integer,
  actual_away_score integer,
  actual_result text,
  points_earned integer DEFAULT 0,
  finalised_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, gameweek, match_id)
);

-- Now add username columns
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE tournament_entries
ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE gameweek_summary
ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE prediction_history
ADD COLUMN IF NOT EXISTS username text;

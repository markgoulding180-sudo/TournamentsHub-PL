-- Add human-readable columns to predictions table for debugging
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS home_team text,
ADD COLUMN IF NOT EXISTS away_team text;

-- Add comment explaining the columns
COMMENT ON COLUMN predictions.home_team IS 'Human-readable home team name for debugging';
COMMENT ON COLUMN predictions.away_team IS 'Human-readable away team name for debugging';

-- Create index for faster lookups by team name (if needed for debugging)
CREATE INDEX IF NOT EXISTS idx_predictions_teams ON predictions(home_team, away_team);

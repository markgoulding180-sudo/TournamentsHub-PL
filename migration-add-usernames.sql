-- Add human-readable columns for debugging across all tables

-- 1. Predictions table (already has team names, add username)
ALTER TABLE predictions 
ADD COLUMN IF NOT EXISTS username text;

-- 2. Tournament entries table
ALTER TABLE tournament_entries
ADD COLUMN IF NOT EXISTS username text;

-- 3. Gameweek summary table  
ALTER TABLE gameweek_summary
ADD COLUMN IF NOT EXISTS username text;

-- 4. Prediction history table (already has team names, add username)
ALTER TABLE prediction_history
ADD COLUMN IF NOT EXISTS username text;

-- Create function to auto-populate username on insert/update
CREATE OR REPLACE FUNCTION populate_username()
RETURNS TRIGGER AS $$
BEGIN
  -- Get username from users table
  SELECT username INTO NEW.username
  FROM users
  WHERE id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers to auto-populate username
DROP TRIGGER IF EXISTS tr_predictions_username ON predictions;
CREATE TRIGGER tr_predictions_username
  BEFORE INSERT OR UPDATE ON predictions
  FOR EACH ROW
  EXECUTE FUNCTION populate_username();

DROP TRIGGER IF EXISTS tr_tournament_entries_username ON tournament_entries;
CREATE TRIGGER tr_tournament_entries_username
  BEFORE INSERT OR UPDATE ON tournament_entries
  FOR EACH ROW
  EXECUTE FUNCTION populate_username();

DROP TRIGGER IF EXISTS tr_gameweek_summary_username ON gameweek_summary;
CREATE TRIGGER tr_gameweek_summary_username
  BEFORE INSERT OR UPDATE ON gameweek_summary
  FOR EACH ROW
  EXECUTE FUNCTION populate_username();

DROP TRIGGER IF EXISTS tr_prediction_history_username ON prediction_history;
CREATE TRIGGER tr_prediction_history_username
  BEFORE INSERT OR UPDATE ON prediction_history
  FOR EACH ROW
  EXECUTE FUNCTION populate_username();

-- Backfill existing data with usernames
UPDATE predictions p
SET username = u.username
FROM users u
WHERE p.user_id = u.id AND p.username IS NULL;

UPDATE tournament_entries te
SET username = u.username
FROM users u
WHERE te.user_id = u.id AND te.username IS NULL;

UPDATE gameweek_summary gs
SET username = u.username
FROM users u
WHERE gs.user_id = u.id AND gs.username IS NULL;

UPDATE prediction_history ph
SET username = u.username
FROM users u
WHERE ph.user_id = u.id AND ph.username IS NULL;

-- Optimized predictions schema for 100+ users
-- Stores predictions as JSON to reduce row count

-- New table: user_predictions (JSON storage)
CREATE TABLE IF NOT EXISTS user_predictions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  gameweek integer NOT NULL,
  predictions_json jsonb NOT NULL DEFAULT '[]',
  points_earned integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  UNIQUE(user_id, gameweek)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_user_predictions_user_gw ON user_predictions(user_id, gameweek);

-- Keep old predictions table for migration (can be dropped later)
-- CREATE TABLE predictions_backup AS SELECT * FROM predictions;
-- DROP TABLE predictions;

-- Note: prediction_history already stores denormalized data per match
-- This is fine as it's historical data (read-only after finalise)

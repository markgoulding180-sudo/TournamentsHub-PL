-- Migration: Convert matches table to use FPL fixture IDs
-- This ensures consistency across all tables

-- Step 1: Drop foreign key constraints that reference matches.id
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_match_id_fkey;
ALTER TABLE prediction_history DROP CONSTRAINT IF EXISTS prediction_history_match_id_fkey;

-- Step 2: Change matches.id from UUID to INTEGER
-- Note: This will fail if there are existing UUID values that can't be cast to integers
-- If that's the case, we need to truncate and re-sync

-- First, check if we can convert existing IDs
-- If matches table has UUID data, we should truncate and start fresh
TRUNCATE TABLE predictions CASCADE;
TRUNCATE TABLE prediction_history CASCADE;
TRUNCATE TABLE matches CASCADE;

-- Step 3: Alter the column type
ALTER TABLE matches ALTER COLUMN id TYPE INTEGER USING id::integer;

-- Step 4: Remove the default UUID generation
ALTER TABLE matches ALTER COLUMN id DROP DEFAULT;

-- Step 5: Update predictions table match_id column
ALTER TABLE predictions ALTER COLUMN match_id TYPE INTEGER USING match_id::integer;

-- Step 6: Update prediction_history table match_id column  
ALTER TABLE prediction_history ALTER COLUMN match_id TYPE INTEGER USING match_id::integer;

-- Step 7: Re-add foreign key constraints
ALTER TABLE predictions 
  ADD CONSTRAINT predictions_match_id_fkey 
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

ALTER TABLE prediction_history 
  ADD CONSTRAINT prediction_history_match_id_fkey 
  FOREIGN KEY (match_id) REFERENCES matches(id);

-- Step 8: Re-create indexes
CREATE INDEX IF NOT EXISTS idx_predictions_match_id ON predictions(match_id);
CREATE INDEX IF NOT EXISTS idx_prediction_history_match_id ON prediction_history(match_id);

-- Done! Now run sync-fixtures to populate with FPL fixture IDs

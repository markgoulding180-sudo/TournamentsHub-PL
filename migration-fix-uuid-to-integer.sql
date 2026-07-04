-- Emergency Fix: Change matches.id from UUID to INTEGER
-- Run this in Supabase SQL Editor

-- First, check current column type
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'matches' AND column_name = 'id';

-- If the above shows 'uuid', run these commands:

-- Step 1: Drop foreign key constraints
ALTER TABLE predictions DROP CONSTRAINT IF EXISTS predictions_match_id_fkey;
ALTER TABLE prediction_history DROP CONSTRAINT IF EXISTS prediction_history_match_id_fkey;

-- Step 2: Truncate all dependent tables (data will be lost)
TRUNCATE TABLE prediction_history CASCADE;
TRUNCATE TABLE gameweek_summary CASCADE;
TRUNCATE TABLE predictions CASCADE;
TRUNCATE TABLE matches CASCADE;

-- Step 3: Alter the matches.id column to INTEGER
ALTER TABLE matches ALTER COLUMN id TYPE INTEGER USING id::integer;

-- Step 4: Alter predictions.match_id to INTEGER
ALTER TABLE predictions ALTER COLUMN match_id TYPE INTEGER USING match_id::integer;

-- Step 5: Alter prediction_history.match_id to INTEGER  
ALTER TABLE prediction_history ALTER COLUMN match_id TYPE INTEGER USING match_id::integer;

-- Step 6: Re-add foreign key constraints
ALTER TABLE predictions 
  ADD CONSTRAINT predictions_match_id_fkey 
  FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;

ALTER TABLE prediction_history 
  ADD CONSTRAINT prediction_history_match_id_fkey 
  FOREIGN KEY (match_id) REFERENCES matches(id);

-- Step 7: Verify the change
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'matches' AND column_name = 'id';

-- Should now show 'integer' instead of 'uuid'

-- Fresh Start: Delete all data except users table
-- Run this in Supabase SQL Editor

-- Disable foreign key checks temporarily (if needed)
-- Note: Supabase doesn't support this directly, so we delete in correct order

-- Step 1: Delete dependent tables first (child tables)
TRUNCATE TABLE prediction_history CASCADE;
TRUNCATE TABLE gameweek_summary CASCADE;
TRUNCATE TABLE predictions CASCADE;
TRUNCATE TABLE tournament_entries CASCADE;

-- Step 2: Delete parent tables
TRUNCATE TABLE matches CASCADE;
TRUNCATE TABLE tournaments CASCADE;

-- Step 3: Reset master clock (optional - keeps table structure)
DELETE FROM master_clock WHERE id = 'current';

-- Verify what's left (should only be users)
SELECT 'users' as table_name, COUNT(*) as row_count FROM users
UNION ALL
SELECT 'matches', COUNT(*) FROM matches
UNION ALL
SELECT 'predictions', COUNT(*) FROM predictions
UNION ALL
SELECT 'tournaments', COUNT(*) FROM tournaments
UNION ALL
SELECT 'tournament_entries', COUNT(*) FROM tournament_entries
UNION ALL
SELECT 'prediction_history', COUNT(*) FROM prediction_history
UNION ALL
SELECT 'gameweek_summary', COUNT(*) FROM gameweek_summary
UNION ALL
SELECT 'master_clock', COUNT(*) FROM master_clock;

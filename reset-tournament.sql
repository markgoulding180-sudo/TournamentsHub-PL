-- Reset tournament data for fresh start
-- Run this in Supabase SQL Editor

-- Step 1: Delete all tournament entries
DELETE FROM tournament_entries;

-- Step 2: Delete all tournaments
DELETE FROM tournaments;

-- Step 3: Delete all predictions (optional - keep if you want user history)
-- DELETE FROM predictions;

-- Step 4: Reset user totals (optional)
-- UPDATE users SET total_points = 0, correct_scores = 0;

-- Verification
SELECT 'Tournaments:' as table_name, COUNT(*) as count FROM tournaments
UNION ALL
SELECT 'Tournament Entries:', COUNT(*) FROM tournament_entries
UNION ALL
SELECT 'Predictions:', COUNT(*) FROM predictions;
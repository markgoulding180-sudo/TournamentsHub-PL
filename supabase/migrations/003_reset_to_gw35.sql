-- RESET: Undo GW35 finalisation - minimal version
-- Run this in Supabase SQL Editor

-- 1. Reset settings to show GW35 as current
UPDATE settings 
SET value = '{"current_gameweek": 35, "next_gameweek": 36}'
WHERE key = 'current_gameweek';

-- 2. Clear last_finalised_gameweek
DELETE FROM settings WHERE key = 'last_finalised_gameweek';

-- 3. Clear manual_gameweek override
DELETE FROM settings WHERE key = 'manual_gameweek';

-- 4. Re-open the tournament
UPDATE tournaments 
SET status = 'live'
WHERE id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

-- 5. Reset tournament entry points
UPDATE tournament_entries 
SET entry_points = 0, rank = NULL, prize_won = 0
WHERE tournament_id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

-- 6. Reset user total points
UPDATE users SET total_points = 0, correct_scores = 0;

-- 7. Clear prediction_history if table exists
-- This will fail if table doesn't exist, but that's OK
-- DELETE FROM prediction_history WHERE gameweek = 35;

-- Verify the reset
SELECT 'Settings after reset:' as info;
SELECT key, value FROM settings WHERE key IN ('current_gameweek', 'last_finalised_gameweek', 'manual_gameweek');

SELECT 'Tournament status:' as info;
SELECT id, name, gameweek, status FROM tournaments WHERE id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

SELECT 'User predictions intact:' as info;
SELECT COUNT(*) as prediction_count FROM predictions WHERE gameweek = 35;

SELECT 'Tournament entry reset:' as info;
SELECT user_id, entry_points, rank FROM tournament_entries WHERE tournament_id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

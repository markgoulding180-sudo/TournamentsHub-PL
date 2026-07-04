-- Fix the tournament that was incorrectly marked as finished
-- Re-open it so it can accumulate points across multiple gameweeks

-- First, check the current tournament state
SELECT id, name, gameweek, end_gameweek, status 
FROM tournaments 
WHERE id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

-- Re-open the tournament (set status back to 'live')
UPDATE tournaments 
SET status = 'live',
    end_gameweek = 38  -- Set end to GW38 for an 8-week tournament (GW35-GW38)
WHERE id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

-- Verify the fix
SELECT id, name, gameweek, end_gameweek, status 
FROM tournaments 
WHERE id = '2115ab8f-bae0-4839-b790-aaddcebd8312';

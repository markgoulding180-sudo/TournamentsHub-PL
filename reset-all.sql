-- COMPLETE RESET - Fresh Start (Fixed)
-- Only deletes from tables that exist

-- Delete all predictions
DELETE FROM predictions;

-- Delete all tournament entries
DELETE FROM tournament_entries;

-- Delete all tournaments
DELETE FROM tournaments;

-- Delete all matches
DELETE FROM matches;

-- Delete all users
DELETE FROM users;

-- Delete gameweek summaries (if table exists)
-- DELETE FROM gameweek_summary;

-- Verification - all should be 0
SELECT 'predictions' as table_name, COUNT(*) as count FROM predictions
UNION ALL
SELECT 'tournament_entries', COUNT(*) FROM tournament_entries
UNION ALL
SELECT 'tournaments', COUNT(*) FROM tournaments
UNION ALL
SELECT 'matches', COUNT(*) FROM matches
UNION ALL
SELECT 'users', COUNT(*) FROM users;
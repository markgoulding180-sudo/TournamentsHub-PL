-- Reset all data from GB Fantasy database
-- Run this in Supabase SQL Editor for a complete fresh start

-- Disable foreign key checks temporarily
SET session_replication_role = 'replica';

-- Delete all data from tables (in correct order to avoid FK constraints)
DELETE FROM prediction_history;
DELETE FROM gameweek_summary;
DELETE FROM predictions;
DELETE FROM tournament_entries;
DELETE FROM tournaments;
DELETE FROM matches;
DELETE FROM users;

-- Reset sequences if any
-- Note: UUIDs don't use sequences, but if you have any serial columns, reset them here

-- Re-enable foreign key checks
SET session_replication_role = 'origin';

-- Verify tables are empty
SELECT 'prediction_history' as table_name, COUNT(*) as row_count FROM prediction_history
UNION ALL
SELECT 'gameweek_summary', COUNT(*) FROM gameweek_summary
UNION ALL
SELECT 'predictions', COUNT(*) FROM predictions
UNION ALL
SELECT 'tournament_entries', COUNT(*) FROM tournament_entries
UNION ALL
SELECT 'tournaments', COUNT(*) FROM tournaments
UNION ALL
SELECT 'matches', COUNT(*) FROM matches
UNION ALL
SELECT 'users', COUNT(*) FROM users;

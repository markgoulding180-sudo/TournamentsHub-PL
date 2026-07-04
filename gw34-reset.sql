-- GB Fantasy GW34 Reset Script
-- Run this in Supabase SQL Editor

-- Step 1: Delete all existing data
DELETE FROM tournament_entries;
DELETE FROM predictions;
DELETE FROM tournaments;
DELETE FROM matches;

-- Step 2: Insert GW34 matches with actual final scores
-- Match data from FPL API event=34

INSERT INTO matches (gameweek, home_team, away_team, home_team_code, away_team_code, kickoff_time, status, home_score, away_score, result) VALUES
(34, 'Sunderland', 'Nott''m Forest', 'SUN', 'NFO', '2026-04-24T19:00:00Z', 'finished', 0, 5, 'A'),
(34, 'Fulham', 'Aston Villa', 'FUL', 'AVL', '2026-04-25T11:30:00Z', 'finished', 1, 0, 'H'),
(34, 'Liverpool', 'Crystal Palace', 'LIV', 'CRY', '2026-04-25T14:00:00Z', 'finished', 3, 1, 'H'),
(34, 'West Ham', 'Everton', 'WHU', 'EVE', '2026-04-25T14:00:00Z', 'finished', 2, 1, 'H'),
(34, 'Wolves', 'Spurs', 'WOL', 'TOT', '2026-04-25T14:00:00Z', 'finished', 0, 1, 'A'),
(34, 'Arsenal', 'Newcastle', 'ARS', 'NEW', '2026-04-25T16:30:00Z', 'finished', 1, 0, 'H'),
(34, 'Man Utd', 'Brentford', 'MUN', 'BRE', '2026-04-27T19:00:00Z', 'finished', 2, 1, 'H');

-- Step 3: Insert one test tournament
INSERT INTO tournaments (name, entry_fee, prize_pool, gameweek, status, max_entries, current_entries, closes_at, top_prize)
VALUES ('GW34 Test', 0, 0, 34, 'finished', 100, 0, '2026-04-24T17:30:00Z', 0);

-- Verification query
SELECT 'Matches inserted:' as info, COUNT(*) as count FROM matches WHERE gameweek = 34
UNION ALL
SELECT 'Tournaments inserted:', COUNT(*) FROM tournaments WHERE gameweek = 34;
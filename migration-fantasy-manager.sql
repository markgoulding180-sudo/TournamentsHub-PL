-- Fantasy Football Manager: adds squad-picking support on top of the
-- existing tournaments / tournament_entries / players tables.
-- Safe to run multiple times (IF NOT EXISTS everywhere).

-- 1. Tag tournaments with a "format" so the API knows how to score them.
--    Existing tournaments default to 'predictions' (unchanged behaviour).
ALTER TABLE tournaments
  ADD COLUMN IF NOT EXISTS format VARCHAR(20) DEFAULT 'predictions';

-- 2. Squad-picking columns on tournament_entries.
--    squad_players: JSON array of 15 FPL player ids, e.g. [351, 4, 220, ...]
--    captain_id: which of those 15 is captain (points doubled)
ALTER TABLE tournament_entries
  ADD COLUMN IF NOT EXISTS squad_players JSONB,
  ADD COLUMN IF NOT EXISTS captain_id INTEGER;

-- 3. Create the actual "Fantasy Football Manager" tournament.
--    Season-long (no single gameweek), open now, closes end of season.
--    Adjust entry_fee / prize_pool / closes_at to taste before running.
INSERT INTO tournaments (name, description, format, entry_fee, prize_pool, top_prize, max_entries, status, closes_at)
SELECT
  'Fantasy Football Manager',
  'Build your squad, score points every gameweek.',
  'fantasy_squad',
  300,          -- entry fee in pence (£3.00) — matches Hub card
  0,            -- prize pool is calculated live from entries × fee
  0,
  5000,
  'live',
  (NOW() + INTERVAL '250 days')
WHERE NOT EXISTS (
  SELECT 1 FROM tournaments WHERE format = 'fantasy_squad'
);

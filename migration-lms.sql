-- ============================================================
-- Last Man Standing: new "lms" schema in the TB-PL Supabase project
-- ============================================================
-- Run this in the SQL editor of the TB-PL project
-- (https://liuuzvboeesimvovnooh.supabase.co) — NOT PL-Master-Data.
--
-- Mirrors the shape of the existing "predictions" / "fantasy" schemas
-- (tournaments + tournament_entries), plus a new "picks" table.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS lms;

CREATE TABLE IF NOT EXISTS lms.tournaments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  gameweek INTEGER,          -- starting gameweek
  end_gameweek INTEGER,      -- optional, NULL = runs until one winner remains
  entry_fee INTEGER DEFAULT 0,   -- pence
  prize_pool INTEGER DEFAULT 0,  -- pence
  top_prize INTEGER DEFAULT 0,   -- pence
  max_entries INTEGER,
  current_entries INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'upcoming', -- upcoming, live, closed, finished
  last_processed_gameweek INTEGER, -- idempotency guard for elimination processing
  opens_at TIMESTAMP WITH TIME ZONE,
  closes_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lms.tournament_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID REFERENCES lms.tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  is_eliminated BOOLEAN DEFAULT FALSE,
  eliminated_gameweek INTEGER,
  entry_points INTEGER DEFAULT 0,
  entered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

-- One row per user per gameweek they've picked a team for.
-- The two UNIQUE constraints together give us, for free:
--   1. only one pick per user per gameweek
--   2. a team can never be picked twice by the same user in this tournament
CREATE TABLE IF NOT EXISTS lms.picks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id UUID REFERENCES lms.tournaments(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  team VARCHAR(60) NOT NULL,
  result VARCHAR(10) DEFAULT 'pending', -- pending, win, draw, lose
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(tournament_id, user_id, gameweek),
  UNIQUE(tournament_id, user_id, team)
);

ALTER TABLE lms.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms.tournament_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE lms.picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tournaments" ON lms.tournaments;
CREATE POLICY "Public read tournaments" ON lms.tournaments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read entries" ON lms.tournament_entries;
CREATE POLICY "Public read entries" ON lms.tournament_entries FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read picks" ON lms.picks;
CREATE POLICY "Public read picks" ON lms.picks FOR SELECT USING (true);

GRANT USAGE ON SCHEMA lms TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA lms TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA lms TO anon, authenticated;

-- Create the actual tournament row. Adjust entry_fee / prize_pool / dates
-- before running, or edit afterwards from /admin once that's wired up.
INSERT INTO lms.tournaments (name, description, gameweek, entry_fee, prize_pool, top_prize, max_entries, status, closes_at)
SELECT
  'Premier League Last Man Standing',
  'Pick one winning team every gameweek. Get it wrong and you''re out. Last manager standing takes the pot.',
  39,             -- adjust to whichever gameweek picks should open for
  500,            -- entry fee in pence (£5.00)
  0,              -- calculated live from entries × fee
  0,
  5000,
  'live',
  (NOW() + INTERVAL '250 days')
WHERE NOT EXISTS (
  SELECT 1 FROM lms.tournaments WHERE name = 'Premier League Last Man Standing'
);

-- ============================================================
-- IMPORTANT MANUAL STEP (can't be done via SQL):
-- Supabase dashboard -> Project Settings -> Data API -> "Exposed schemas"
-- -> add "lms" to the list (alongside predictions/fantasy/public).
-- Then also run, in the SQL editor:
--   NOTIFY pgrst, 'reload config';
--   NOTIFY pgrst, 'reload schema';
-- If the schema still doesn't show up in the API after that (a known
-- quirk noted in the project handoff — happened once with fantasy_manager),
-- rename the schema and retry: ALTER SCHEMA lms RENAME TO lms2; then back.
-- ============================================================

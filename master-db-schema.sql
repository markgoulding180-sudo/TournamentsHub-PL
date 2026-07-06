-- ============================================================
-- MASTER PREMIER LEAGUE DATA — schema for the NEW Supabase project
-- ============================================================
-- This project holds ONLY facts about the Premier League itself:
-- teams, players, fixtures/results, and the current-gameweek clock.
-- It has NO users, NO auth, NO predictions, NO tournaments — those
-- stay in each tournament app's own Supabase project.
--
-- Run this once, in the SQL editor of the brand-new Supabase project
-- you create for this (e.g. name it "TB-PL-DATA").
-- ============================================================

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  short_name VARCHAR(3),
  code INTEGER,
  strength INTEGER,
  strength_overall_home INTEGER,
  strength_overall_away INTEGER,
  strength_attack_home INTEGER,
  strength_attack_away INTEGER,
  strength_defence_home INTEGER,
  strength_defence_away INTEGER,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  first_name VARCHAR(100),
  second_name VARCHAR(100),
  web_name VARCHAR(100),
  team INTEGER REFERENCES teams(id),
  element_type INTEGER, -- 1=GK, 2=DEF, 3=MID, 4=FWD
  now_cost INTEGER,     -- tenths of £m (105 = £10.5m)
  photo VARCHAR(20),
  news TEXT,
  news_added TIMESTAMP WITH TIME ZONE,
  chance_of_playing_next_round INTEGER,
  chance_of_playing_this_round INTEGER,
  status VARCHAR(1),    -- a=available, d=doubtful, i=injured, s=suspended, n=unavailable
  form DECIMAL(4,2),
  total_points INTEGER,
  points_per_game DECIMAL(4,2),
  minutes INTEGER,
  goals_scored INTEGER,
  assists INTEGER,
  clean_sheets INTEGER,
  goals_conceded INTEGER,
  own_goals INTEGER,
  penalties_saved INTEGER,
  penalties_missed INTEGER,
  yellow_cards INTEGER,
  red_cards INTEGER,
  saves INTEGER,
  bonus INTEGER,
  bps INTEGER,
  influence DECIMAL(10,2),
  creativity DECIMAL(10,2),
  threat DECIMAL(10,2),
  ict_index DECIMAL(10,2),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_players_team ON players(team);
CREATE INDEX IF NOT EXISTS idx_players_status ON players(status);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY, -- FPL fixture ID
  gameweek INTEGER NOT NULL,
  home_team VARCHAR(50) NOT NULL,
  away_team VARCHAR(50) NOT NULL,
  home_team_code VARCHAR(3) NOT NULL,
  away_team_code VARCHAR(3) NOT NULL,
  venue VARCHAR(100),
  kickoff_time TIMESTAMP WITH TIME ZONE NOT NULL,
  home_score INTEGER,
  away_score INTEGER,
  result VARCHAR(1), -- H, D, or A
  status VARCHAR(20) DEFAULT 'upcoming', -- upcoming, live, finished
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_matches_gameweek ON matches(gameweek);

CREATE TABLE IF NOT EXISTS master_clock (
  id VARCHAR(10) PRIMARY KEY,
  current_gameweek INTEGER NOT NULL,
  last_finalised_gameweek INTEGER DEFAULT 0,
  status VARCHAR(20) DEFAULT 'active',
  deadline TIMESTAMP WITH TIME ZONE,
  deadline_epoch BIGINT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Player injury view (same convenience view the old DB had)
CREATE OR REPLACE VIEW player_injuries AS
SELECT
  p.id,
  p.first_name || ' ' || p.second_name AS full_name,
  p.web_name,
  t.name AS team_name,
  p.news AS injury_news,
  p.news_added,
  p.chance_of_playing_next_round,
  p.chance_of_playing_this_round,
  p.status,
  CASE
    WHEN p.status = 'i' THEN 'out'
    WHEN p.status = 'd' THEN 'doubt'
    WHEN p.status = 'a' AND p.news IS NOT NULL THEN 'return'
    ELSE 'available'
  END AS injury_status,
  p.photo,
  p.updated_at
FROM players p
JOIN teams t ON p.team = t.id
WHERE p.news IS NOT NULL OR p.status IN ('i', 'd', 's', 'n');

-- ---- Row Level Security: public read-only, no client-side writes ----
-- All writes happen server-side via the service_role (secret) key from the
-- sync functions, which bypasses RLS entirely — these policies only govern
-- what the public anon key is allowed to do (read).
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE master_clock ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read teams" ON teams FOR SELECT USING (true);
CREATE POLICY "Public read players" ON players FOR SELECT USING (true);
CREATE POLICY "Public read matches" ON matches FOR SELECT USING (true);
CREATE POLICY "Public read master_clock" ON master_clock FOR SELECT USING (true);

-- Teams table (required for players schema)
CREATE TABLE teams (
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
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add players table for storing player data including photos
CREATE TABLE players (
  id INTEGER PRIMARY KEY,
  first_name VARCHAR(100),
  second_name VARCHAR(100),
  web_name VARCHAR(100),
  team INTEGER REFERENCES teams(id),
  element_type INTEGER, -- 1=GK, 2=DEF, 3=MID, 4=FWD
  now_cost INTEGER, -- in tenths of millions (e.g., 105 = 10.5m)
  photo VARCHAR(20), -- filename like "51940.jpg"
  news TEXT,
  news_added TIMESTAMP,
  chance_of_playing_next_round INTEGER,
  chance_of_playing_this_round INTEGER,
  status VARCHAR(1), -- a=available, d=doubtful, i=injured, s=suspended, n=unavailable
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
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create index for team lookups
CREATE INDEX idx_players_team ON players(team);
CREATE INDEX idx_players_status ON players(status);

-- Add injury_status view for easier querying
CREATE OR REPLACE VIEW player_injuries AS
SELECT 
  p.id,
  p.first_name || ' ' || p.second_name as full_name,
  p.web_name,
  t.name as team_name,
  p.news as injury_news,
  p.news_added,
  p.chance_of_playing_next_round,
  p.chance_of_playing_this_round,
  p.status,
  CASE 
    WHEN p.status = 'i' THEN 'out'
    WHEN p.status = 'd' THEN 'doubt'
    WHEN p.status = 'a' AND p.news IS NOT NULL THEN 'return'
    ELSE 'available'
  END as injury_status,
  p.photo,
  p.updated_at
FROM players p
JOIN teams t ON p.team = t.id
WHERE p.news IS NOT NULL OR p.status IN ('i', 'd', 's', 'n');

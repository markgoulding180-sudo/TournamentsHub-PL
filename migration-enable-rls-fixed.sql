-- Enable RLS and recreate policies (drops existing first)

-- 1. Predictions table
ALTER TABLE predictions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own predictions" ON predictions;
DROP POLICY IF EXISTS "Users can insert own predictions" ON predictions;
DROP POLICY IF EXISTS "Users can update own predictions" ON predictions;

CREATE POLICY "Users can view own predictions"
  ON predictions FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own predictions"
  ON predictions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own predictions"
  ON predictions FOR UPDATE
  USING (auth.uid() = user_id);

-- 2. Tournament entries
ALTER TABLE tournament_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own entries" ON tournament_entries;
CREATE POLICY "Users can view own entries"
  ON tournament_entries FOR SELECT
  USING (auth.uid() = user_id);

-- 3. Gameweek summary
ALTER TABLE gameweek_summary ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own summary" ON gameweek_summary;
CREATE POLICY "Users can view own summary"
  ON gameweek_summary FOR SELECT
  USING (auth.uid() = user_id);

-- 4. Prediction history
ALTER TABLE prediction_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own history" ON prediction_history;
CREATE POLICY "Users can view own history"
  ON prediction_history FOR SELECT
  USING (auth.uid() = user_id);

-- 5. Master clock (public read)
ALTER TABLE master_clock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view master clock" ON master_clock;
CREATE POLICY "Anyone can view master clock"
  ON master_clock FOR SELECT
  TO PUBLIC
  USING (true);

-- 6. Matches (public read)
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view matches" ON matches;
CREATE POLICY "Anyone can view matches"
  ON matches FOR SELECT
  TO PUBLIC
  USING (true);

-- 7. Tournaments (public read)
ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Anyone can view tournaments" ON tournaments;
CREATE POLICY "Anyone can view tournaments"
  ON tournaments FOR SELECT
  TO PUBLIC
  USING (true);

-- 8. Users (own profile only)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view own profile" ON users;
CREATE POLICY "Users can view own profile"
  ON users FOR SELECT
  USING (auth.uid() = id);

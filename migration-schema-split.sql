-- ============================================================
-- Organize TB-PL's tables into per-tournament schemas
-- ============================================================
-- Run this in the SQL editor of your EXISTING "TB-PL" Supabase project
-- (NOT PL-Master-Data — that one stays untouched).
--
-- Result: three schemas inside the ONE TB-PL project —
--   public           -> users only (shared login across tournaments)
--   predictions      -> predictions, prediction_history, gameweek_summary,
--                        tournaments, tournament_entries (Score Predictions)
--   fantasy_manager  -> its own tournaments + tournament_entries
--                        (separate rows from Predictions', same shape)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS predictions;
CREATE SCHEMA IF NOT EXISTS fantasy_manager;

-- 1. Give Fantasy Manager its own tournaments/tournament_entries tables,
--    same structure as the current shared ones.
CREATE TABLE IF NOT EXISTS fantasy_manager.tournaments (LIKE public.tournaments INCLUDING ALL);
CREATE TABLE IF NOT EXISTS fantasy_manager.tournament_entries (LIKE public.tournament_entries INCLUDING ALL);

-- LIKE ... INCLUDING ALL copies columns/defaults/indexes/constraints but not
-- foreign keys or RLS policies — add those back explicitly.
ALTER TABLE fantasy_manager.tournament_entries
  DROP CONSTRAINT IF EXISTS fm_entries_tournament_fkey,
  ADD CONSTRAINT fm_entries_tournament_fkey
  FOREIGN KEY (tournament_id) REFERENCES fantasy_manager.tournaments(id) ON DELETE CASCADE;

ALTER TABLE fantasy_manager.tournament_entries
  DROP CONSTRAINT IF EXISTS fm_entries_user_fkey,
  ADD CONSTRAINT fm_entries_user_fkey
  FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;

ALTER TABLE fantasy_manager.tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE fantasy_manager.tournament_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read tournaments" ON fantasy_manager.tournaments;
CREATE POLICY "Public read tournaments" ON fantasy_manager.tournaments FOR SELECT USING (true);

DROP POLICY IF EXISTS "Public read entries" ON fantasy_manager.tournament_entries;
CREATE POLICY "Public read entries" ON fantasy_manager.tournament_entries FOR SELECT USING (true);

-- 2. Move the existing Fantasy Manager tournament (format = 'fantasy_squad')
--    and its entries out of the shared tables and into the new ones.
INSERT INTO fantasy_manager.tournaments
  SELECT * FROM public.tournaments WHERE format = 'fantasy_squad';

INSERT INTO fantasy_manager.tournament_entries
  SELECT * FROM public.tournament_entries
  WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE format = 'fantasy_squad');

DELETE FROM public.tournament_entries
  WHERE tournament_id IN (SELECT id FROM public.tournaments WHERE format = 'fantasy_squad');

DELETE FROM public.tournaments WHERE format = 'fantasy_squad';

-- 3. Move everything else (Score Predictions' own tables) into the
--    predictions schema. RLS policies move along with the tables.
ALTER TABLE public.predictions SET SCHEMA predictions;
ALTER TABLE public.prediction_history SET SCHEMA predictions;
ALTER TABLE public.gameweek_summary SET SCHEMA predictions;
ALTER TABLE public.tournaments SET SCHEMA predictions;
ALTER TABLE public.tournament_entries SET SCHEMA predictions;

-- ============================================================
-- IMPORTANT MANUAL STEP (can't be done via SQL):
-- Go to Project Settings -> API -> "Exposed schemas" in the Supabase
-- dashboard and add both "predictions" and "fantasy_manager" to the list
-- (public is there by default). Without this, the API can't see them.
-- ============================================================

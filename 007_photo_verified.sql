-- Run this in the PL-Master-Data Supabase project (not TB-PL) — the
-- `players` table lives there, shared across all games.
ALTER TABLE players ADD COLUMN IF NOT EXISTS photo_verified boolean;
-- NULL = not checked yet, true = confirmed working photo, false = confirmed
-- missing/broken (404 or similar from FPL's CDN). NULL is treated the same
-- as true everywhere the pack pool is built, so this is safe to run before
-- the verification tool has done its first pass.

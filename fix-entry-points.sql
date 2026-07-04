-- Fix existing tournament_entries data
-- Recalculates entry_points as the sum of all prediction points for each user
documentation
-- in the tournament's gameweek

UPDATE tournament_entries te
SET entry_points = (
  SELECT COALESCE(SUM(p.points_earned), 0)
  FROM predictions p
  JOIN matches m ON p.match_id = m.id
  JOIN tournaments t ON t.id = te.tournament_id
  WHERE p.user_id = te.user_id
  AND m.gameweek = t.gameweek
);

-- Verify the fix
SELECT 
  te.id,
  te.user_id,
  u.name as user_name,
  te.tournament_id,
  t.name as tournament_name,
  te.entry_points,
  (
    SELECT COALESCE(SUM(p.points_earned), 0)
    FROM predictions p
    JOIN matches m ON p.match_id = m.id
    WHERE p.user_id = te.user_id
    AND m.gameweek = t.gameweek
  ) as calculated_points
FROM tournament_entries te
JOIN users u ON te.user_id = u.id
JOIN tournaments t ON te.tournament_id = t.id
ORDER BY te.tournament_id, te.entry_points DESC;

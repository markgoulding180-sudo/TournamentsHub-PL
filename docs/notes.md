# Project Notes

## GitHub
Repo: https://github.com/markgoulding180-sudo/gb-fantasy-app

## Commits
- 2026-05-04 12:08 - Wire up homepage with live data - tournaments, leaderboard, prize pool, active players, current GW
- 2026-05-04 12:13 - Calculate live prize pool from entry fees × entries for all tournaments
- 2026-05-04 12:14 - Add current gameweek points to leaderboard API - sums points_earned from predictions
- 2026-05-04 12:22 - Add tournament entry status to homepage - show View Predictions for registered users, lock button for started tournaments
- 2026-05-04 12:25 - Update tournaments page with proper entry status checking - same logic as homepage
- 2026-05-04 12:33 - Add prediction status bar for logged-in users - shows if they've predicted for current GW
- 2026-05-04 12:45 - Fix gameweek logic - use current GW until finished, then switch to next GW
- 2026-05-04 12:52 - Update predictions page card colors to match dark stadium theme
- 2026-05-04 13:38 - Add status icons to profile predictions - green circle with tick for played, yellow circle for not played
- 2026-05-04 13:48 - Change points text color to green to match status circle for played games
- 2026-05-04 13:53 - Update Performance History chart - start from 0, light blue line with filled area
- 2026-05-04 13:56 - Add rank chart mode with inverted Y-axis showing rank swings over gameweeks
- 2026-05-04 14:01 - Add User Trends section - shows prediction distribution and most common scores across all users
- 2026-05-05 04:17 - Add manual gameweek override functions (set/clear) to admin-stats API
- 2026-05-05 04:17 - Update admin panel labels: Last Finalised / Current Gameweek (Predictions)
- 2026-05-05 04:17 - Improve finalisePoints() to call gameweek-transition with manual flag
- 2026-05-05 04:17 - Update profile prediction history to group by gameweek with summaries
- 2026-05-07 04:14 - Add trends endpoint to predictions API - shows aggregate prediction distribution across all users per match
- 2026-05-07 04:09 - Fix predictions API 500 error - removed username/home_team/away_team columns that don't exist in schema
- 2026-05-07 04:09 - Add PIN protection to admin panel - 4-digit PIN modal, shake animation on wrong PIN, session-based verification
- 2026-05-06 23:30 - Multi-gameweek tournament fix: add end_gameweek support across all files
  - frontend/admin.html: Added Start/End Gameweek inputs to Launch Tournament card
  - frontend/admin.js: Updated launchTournament() to read and send start/end gameweek
  - api/tournaments.js: Save end_gameweek when creating tournament (defaults to same GW)
  - api/live-scores.js: Sum points across full GW range using .gte/.lte queries
  - api/gameweek-transition.js: Only finish tournament when end_gameweek is reached
  - api/admin-stats.js: Sum points across full GW range in set-score and recalculate actions
  - frontend/profile.js: Fetch and sum predictions across all GWs in tournament range
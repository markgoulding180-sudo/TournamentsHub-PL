// Vercel Function: Sync players from FPL API
// GET /api/sync-players

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // This function only ever touches the shared master PL-facts project
  // (players/teams) — never the app's own users/predictions database.
  const supabase = createClient(
    process.env.MASTER_SUPABASE_URL,
    process.env.MASTER_SUPABASE_SERVICE_KEY
  );

  // Read-only mode: GET /api/sync-players?list=true
  // Returns players already stored in the DB — no FPL fetch, no writes.
  // Used by the Fantasy Manager squad builder so browsing players is cheap.
  const params = new URLSearchParams(req.query);
  if (req.method === 'GET' && params.get('list') === 'true') {
    try {
      const { data: players, error } = await supabase
        .from('players')
        .select('id, web_name, first_name, second_name, team, element_type, now_cost, total_points, event_points, form, status, photo, news, chance_of_playing_next_round, chance_of_playing_this_round, points_per_game, minutes, goals_scored, assists, clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards, red_cards, saves, bonus, bps, influence, creativity, threat, ict_index')
        .order('total_points', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch players', details: error.message });
      }

      const { data: teams } = await supabase
        .from('teams')
        .select('id, name, short_name');

      return res.status(200).json({ players: players || [], teams: teams || [] });
    } catch (error) {
      console.error('Players list error:', error);
      return res.status(500).json({ error: 'Failed to fetch players', details: error.message });
    }
  }

  try {
    // Fetch from FPL API
    const response = await fetch(FPL_BOOTSTRAP_URL);
    const data = await response.json();

    const results = {
      teams_synced: 0,
      players_synced: 0,
      errors: []
    };

    // --- Teams first: players.team is a foreign key referencing teams(id),
    // so teams must exist before players are written. ---
    const teamRows = (data.teams || []).map(team => ({
      id: team.id,
      name: team.name,
      short_name: team.short_name,
      code: team.code,
      strength: team.strength,
      strength_overall_home: team.strength_overall_home,
      strength_overall_away: team.strength_overall_away,
      strength_attack_home: team.strength_attack_home,
      strength_attack_away: team.strength_attack_away,
      strength_defence_home: team.strength_defence_home,
      strength_defence_away: team.strength_defence_away,
      updated_at: new Date().toISOString()
    }));

    if (teamRows.length > 0) {
      const { error: teamsError } = await supabase
        .from('teams')
        .upsert(teamRows, { onConflict: 'id' });

      if (teamsError) {
        results.errors.push({ stage: 'teams', error: teamsError.message });
      } else {
        results.teams_synced = teamRows.length;
      }
    }

    // --- Players: one bulk upsert instead of one request per player. ---
    const players = data.elements;
    const playerRows = players.map(player => ({
      id: player.id,
      first_name: player.first_name,
      second_name: player.second_name,
      web_name: player.web_name,
      team: player.team,
      element_type: player.element_type,
      now_cost: player.now_cost,
      photo: player.photo,
      news: player.news || null,
      news_added: player.news_added || null,
      chance_of_playing_next_round: player.chance_of_playing_next_round,
      chance_of_playing_this_round: player.chance_of_playing_this_round,
      status: player.status,
      form: parseFloat(player.form) || 0,
      total_points: player.total_points,
      event_points: player.event_points,
      points_per_game: parseFloat(player.points_per_game) || 0,
      minutes: player.minutes,
      goals_scored: player.goals_scored,
      assists: player.assists,
      clean_sheets: player.clean_sheets,
      goals_conceded: player.goals_conceded,
      own_goals: player.own_goals,
      penalties_saved: player.penalties_saved,
      penalties_missed: player.penalties_missed,
      yellow_cards: player.yellow_cards,
      red_cards: player.red_cards,
      saves: player.saves,
      bonus: player.bonus,
      bps: player.bps,
      influence: parseFloat(player.influence) || 0,
      creativity: parseFloat(player.creativity) || 0,
      threat: parseFloat(player.threat) || 0,
      ict_index: parseFloat(player.ict_index) || 0,
      updated_at: new Date().toISOString()
    }));

    // Supabase/Postgres can choke on one gigantic multi-thousand-row upsert
    // over HTTP, so chunk it — still only ~7 requests instead of 700+.
    const CHUNK_SIZE = 100;
    for (let i = 0; i < playerRows.length; i += CHUNK_SIZE) {
      const chunk = playerRows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from('players')
        .upsert(chunk, { onConflict: 'id' });

      if (error) {
        results.errors.push({ stage: 'players', chunk_start: i, error: error.message });
      } else {
        results.players_synced += chunk.length;
      }
    }

    return res.status(200).json({
      message: 'Players synced successfully',
      total: players.length,
      results
    });

  } catch (error) {
    console.error('Sync players error:', error);
    return res.status(500).json({ error: 'Failed to sync players', details: error.message });
  }
};

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

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET
    );

    // Fetch from FPL API
    const response = await fetch(FPL_BOOTSTRAP_URL);
    const data = await response.json();

    const players = data.elements;
    const results = {
      created: 0,
      updated: 0,
      errors: []
    };

    for (const player of players) {
      const playerData = {
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
      };

      // Upsert player
      const { error } = await supabase
        .from('players')
        .upsert(playerData, { onConflict: 'id' });

      if (error) {
        results.errors.push({ player: player.web_name, error: error.message });
      } else {
        // Check if this was insert or update
        const { data: existing } = await supabase
          .from('players')
          .select('id')
          .eq('id', player.id)
          .single();
        
        if (existing) {
          results.updated++;
        } else {
          results.created++;
        }
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

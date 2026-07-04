// Vercel Function: Finalise gameweek and advance Master Clock
// GET /api/gameweek-transition?manual=true
// Called by admin to finalise current GW and advance to next

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FPL_FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET
    );

    // Get Master Clock - this is the source of truth
    const { data: masterClock, error: clockError } = await supabase
      .from('master_clock')
      .select('*')
      .eq('id', 'current')
      .single();

    if (!masterClock) {
      return res.status(400).json({ 
        error: 'Master clock not initialized',
        message: 'Admin must set current gameweek first'
      });
    }

    const currentGW = masterClock.current_gameweek;
    const lastFinalisedGW = masterClock.last_finalised_gameweek || 0;

    // Check if manual finalisation is requested
    const url = new URL(req.url, `http://${req.headers.host}`);
    const isManualFinalise = url.searchParams.get('manual') === 'true';

    const result = {
      master_clock_gameweek: currentGW,
      last_finalised_gameweek: lastFinalisedGW,
      is_manual_finalise: isManualFinalise,
      actions: []
    };

    // Only allow finalising if current GW hasn't been finalised yet
    if (currentGW <= lastFinalisedGW) {
      return res.status(200).json({
        ...result,
        message: `GW${currentGW} already finalised`,
        actions: ['already_finalised']
      });
    }

    // Finalise the current gameweek
    if (isManualFinalise) {
      // Finalise points
      await finaliseGameweek(supabase, currentGW);
      result.actions.push('finalised_points');

      // Update tournament entries with final rankings
      await updateTournamentRankings(supabase, currentGW);
      result.actions.push('updated_tournament_rankings');

      // Advance Master Clock to next gameweek
      const nextGW = currentGW + 1;
      const { error: updateError } = await supabase
        .from('master_clock')
        .update({
          current_gameweek: nextGW,
          last_finalised_gameweek: currentGW,
          status: 'active',
          updated_at: new Date().toISOString()
        })
        .eq('id', 'current');

      if (updateError) {
        throw new Error('Failed to advance master clock: ' + updateError.message);
      }

      result.actions.push('advanced_master_clock');
      result.finalised_gameweek = currentGW;
      result.new_current_gameweek = nextGW;
      result.message = `Finalised GW${currentGW} and advanced to GW${nextGW}`;
    } else {
      result.message = 'No action taken (manual=true required)';
    }

    return res.status(200).json(result);

  } catch (error) {
    console.error('Gameweek transition error:', error);
    return res.status(500).json({ error: 'Transition failed', details: error.message });
  }
};

async function finaliseGameweek(supabase, gameweek) {
  // Get all finished matches for this gameweek
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .eq('gameweek', gameweek)
    .eq('status', 'finished');

  if (!matches || matches.length === 0) return;

  // Get all users who made predictions this gameweek (with usernames)
  const { data: userPredictions } = await supabase
    .from('predictions')
    .select('user_id, username')
    .eq('gameweek', gameweek);

  // Get unique user IDs and their usernames
  const userMap = {};
  userPredictions?.forEach(p => {
    userMap[p.user_id] = p.username;
  });
  const userIds = Object.keys(userMap);

  for (const userId of userIds) {
    let gwTotalPoints = 0;
    let gwCorrectResults = 0;
    let gwCorrectScores = 0;
    let gwTotalPredictions = 0;

    for (const match of matches) {
      // Get user's prediction for this match
      const { data: pred } = await supabase
        .from('predictions')
        .select('*')
        .eq('user_id', userId)
        .eq('match_id', match.id)
        .maybeSingle();

      if (pred) {
        // Calculate points
        let points = 0;
        if (pred.predicted_result === match.result) {
          points += 10;
          gwCorrectResults++;
          if (pred.home_score === match.home_score && pred.away_score === match.away_score) {
            points += 10;
            gwCorrectScores++;
          }
        }
        gwTotalPoints += points;
        gwTotalPredictions++;

        // Save to permanent prediction_history
        await supabase
          .from('prediction_history')
          .upsert({
            user_id: userId,
            username: userMap[userId] || 'Unknown',
            gameweek: gameweek,
            match_id: match.id,
            home_team: match.home_team,
            away_team: match.away_team,
            predicted_home_score: pred.home_score,
            predicted_away_score: pred.away_score,
            predicted_result: pred.predicted_result,
            actual_home_score: match.home_score,
            actual_away_score: match.away_score,
            actual_result: match.result,
            points_earned: points,
            finalised_at: new Date().toISOString()
          }, {
            onConflict: 'user_id,gameweek,match_id'
          });

        // Update the prediction record
        await supabase
          .from('predictions')
          .update({ points_earned: points })
          .eq('id', pred.id);
      }
    }

    // Save gameweek summary for this user
    await supabase
      .from('gameweek_summary')
      .upsert({
        user_id: userId,
        username: userMap[userId] || 'Unknown',
        gameweek: gameweek,
        total_predictions: gwTotalPredictions,
        correct_results: gwCorrectResults,
        correct_scores: gwCorrectScores,
        total_points: gwTotalPoints,
        finalised_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,gameweek'
      });
    
    // Update tournament entries for this user
    const { data: userTournaments } = await supabase
      .from('tournament_entries')
      .select('tournament_id, entry_points')
      .eq('user_id', userId);
    
    for (const entry of userTournaments || []) {
      // Check if this tournament includes the current gameweek
      const { data: tournament } = await supabase
        .from('tournaments')
        .select('gameweek, end_gameweek')
        .eq('id', entry.tournament_id)
        .single();
      
      if (tournament) {
        const startGW = tournament.gameweek;
        const endGW = tournament.end_gameweek || startGW;
        
        // Check if current gameweek is within tournament range
        if (gameweek >= startGW && gameweek <= endGW) {
          // For multi-week tournaments, accumulate points
          const { data: gwSummaries } = await supabase
            .from('gameweek_summary')
            .select('total_points')
            .eq('user_id', userId)
            .gte('gameweek', startGW)
            .lte('gameweek', endGW);
          
          const totalTournamentPoints = (gwSummaries || [])
            .reduce((sum, s) => sum + (s.total_points || 0), 0);
          
          await supabase
            .from('tournament_entries')
            .update({ entry_points: totalTournamentPoints })
            .eq('tournament_id', entry.tournament_id)
            .eq('user_id', userId);
        }
      }
    }
  }

  // Update all user totals from prediction_history
  for (const userId of userIds) {
    const { data: historyPredictions } = await supabase
      .from('prediction_history')
      .select('points_earned')
      .eq('user_id', userId);

    const total = (historyPredictions || []).reduce((sum, p) => sum + (p.points_earned || 0), 0);
    const correct = (historyPredictions || []).filter(p => p.points_earned === 20).length;

    await supabase
      .from('users')
      .update({
        total_points: total,
        correct_scores: correct,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
  }

  // Clear predictions for this gameweek
  await supabase
    .from('predictions')
    .delete()
    .eq('gameweek', gameweek);
}

async function updateTournamentRankings(supabase, gameweek) {
  // Get tournaments that include this gameweek in their range
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('*')
    .lte('gameweek', gameweek)
    .gte('end_gameweek', gameweek);

  for (const tournament of tournaments || []) {
    // Get all entries sorted by points
    const { data: entries } = await supabase
      .from('tournament_entries')
      .select('*, users:user_id(*)')
      .eq('tournament_id', tournament.id)
      .order('entry_points', { ascending: false });

    // Update rankings
    for (let i = 0; i < (entries || []).length; i++) {
      const rank = i + 1;
      let prize = 0;

      if (rank === 1) prize = tournament.top_prize;
      else if (rank === 2) prize = Math.floor(tournament.top_prize * 0.5);
      else if (rank === 3) prize = Math.floor(tournament.top_prize * 0.25);

      await supabase
        .from('tournament_entries')
        .update({ rank, prize_won: prize })
        .eq('id', entries[i].id);
    }

    // Only mark tournament as finished when end_gameweek is reached
    const tournamentEndGW = tournament.end_gameweek || tournament.gameweek;
    
    if (gameweek >= tournamentEndGW) {
      await supabase
        .from('tournaments')
        .update({ status: 'finished' })
        .eq('id', tournament.id);
    }
  }
}

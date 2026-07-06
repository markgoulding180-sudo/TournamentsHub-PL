// Vercel Function: Live scores update
// GET/POST /api/live-scores

const { createClient } = require('@supabase/supabase-js');

const FPL_FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';
const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FPL_GW_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Local project: predictions/users/tournaments (scoring side-effects)
    const localDb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET
    );
    // Master project: matches — shared PL facts, synced from FPL
    const masterDb = createClient(
      process.env.MASTER_SUPABASE_URL,
      process.env.MASTER_SUPABASE_SERVICE_KEY
    );

    // Get current gameweek from FPL API directly (no settings table needed)
    const bootstrapResponse = await fetch(FPL_BOOTSTRAP_URL);
    const bootstrapData = await bootstrapResponse.json();
    
    const currentGWObj = bootstrapData.events?.find(e => e.is_current);
    const nextGWObj = bootstrapData.events?.find(e => e.is_next);
    const currentGW = currentGWObj?.id || nextGWObj?.id;

    if (!currentGW) {
      return res.status(200).json({ message: 'Could not determine current gameweek' });
    }

    console.log('Live scores - current gameweek:', currentGW);

    // Build FPL numeric team ID -> team name mapping
    const teams = bootstrapData.teams || [];
    const fplCodeToName = {};
    teams.forEach(t => {
      fplCodeToName[t.id] = t.name; // e.g. 3 -> "Arsenal"
    });

    // Fetch all fixtures for current GW
    const fixturesResponse = await fetch(`${FPL_FIXTURES_URL}?event=${currentGW}`);
    const fixtures = await fixturesResponse.json();

    const activeFixtures = fixtures.filter(f =>
      f.started || f.finished_provisional || f.finished
    );

    if (activeFixtures.length === 0) {
      return res.status(200).json({ 
        message: 'No active matches', 
        gameweek: currentGW 
      });
    }

    // Get all GW matches from our database
    const { data: dbMatches } = await masterDb
      .from('matches')
      .select('*')
      .eq('gameweek', currentGW);

    if (!dbMatches || dbMatches.length === 0) {
      return res.status(200).json({ 
        message: 'No matches found in database for GW' + currentGW,
        gameweek: currentGW
      });
    }

    const results = { updated: 0, finished: 0, provisionalToFinished: 0, live: [], errors: [], debug: {
      totalDbMatches: dbMatches.length,
      dbMatchTeams: dbMatches.map(m => `${m.home_team} vs ${m.away_team}`),
      activeFixtures: activeFixtures.length
    }};
    
    // Track matches that transition from provisional to finished
    let provisionalToFinishedCount = 0;

    console.log(`Processing ${activeFixtures.length} active fixtures for GW${currentGW}`);
    console.log('DB matches:', dbMatches.map(m => `${m.home_team} vs ${m.away_team} (status: ${m.status})`));

    for (const fixture of activeFixtures) {
      const fplHomeName = fplCodeToName[fixture.team_h];
      const fplAwayName = fplCodeToName[fixture.team_a];

      if (!fplHomeName || !fplAwayName) {
        results.errors.push(`Could not find team names for fixture ${fixture.id}`);
        continue;
      }

      // Match by team name (case-insensitive, partial match for names like "Nott'm Forest")
      // Try exact match first, then partial
      let dbMatch = dbMatches.find(m => {
        const dbHome = m.home_team.toLowerCase().trim();
        const dbAway = m.away_team.toLowerCase().trim();
        const fplHome = fplHomeName.toLowerCase().trim();
        const fplAway = fplAwayName.toLowerCase().trim();
        
        // Exact match
        if (dbHome === fplHome && dbAway === fplAway) return true;
        
        // Contains match (for shortened names)
        const homeMatch = dbHome.includes(fplHome) || fplHome.includes(dbHome) ||
                         dbHome.replace(/[^a-z]/g, '').includes(fplHome.replace(/[^a-z]/g, '')) ||
                         fplHome.replace(/[^a-z]/g, '').includes(dbHome.replace(/[^a-z]/g, ''));
        const awayMatch = dbAway.includes(fplAway) || fplAway.includes(dbAway) ||
                         dbAway.replace(/[^a-z]/g, '').includes(fplAway.replace(/[^a-z]/g, '')) ||
                         fplAway.replace(/[^a-z]/g, '').includes(dbAway.replace(/[^a-z]/g, ''));
        return homeMatch && awayMatch;
      });

      if (!dbMatch) {
        results.errors.push(`No DB match found for ${fplHomeName} vs ${fplAwayName}`);
        continue;
      }

      // Determine match status from FPL
      // finished_provisional = match ended, stats being finalized
      // finished = fully confirmed
      // minutes = 90+ indicates match is complete
      let status = 'upcoming';
      
      // Check if match is finished using multiple signals
      const isFinished = fixture.finished === true;
      const isProvisional = fixture.finished_provisional === true;
      const isStarted = fixture.started === true;
      const minutesPlayed = fixture.minutes || 0;
      
      // Minutes-based finish: if 100+ minutes and started, match is definitely done
      // 90 = full time, extra time can go to 95-100 minutes
      // Using 100 ensures we don't mark early during extra time
      const minutesBasedFinished = isStarted && minutesPlayed >= 100 && !isFinished && !isProvisional;
      
      if (isFinished || isProvisional || minutesBasedFinished) {
        status = 'finished';
      } else if (isStarted) {
        status = 'live';
      }
      
      const updateData = { status };

      if (fixture.team_h_score !== null && fixture.team_a_score !== null) {
        updateData.home_score = fixture.team_h_score;
        updateData.away_score = fixture.team_a_score;
      }

      // Check if transitioning from provisional to fully finished
      const wasProvisional = dbMatch.status === 'finished' && !dbMatch.result;
      const nowFullyFinished = isFinished && !isProvisional;
      if (wasProvisional && nowFullyFinished) {
        provisionalToFinishedCount++;
        console.log(`Match transitioning provisional→finished: ${fplHomeName} vs ${fplAwayName}`);
      }
      
      // Mark as finished and calculate result if game has ended
      if (status === 'finished') {
        updateData.result = fixture.team_h_score > fixture.team_a_score ? 'H' :
                           fixture.team_a_score > fixture.team_h_score ? 'A' : 'D';
        results.finished++;
        const finishReason = isFinished ? '' : (isProvisional ? ' (provisional)' : ' (minutes-based)');
        console.log(`Match finished${finishReason}: ${fplHomeName} ${fixture.team_h_score}-${fixture.team_a_score} ${fplAwayName}`);
      } else if (isStarted) {
        results.live.push({
          match_id: dbMatch.id,
          home_team: fplHomeName,
          away_team: fplAwayName,
          home: fixture.team_h_score ?? 0,
          away: fixture.team_a_score ?? 0,
          minute: fixture.minutes ?? 0
        });
        console.log(`Match live: ${fplHomeName} ${fixture.team_h_score}-${fixture.team_a_score} ${fplAwayName} (${fixture.minutes}')`);
      }

      const { error } = await masterDb
        .from('matches')
        .update(updateData)
        .eq('id', dbMatch.id);

      if (!error) {
        results.updated++;
      } else {
        results.errors.push(`DB update error for ${fplHomeName} vs ${fplAwayName}: ${error.message}`);
      }
    }

    // Calculate points for finished matches
    if (results.finished > 0) {
      console.log(`Calculating points for ${results.finished} finished matches`);
      await calculatePointsForGameweek(localDb, masterDb, currentGW);
    }
    
    // Recalculate points when matches transition from provisional to fully finished
    // This ensures accuracy as FPL finalizes their data
    if (provisionalToFinishedCount > 0) {
      console.log(`Recalculating points for ${provisionalToFinishedCount} matches that transitioned provisional→finished`);
      await calculatePointsForGameweek(localDb, masterDb, currentGW);
      results.provisionalToFinished = provisionalToFinishedCount;
    }

    return res.status(200).json({
      message: 'Live scores updated',
      gameweek: currentGW,
      results
    });

  } catch (error) {
    console.error('Live scores error:', error);
    return res.status(500).json({ 
      error: 'Failed to update live scores', 
      details: error.message 
    });
  }
};

async function calculatePointsForGameweek(localDb, masterDb, gameweek) {
  console.log(`=== POINTS CALCULATION START - GW${gameweek} ===`);
  
  const { data: matches } = await masterDb
    .from('matches')
    .select('*')
    .eq('gameweek', gameweek)
    .eq('status', 'finished')
    .not('result', 'is', null);

  console.log(`Found ${matches?.length || 0} finished matches to process`);
  
  if (!matches || matches.length === 0) {
    console.log('No finished matches - skipping points calculation');
    return;
  }

  const usersToUpdate = new Set();
  let totalPredictionsScored = 0;
  let totalPointsAwarded = 0;

  for (const match of matches) {
    console.log(`\nProcessing match: ${match.home_team} ${match.home_score}-${match.away_score} ${match.away_team} [Result: ${match.result}]`);
    
    const { data: predictions } = await localDb
      .from('predictions')
      .select('*, users(username)')
      .eq('match_id', match.id);

    console.log(`  Found ${predictions?.length || 0} predictions for this match`);

    if (!predictions || predictions.length === 0) continue;

    for (const pred of predictions) {
      let points = 0;
      const username = pred.users?.username || 'unknown';
      
      console.log(`    User ${username}: Predicted ${pred.predicted_result} ${pred.home_score}-${pred.away_score}`);

      if (pred.predicted_result === match.result) {
        points += 10;
        console.log(`      ✓ Correct result (+10 pts)`);
        
        if (pred.home_score === match.home_score && pred.away_score === match.away_score) {
          points += 10;
          console.log(`      ✓✓ Exact score! (+10 pts) = 20 pts TOTAL`);
        } else {
          console.log(`      ✗ Wrong score (predicted ${pred.home_score}-${pred.away_score}, actual ${match.home_score}-${match.away_score})`);
        }
      } else {
        console.log(`      ✗ Wrong result (predicted ${pred.predicted_result}, actual ${match.result})`);
      }

      console.log(`      → Awarded ${points} points`);

      const { error } = await localDb
        .from('predictions')
        .update({ points_earned: points })
        .eq('id', pred.id);

      if (error) {
        console.log(`      ✗ ERROR updating prediction: ${error.message}`);
      }

      usersToUpdate.add(pred.user_id);
      totalPredictionsScored++;
      totalPointsAwarded += points;
    }
  }
  
  console.log(`\n=== POINTS SUMMARY ===`);
  console.log(`Predictions scored: ${totalPredictionsScored}`);
  console.log(`Total points awarded: ${totalPointsAwarded}`);
  console.log(`Users to update: ${usersToUpdate.size}`);

  // Update user total points
  console.log(`\n=== UPDATING USER TOTALS ===`);
  const { data: users } = await localDb.from('users').select('id, username');
  let usersUpdated = 0;

  for (const user of users || []) {
    const { data: userPreds } = await localDb
      .from('predictions')
      .select('points_earned')
      .eq('user_id', user.id);

    const totalPoints = (userPreds || []).reduce((sum, p) => sum + (p.points_earned || 0), 0);
    const correctScores = (userPreds || []).filter(p => p.points_earned === 20).length;

    const { error } = await localDb
      .from('users')
      .update({
        total_points: totalPoints,
        correct_scores: correctScores,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
    
    if (!error) {
      usersUpdated++;
      if (usersToUpdate.has(user.id)) {
        console.log(`  Updated ${user.username || user.id}: ${totalPoints} pts, ${correctScores} perfect scores`);
      }
    }
  }
  console.log(`Updated ${usersUpdated} users`);

  // Update tournament entry points
  console.log(`\n=== UPDATING TOURNAMENT ENTRIES ===`);
  const { data: tournaments } = await localDb
    .from('tournaments')
    .select('id, gameweek, end_gameweek, name');

  // Filter tournaments that include this gameweek in their range
  const relevantTournaments = (tournaments || []).filter(t => {
    const startGW = t.gameweek;
    const endGW = t.end_gameweek || t.gameweek;
    return gameweek >= startGW && gameweek <= endGW;
  });

  console.log(`Found ${relevantTournaments.length} tournaments covering GW${gameweek}`);

  if (relevantTournaments.length > 0) {
    for (const tournament of relevantTournaments) {
      console.log(`\nTournament: ${tournament.name} (GW${tournament.gameweek}-${tournament.end_gameweek || tournament.gameweek})`);
    }
    
    for (const userId of usersToUpdate) {
      for (const tournament of relevantTournaments) {
        const { data: entries } = await localDb
          .from('tournament_entries')
          .select('id, user_id')
          .eq('tournament_id', tournament.id)
          .eq('user_id', userId);

        if (!entries || entries.length === 0) continue;

        const startGW = tournament.gameweek;
        const endGW = tournament.end_gameweek || tournament.gameweek;

        // Get ALL matches across ALL gameweeks in the tournament range (master project)
        const { data: tournamentMatches } = await masterDb
          .from('matches')
          .select('id')
          .gte('gameweek', startGW)
          .lte('gameweek', endGW);

        const tournamentMatchIds = new Set((tournamentMatches || []).map(m => m.id));

        const { data: predPoints } = await localDb
          .from('predictions')
          .select('points_earned, match_id')
          .eq('user_id', userId);

        // Sum points across ALL gameweeks in tournament range
        const totalPoints = (predPoints || [])
          .filter(p => tournamentMatchIds.has(p.match_id))
          .reduce((sum, p) => sum + (p.points_earned || 0), 0);

        const { error } = await localDb
          .from('tournament_entries')
          .update({ entry_points: totalPoints })
          .eq('tournament_id', tournament.id)
          .eq('user_id', userId);

        if (!error) {
          console.log(`    Updated entry for user ${userId}: ${totalPoints} pts`);
        }
      }
    }

    // Recalculate ranks
    console.log(`\n=== RECALCULATING TOURNAMENT RANKS ===`);
    for (const tournament of relevantTournaments) {
      const { data: entries } = await localDb
        .from('tournament_entries')
        .select('id, entry_points, rank')
        .eq('tournament_id', tournament.id)
        .order('entry_points', { ascending: false });

      if (entries) {
        console.log(`  ${tournament.name}: ${entries.length} entries`);
        for (let i = 0; i < entries.length; i++) {
          const newRank = i + 1;
          const oldRank = entries[i].rank;
          await localDb
            .from('tournament_entries')
            .update({ rank: newRank })
            .eq('id', entries[i].id);
          if (oldRank !== newRank) {
            console.log(`    Rank change: ${oldRank} → ${newRank}`);
          }
        }
        if (entries.length > 0) {
          console.log(`    Top: ${entries[0].entry_points} pts, Bottom: ${entries[entries.length-1].entry_points} pts`);
        }
      }
    }
  }
  
  console.log(`\n=== POINTS CALCULATION COMPLETE ===`);
}
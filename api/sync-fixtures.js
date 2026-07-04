// Vercel Function: Sync fixtures from FPL API
// GET /api/sync-fixtures?gameweek=34
// This should be called by a scheduled job (Vercel cron or external cron)

const { createClient } = require('@supabase/supabase-js');

// FPL API endpoint
const FPL_FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';
const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const params = new URLSearchParams(req.query);
    const gameweek = params.get('gameweek');

    // Initialize Supabase
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET
    );

    // Fetch team data from FPL
    const teamsResponse = await fetch(FPL_BOOTSTRAP_URL);
    const bootstrapData = await teamsResponse.json();
    
    const teams = {};
    bootstrapData.teams.forEach(team => {
      teams[team.id] = {
        name: team.name,
        short_name: team.short_name
      };
    });

    // Fetch fixtures from FPL API
    const fixturesResponse = await fetch(FPL_FIXTURES_URL);
    const fixtures = await fixturesResponse.json();

    // Filter by gameweek if specified
    console.log('Sync fixtures - Total fixtures from FPL:', fixtures.length);
    console.log('Sync fixtures - Requested gameweek:', gameweek);
    
    let gameweekFixtures = gameweek 
      ? fixtures.filter(f => f.event === parseInt(gameweek))
      : fixtures;
    
    console.log('Sync fixtures - Filtered fixtures:', gameweekFixtures.length);
    console.log('Sync fixtures - Sample fixture events:', fixtures.slice(0, 5).map(f => f.event));
    
    // If no fixtures found for requested gameweek, try to find by date range
    // This handles the case where FPL hasn't assigned fixtures to gameweeks yet
    if (gameweek && gameweekFixtures.length === 0) {
      const targetGW = parseInt(gameweek);
      const currentEvent = bootstrapData.events.find(e => e.is_current);
      const nextEvent = bootstrapData.events.find(e => e.is_next);
      
      // Calculate which gameweek we're looking for relative to current
      const currentGW = currentEvent?.id || 1;
      const gwOffset = targetGW - currentGW;
      
      // Look for fixtures with null event that fall in the expected date range
      // or use the next event's deadline as a reference
      if (nextEvent && gwOffset === 1) {
        // Looking for next gameweek - use fixtures between current and next deadline
        const currentDeadline = currentEvent?.deadline_time_epoch || 0;
        const nextDeadline = nextEvent.deadline_time_epoch;
        
        gameweekFixtures = fixtures.filter(f => {
          // Include fixtures with null event that kick off after current deadline
          // and before next deadline
          if (f.event === null && f.kickoff_time) {
            const kickoffEpoch = new Date(f.kickoff_time).getTime() / 1000;
            return kickoffEpoch > currentDeadline && kickoffEpoch <= nextDeadline + 86400; // +1 day buffer
          }
          return false;
        });
        
        // Assign the target gameweek to these fixtures
        gameweekFixtures = gameweekFixtures.map(f => ({ ...f, event: targetGW }));
      }
    }

    const results = {
      created: 0,
      updated: 0,
      errors: []
    };

    console.log('Sync fixtures - Teams object keys count:', Object.keys(teams).length);
    console.log('Sync fixtures - Teams object sample:', Object.entries(teams).slice(0, 3));
    console.log('Sync fixtures - First fixture team IDs:', { team_h: gameweekFixtures[0]?.team_h, team_a: gameweekFixtures[0]?.team_a });
    
    for (const fixture of gameweekFixtures) {
      // Skip if teams not found
      if (!teams[fixture.team_h] || !teams[fixture.team_a]) {
        console.log(`Skipping fixture ${fixture.id}: team not found`, { team_h: fixture.team_h, team_a: fixture.team_a, has_team_h: !!teams[fixture.team_h], has_team_a: !!teams[fixture.team_a] });
        continue;
      }

      const matchData = {
        id: fixture.id, // Use FPL's fixture ID as primary key
        gameweek: fixture.event,
        home_team: teams[fixture.team_h].name,
        away_team: teams[fixture.team_a].name,
        home_team_code: teams[fixture.team_h].short_name,
        away_team_code: teams[fixture.team_a].short_name,
        kickoff_time: fixture.kickoff_time,
        status: mapFPLStatus(fixture.finished, fixture.started)
      };

      // Add scores if match is finished
      if (fixture.finished_provisional || fixture.finished) {
        matchData.home_score = fixture.team_h_score;
        matchData.away_score = fixture.team_a_score;
        matchData.result = calculateResult(fixture.team_h_score, fixture.team_a_score);
      }

      // Use FPL fixture ID to check if match exists
      const { data: existingMatch } = await supabase
        .from('matches')
        .select('id')
        .eq('id', fixture.id)
        .single();

      if (existingMatch) {
        // Update existing match
        const { error } = await supabase
          .from('matches')
          .update(matchData)
          .eq('id', fixture.id);

        if (error) {
          results.errors.push({ match: `${matchData.home_team} vs ${matchData.away_team}`, error: error.message });
        } else {
          results.updated++;
        }
      } else {
        // Create new match with FPL fixture ID
        const { error } = await supabase
          .from('matches')
          .insert(matchData);

        if (error) {
          results.errors.push({ match: `${matchData.home_team} vs ${matchData.away_team}`, error: error.message });
        } else {
          results.created++;
        }
      }
    }

    // If any matches were updated with results, trigger scoring
    if (results.updated > 0) {
      await calculatePointsForGameweek(supabase, gameweek);
    }

    return res.status(200).json({
      message: 'Fixtures synced successfully',
      gameweek: gameweek || 'all',
      results,
      debug: {
        totalFixtures: fixtures.length,
        filteredFixtures: gameweekFixtures.length,
        teamsLoaded: Object.keys(teams).length,
        sampleTeams: Object.entries(teams).slice(0, 3),
        sampleFixture: gameweekFixtures[0] ? {
          id: gameweekFixtures[0].id,
          event: gameweekFixtures[0].event,
          team_h: gameweekFixtures[0].team_h,
          team_a: gameweekFixtures[0].team_a
        } : null
      }
    });

  } catch (error) {
    console.error('Sync fixtures error:', error);
    return res.status(500).json({ error: 'Failed to sync fixtures', details: error.message });
  }
};

function mapFPLStatus(finished, started) {
  if (finished) return 'finished';
  if (started) return 'live';
  return 'upcoming';
}

function calculateResult(homeScore, awayScore) {
  if (homeScore > awayScore) return 'H';
  if (awayScore > homeScore) return 'A';
  return 'D';
}

async function calculatePointsForGameweek(supabase, gameweek) {
  // Get all finished matches for this gameweek
  const { data: matches } = await supabase
    .from('matches')
    .select('*')
    .eq('gameweek', gameweek)
    .eq('status', 'finished')
    .not('result', 'is', null);

  if (!matches || matches.length === 0) return;

  // Track which users need their tournament entries updated
  const usersToUpdate = new Set();

  for (const match of matches) {
    // Get all predictions for this match
    const { data: predictions } = await supabase
      .from('predictions')
      .select('*')
      .eq('match_id', match.id);

    if (!predictions) continue;

    for (const pred of predictions) {
      let points = 0;

      // 10 points for correct result
      if (pred.predicted_result === match.result) {
        points += 10;

        // Additional 10 points for correct score
        if (pred.home_score === match.home_score && pred.away_score === match.away_score) {
          points += 10;
        }
      }

      // Update prediction with points
      await supabase
        .from('predictions')
        .update({ points_earned: points })
        .eq('id', pred.id);
      
      // Track user for tournament entry update
      usersToUpdate.add(pred.user_id);
    }
  }

  // Update user totals
  const { data: users } = await supabase
    .from('users')
    .select('id');

  for (const user of users) {
    const { data: userPreds } = await supabase
      .from('predictions')
      .select('points_earned, home_score, away_score')
      .eq('user_id', user.id);

    const totalPoints = userPreds.reduce((sum, p) => sum + (p.points_earned || 0), 0);
    const correctScores = userPreds.filter(p => p.points_earned === 20).length;

    await supabase
      .from('users')
      .update({ 
        total_points: totalPoints,
        correct_scores: correctScores,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id);
  }
  
  // Update tournament entries for affected users
  // Get all tournaments for this gameweek
  const { data: tournaments } = await supabase
    .from('tournaments')
    .select('id')
    .eq('gameweek', gameweek);
  
  if (tournaments && tournaments.length > 0) {
    for (const userId of usersToUpdate) {
      for (const tournament of tournaments) {
        // Check if user is entered in this tournament
        const { data: entries } = await supabase
          .from('tournament_entries')
          .select('id')
          .eq('tournament_id', tournament.id)
          .eq('user_id', userId);
        
        if (!entries || entries.length === 0) continue;
        
        // Get all predictions for matches in this gameweek for this user
        const { data: userGameweekPreds } = await supabase
          .from('predictions')
          .select('points_earned')
          .eq('user_id', userId)
          .eq('gameweek', gameweek);
        
        const gameweekPoints = userGameweekPreds.reduce((sum, p) => sum + (p.points_earned || 0), 0);
        
        // Update the tournament entry with new points
        await supabase
          .from('tournament_entries')
          .update({ entry_points: gameweekPoints })
          .eq('tournament_id', tournament.id)
          .eq('user_id', userId);
      }
    }
    
    // Recalculate ranks for all tournaments
    for (const tournament of tournaments) {
      const { data: entries } = await supabase
        .from('tournament_entries')
        .select('id, entry_points')
        .eq('tournament_id', tournament.id)
        .order('entry_points', { ascending: false });
      
      if (entries) {
        for (let i = 0; i < entries.length; i++) {
          await supabase
            .from('tournament_entries')
            .update({ rank: i + 1 })
            .eq('id', entries[i].id);
        }
      }
    }
  }
}

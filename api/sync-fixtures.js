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

    // Debounce: only active when called from the poll (?poll=true), same
    // protection as live-scores/sync-players — many concurrent users
    // polling every 2 minutes shouldn't mean many concurrent FPL fetches.
    // Manual admin syncs always force a real fetch, since those are
    // deliberate one-off actions.
    if (params.get('poll') === 'true') {
      const { data: lastSync } = await masterDb
        .from('sync_debounce').select('last_synced_at').eq('sync_name', 'sync_fixtures').maybeSingle();
      if (lastSync && lastSync.last_synced_at) {
        const ageMs = Date.now() - new Date(lastSync.last_synced_at).getTime();
        if (ageMs < 90000) {
          return res.status(200).json({ skipped: true, reason: 'synced recently', age_seconds: Math.round(ageMs / 1000) });
        }
      }

      // Testing safety switch — ambient polling only. A real FPL sync here
      // would overwrite admin-simulated match results/status back to
      // whatever FPL's real (pre-season, blank) feed says. Manual admin
      // syncs (no ?poll=true) are still allowed through deliberately.
      const { data: clock } = await masterDb
        .from('master_clock').select('polling_paused').eq('id', 'current').maybeSingle();
      if (clock?.polling_paused) {
        return res.status(200).json({ skipped: true, reason: 'Live polling is paused for testing — resume it in /admin.' });
      }

      await masterDb.from('sync_debounce').upsert({ sync_name: 'sync_fixtures', last_synced_at: new Date().toISOString() }, { onConflict: 'sync_name' });
    }

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

    // Build every match row first (in memory, no DB calls yet)
    const matchRows = [];
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
        status: mapFPLStatus(fixture.finished, fixture.started),
        home_score: null,
        away_score: null,
        result: null
      };

      // Add scores if match is finished
      if (fixture.finished_provisional || fixture.finished) {
        matchData.home_score = fixture.team_h_score;
        matchData.away_score = fixture.team_a_score;
        matchData.result = calculateResult(fixture.team_h_score, fixture.team_a_score);
      }

      matchRows.push(matchData);
    }

    // Know which ids already existed, so we can report created vs updated
    // without doing a per-row lookup (one query instead of hundreds).
    const allIds = matchRows.map(m => m.id);
    let existingIdSet = new Set();
    if (allIds.length > 0) {
      const { data: existingRows } = await masterDb
        .from('matches')
        .select('id')
        .in('id', allIds);
      existingIdSet = new Set((existingRows || []).map(r => r.id));
    }

    // One bulk upsert per chunk instead of two DB calls per fixture.
    const CHUNK_SIZE = 100;
    for (let i = 0; i < matchRows.length; i += CHUNK_SIZE) {
      const chunk = matchRows.slice(i, i + CHUNK_SIZE);
      const { error } = await masterDb
        .from('matches')
        .upsert(chunk, { onConflict: 'id' });

      if (error) {
        chunk.forEach(m => {
          results.errors.push({ match: `${m.home_team} vs ${m.away_team}`, error: error.message });
        });
      } else {
        chunk.forEach(m => {
          if (existingIdSet.has(m.id)) {
            results.updated++;
          } else {
            results.created++;
          }
        });
      }
    }

    // If any matches were updated with results, trigger scoring
    if (results.updated > 0) {
      await calculatePointsForGameweek(localDb, masterDb, gameweek);
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

async function calculatePointsForGameweek(localDb, masterDb, gameweek) {
  // Get all finished matches for this gameweek (master project)
  const { data: matches } = await masterDb
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
    const { data: predictions } = await localDb
      .schema('predictions').from('predictions')
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
      await localDb
        .schema('predictions').from('predictions')
        .update({ points_earned: points })
        .eq('id', pred.id);
      
      // Track user for tournament entry update
      usersToUpdate.add(pred.user_id);
    }
  }

  // Update user totals
  const { data: users } = await localDb
    .from('users')
    .select('id');

  for (const user of users) {
    const { data: userPreds } = await localDb
      .schema('predictions').from('predictions')
      .select('points_earned, home_score, away_score')
      .eq('user_id', user.id);

    const totalPoints = userPreds.reduce((sum, p) => sum + (p.points_earned || 0), 0);
    const correctScores = userPreds.filter(p => p.points_earned === 20).length;

    await localDb
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
  const { data: tournaments } = await localDb
    .schema('predictions').from('tournaments')
    .select('id')
    .eq('gameweek', gameweek);
  
  if (tournaments && tournaments.length > 0) {
    for (const userId of usersToUpdate) {
      for (const tournament of tournaments) {
        // Check if user is entered in this tournament
        const { data: entries } = await localDb
          .schema('predictions').from('tournament_entries')
          .select('id')
          .eq('tournament_id', tournament.id)
          .eq('user_id', userId);
        
        if (!entries || entries.length === 0) continue;
        
        // Get all predictions for matches in this gameweek for this user
        const { data: userGameweekPreds } = await localDb
          .schema('predictions').from('predictions')
          .select('points_earned')
          .eq('user_id', userId)
          .eq('gameweek', gameweek);
        
        const gameweekPoints = userGameweekPreds.reduce((sum, p) => sum + (p.points_earned || 0), 0);
        
        // Update the tournament entry with new points
        await localDb
          .schema('predictions').from('tournament_entries')
          .update({ entry_points: gameweekPoints })
          .eq('tournament_id', tournament.id)
          .eq('user_id', userId);
      }
    }
    
    // Recalculate ranks for all tournaments
    for (const tournament of tournaments) {
      const { data: entries } = await localDb
        .schema('predictions').from('tournament_entries')
        .select('id, entry_points')
        .eq('tournament_id', tournament.id)
        .order('entry_points', { ascending: false });
      
      if (entries) {
        for (let i = 0; i < entries.length; i++) {
          await localDb
            .schema('predictions').from('tournament_entries')
            .update({ rank: i + 1 })
            .eq('id', entries[i].id);
        }
      }
    }
  }
}
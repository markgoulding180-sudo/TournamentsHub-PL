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
    // Same reasoning as api/tournaments.js — a warm serverless instance
    // can serve a stale cached response for an identical query on a
    // later request. Forcing no-store on every fetch closes this off.
    const noCacheFetch = (url, options = {}) => fetch(url, { ...options, cache: 'no-store' });

    // Local project: predictions/users/tournaments (scoring side-effects)
    const localDb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET,
      { global: { fetch: noCacheFetch } }
    );
    // Master project: matches — shared PL facts, synced from FPL
    const masterDb = createClient(
      process.env.MASTER_SUPABASE_URL,
      process.env.MASTER_SUPABASE_SERVICE_KEY,
      { global: { fetch: noCacheFetch } }
    );

    // Current gameweek comes from master_clock — the one global pointer
    // every tournament follows — not FPL's live is_current/is_next flags.
    // Otherwise this would silently update whatever gameweek FPL thinks is
    // "real world current" even if admin has deliberately set the clock
    // elsewhere (testing, review, or catching up after a delay).
    const { data: clock } = await masterDb
      .from('master_clock')
      .select('current_gameweek, polling_paused')
      .eq('id', 'current')
      .maybeSingle();

    const currentGW = clock?.current_gameweek;

    if (!currentGW) {
      return res.status(200).json({ message: 'Master clock not set — admin must set the current gameweek first' });
    }

    // Testing safety switch — while paused, real FPL data is never fetched
    // or written, so admin-generated test/simulated data for the current
    // gameweek can't be silently overwritten mid-test. Flip back off in
    // /admin before the real season needs live polling again.
    if (clock?.polling_paused) {
      return res.status(200).json({ skipped: true, reason: 'Live polling is paused for testing — resume it in /admin.' });
    }

    // Debounce: same protection as sync-players — skip if any user's poll
    // already triggered this within the last 90 seconds.
    const { data: lastSync } = await masterDb
      .from('sync_debounce').select('last_synced_at').eq('sync_name', 'live_scores').maybeSingle();
    if (lastSync && lastSync.last_synced_at) {
      const ageMs = Date.now() - new Date(lastSync.last_synced_at).getTime();
      if (ageMs < 90000) {
        return res.status(200).json({ skipped: true, reason: 'synced recently', age_seconds: Math.round(ageMs / 1000) });
      }
    }
    await masterDb.from('sync_debounce').upsert({ sync_name: 'live_scores', last_synced_at: new Date().toISOString() }, { onConflict: 'sync_name' });

    // Still need FPL's bootstrap for team-name mapping and fixture data
    const bootstrapResponse = await fetch(FPL_BOOTSTRAP_URL);
    const bootstrapData = await bootstrapResponse.json();

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
  console.log(`[PREDICTIONS_DEBUG] calculatePointsForGameweek called for gw=${gameweek}`);

  const { data: matches, error: matchesErr } = await masterDb
    .from('matches')
    .select('*')
    .eq('gameweek', gameweek)
    .eq('status', 'finished')
    .not('result', 'is', null);

  console.log(`[PREDICTIONS_DEBUG] gw=${gameweek}: finished matches found=${matches ? matches.length : 'null'}, error=${matchesErr ? matchesErr.message : 'none'}`);

  if (!matches || matches.length === 0) {
    console.log(`[PREDICTIONS_DEBUG] gw=${gameweek}: no finished matches, returning early`);
    return;
  }

  const usersToUpdate = new Set();
  let totalPredictionsScored = 0;
  let totalPointsAwarded = 0;
  const predictionUpdateRows = [];

  for (const match of matches) {
    const { data: predictions, error: predFetchErr } = await localDb
      .schema('predictions').from('predictions')
      .select('*')
      .eq('match_id', match.id);

    console.log(`[PREDICTIONS_DEBUG] gw=${gameweek} match=${match.id} (${match.home_team} v ${match.away_team}): predictions fetched=${predictions ? predictions.length : 'null'}, error=${predFetchErr ? predFetchErr.message : 'none'}`);

    if (!predictions || predictions.length === 0) continue;

    for (const pred of predictions) {
      let points = 0;
      if (pred.predicted_result === match.result) {
        points += 10;
        if (pred.home_score === match.home_score && pred.away_score === match.away_score) {
          points += 10;
        }
      }
      predictionUpdateRows.push({ id: pred.id, points_earned: points });
      usersToUpdate.add(pred.user_id);
      totalPredictionsScored++;
      totalPointsAwarded += points;
    }
  }

  console.log(`[PREDICTIONS_DEBUG] gw=${gameweek}: built ${predictionUpdateRows.length} update rows, sample=${JSON.stringify(predictionUpdateRows.slice(0, 3))}`);

  // One batch upsert instead of one .update() call per prediction — this
  // was the single biggest contributor by far to marking matches finished
  // taking so long (90+ sequential round trips confirmed for just a
  // couple of matches), and quite possibly why Fantasy/LMS processing
  // appeared to silently fail right after it in the same request.
  if (predictionUpdateRows.length > 0) {
    const { data: upsertData, error: predUpsertErr, status: upsertStatus } = await localDb
      .schema('predictions').from('predictions')
      .upsert(predictionUpdateRows, { onConflict: 'id' })
      .select('id, points_earned');
    console.log(`[PREDICTIONS_DEBUG] gw=${gameweek}: upsert status=${upsertStatus}, returned rows=${upsertData ? upsertData.length : 'null'}, error=${predUpsertErr ? JSON.stringify(predUpsertErr) : 'none'}`);
    if (predUpsertErr) console.error('Batch predictions upsert failed:', predUpsertErr);
  }
  
  console.log(`\n=== POINTS SUMMARY ===`);
  console.log(`Predictions scored: ${totalPredictionsScored}`);
  console.log(`Total points awarded: ${totalPointsAwarded}`);
  console.log(`Users to update: ${usersToUpdate.size}`);

  // Deliberately no longer touches users.total_points/correct_scores —
  // confirmed that field is never read by the real, current leaderboard
  // (api/leaderboard.js reads predictions.tournament_entries.entry_points
  // instead), so writing to it was pure dead weight: a second full loop
  // over every user in the whole system for zero visible effect.

  // Update tournament entry points
  console.log(`\n=== UPDATING TOURNAMENT ENTRIES ===`);
  const { data: tournaments } = await localDb
    .schema('predictions').from('tournaments')
    .select('id, gameweek, end_gameweek, name');

  // Filter tournaments that include this gameweek in their range
  const relevantTournaments = (tournaments || []).filter(t => {
    const startGW = t.gameweek;
    const endGW = t.end_gameweek || t.gameweek;
    return gameweek >= startGW && gameweek <= endGW;
  });

  console.log(`Found ${relevantTournaments.length} tournaments covering GW${gameweek}`);

  if (relevantTournaments.length > 0 && usersToUpdate.size > 0) {
    const userIdsArr = [...usersToUpdate];

    for (const tournament of relevantTournaments) {
      const startGW = tournament.gameweek;
      const endGW = tournament.end_gameweek || tournament.gameweek;

      // Fetch everything needed in bulk instead of a per-user,
      // per-tournament select-then-write loop.
      const { data: tournamentMatches } = await masterDb
        .from('matches').select('id').gte('gameweek', startGW).lte('gameweek', endGW);
      const tournamentMatchIds = new Set((tournamentMatches || []).map(m => m.id));

      const { data: entries } = await localDb
        .schema('predictions').from('tournament_entries')
        .select('id, user_id').eq('tournament_id', tournament.id).in('user_id', userIdsArr);
      if (!entries || entries.length === 0) continue;

      const { data: predPoints } = await localDb
        .schema('predictions').from('predictions')
        .select('user_id, points_earned, match_id').in('user_id', entries.map(e => e.user_id));

      const totalsByUser = {};
      (predPoints || []).forEach(p => {
        if (!tournamentMatchIds.has(p.match_id)) return;
        totalsByUser[p.user_id] = (totalsByUser[p.user_id] || 0) + (p.points_earned || 0);
      });

      const entryUpdateRows = entries.map(e => ({ id: e.id, entry_points: totalsByUser[e.user_id] || 0 }));

      if (entryUpdateRows.length > 0) {
        const { error: entryUpsertErr } = await localDb
          .schema('predictions').from('tournament_entries')
          .upsert(entryUpdateRows, { onConflict: 'id' });
        if (entryUpsertErr) console.error(`Batch entry_points upsert failed for ${tournament.name}:`, entryUpsertErr);
        else console.log(`  Updated ${entryUpdateRows.length} entries for ${tournament.name}`);
      }
    }

    // Recalculate ranks
    console.log(`\n=== RECALCULATING TOURNAMENT RANKS ===`);
    for (const tournament of relevantTournaments) {
      const { data: entries } = await localDb
        .schema('predictions').from('tournament_entries')
        .select('id, entry_points, rank')
        .eq('tournament_id', tournament.id)
        .order('entry_points', { ascending: false });

      if (entries && entries.length > 0) {
        const rankUpdateRows = entries.map((e, i) => ({ id: e.id, rank: i + 1 }));
        // One batch upsert instead of one .update() call per entry.
        const { error: rankErr } = await localDb
          .schema('predictions').from('tournament_entries')
          .upsert(rankUpdateRows, { onConflict: 'id' });
        if (rankErr) console.error(`Batch rank upsert failed for ${tournament.name}:`, rankErr);
        else console.log(`  ${tournament.name}: ranked ${entries.length} entries — top ${entries[0].entry_points} pts, bottom ${entries[entries.length - 1].entry_points} pts`);
      }
    }
  }
  
  console.log(`\n=== POINTS CALCULATION COMPLETE ===`);
}

// Additional named export, alongside the default handler above (which
// Vercel still uses exactly as before — this doesn't change or touch
// that at all). Lets the Stock Market test-data generator call this
// exact same, already-working points calculation directly, so a single
// test action can also correctly score Predictions — without needing to
// go through live-scores.js's own internal "did I just see FPL report a
// new finish" detection, which will never fire for admin-generated fake
// results in the first place.
module.exports.calculatePointsForGameweek = calculatePointsForGameweek;
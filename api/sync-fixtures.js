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

    // The request's own ?gameweek= is only for filtering which fixtures
    // to fetch from FPL (can legitimately be absent — the real ?poll=true
    // call never sends one, meaning "sync everything"). Scoring needs one
    // definite, reliable gameweek number, so it's sourced from
    // master_clock instead — same robust source live-scores.js already
    // uses — rather than trusting a possibly-absent request param.
    const { data: clockForScoring } = await masterDb
      .from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
    const currentGWForScoring = clockForScoring?.current_gameweek || null;

    // Read-only mode: GET /api/sync-fixtures?list=true
    // Returns every fixture, for a plain read-only display page - no sync,
    // no side effects, just the real matches data already in the DB.
    if (params.get('list') === 'true') {
      const { data: matches, error } = await masterDb
        .from('matches')
        .select('id, gameweek, home_team, away_team, home_score, away_score, status, kickoff_time, result, venue')
        .order('gameweek', { ascending: true })
        .order('kickoff_time', { ascending: true });
      if (error) return res.status(500).json({ error: 'Failed to fetch fixtures', details: error.message });
      return res.status(200).json({ matches: matches || [] });
    }

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
    if (!teamsResponse.ok) {
      const bodyText = await teamsResponse.text().catch(() => '');
      console.error(`FPL bootstrap fetch failed: ${teamsResponse.status} ${teamsResponse.statusText} — ${bodyText.slice(0, 300)}`);
      return res.status(502).json({
        error: `FPL's real API returned ${teamsResponse.status} (${teamsResponse.statusText}) when fetching team data.`,
        detail: teamsResponse.status === 429
          ? 'This looks like FPL rate-limiting us — likely from repeated syncs in a short window. Wait a few minutes and try again.'
          : 'FPL\'s API may be temporarily down or blocking this request. Check again shortly.'
      });
    }
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
    if (!fixturesResponse.ok) {
      const bodyText = await fixturesResponse.text().catch(() => '');
      console.error(`FPL fixtures fetch failed: ${fixturesResponse.status} ${fixturesResponse.statusText} — ${bodyText.slice(0, 300)}`);
      return res.status(502).json({
        error: `FPL's real API returned ${fixturesResponse.status} (${fixturesResponse.statusText}) when fetching fixtures.`,
        detail: fixturesResponse.status === 429
          ? 'This looks like FPL rate-limiting us — likely from repeated syncs in a short window. Wait a few minutes and try again.'
          : 'FPL\'s API may be temporarily down or blocking this request. Check again shortly.'
      });
    }
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
        status: mapFPLStatus(fixture.finished, fixture.finished_provisional, fixture.started),
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

    // If any matches were updated with results, trigger scoring — uses
    // the reliably-sourced current gameweek, not the request's own
    // (possibly absent) ?gameweek= param.
    if (results.updated > 0 && currentGWForScoring) {
      await calculatePointsForGameweek(localDb, masterDb, currentGWForScoring);

      // Same full settlement chain wired into live-scores.js — kept
      // consistent here too since this is a second, independent real-data
      // poll path (../frontend/live-poll.js) that can just as easily be
      // the one to first detect a real match update. Every function here
      // is self-guarding (atomic claim or allFinished check), so calling
      // it from both poll paths is safe, not a double-application risk.
      //
      // Deliberately NOT calling updateFantasyPointsForGameweek — same
      // reasoning as live-scores.js: sync-players.js's real, official FPL
      // event_points is the decided source of truth for Fantasy Manager,
      // not our own simplified formula competing for the same column.
      try {
        const { data: liveLmsTournaments } = await localDb
          .schema('lms').from('tournaments').select('id').eq('status', 'live');
        for (const t of (liveLmsTournaments || [])) {
          await updateLmsPicksForGameweek(masterDb, localDb, t.id, currentGWForScoring);
        }

        await checkAndFinishSeasonTournament(localDb, masterDb, 'predictions', currentGWForScoring);
        await finalizeGameweekIfComplete(masterDb, localDb, currentGWForScoring);
      } catch (settlementErr) {
        console.error('sync-fixtures settlement chain error (non-fatal, match data already saved):', settlementErr);
      }
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

function mapFPLStatus(finished, finishedProvisional, started) {
  if (finished || finishedProvisional) return 'finished';
  if (started) return 'live';
  return 'upcoming';
}

function calculateResult(homeScore, awayScore) {
  if (homeScore > awayScore) return 'H';
  if (awayScore > homeScore) return 'A';
  return 'D';
}


// Uses the SAME canonical scoring function live-scores.js already exports
// for exactly this purpose — this file used to maintain its own separate
// copy, which had a real, active bug: it only summed the CURRENT
// gameweek's points and overwrote entry_points with just that, silently
// discarding every other gameweek's contribution to the season total.
// live-scores.js's version correctly sums across the tournament's whole
// gameweek range every time. Confirmed as a real risk, not hypothetical:
// this file's own poll path runs live in production every time the FPL
// API reports a real match update, so the broken version was genuinely
// reachable, not dead code.
const { calculatePointsForGameweek } = require('./live-scores.js');
const {
  checkAndFinishSeasonTournament,
  updateLmsPicksForGameweek,
  finalizeGameweekIfComplete
} = require('./tournaments.js');

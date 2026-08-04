// Vercel Function: Admin stats
// GET /api/admin-stats?action=stats|matches&gameweek=X
// POST /api/admin-stats (action: set-score)

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET,
      { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
    );
    const masterDb = createClient(
      process.env.MASTER_SUPABASE_URL,
      process.env.MASTER_SUPABASE_SERVICE_KEY,
      { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
    );

    // GET requests - handle different actions
    if (req.method === 'GET') {
      const { action, gameweek } = req.query;

      // Get matches for a gameweek
      if (action === 'matches' && gameweek) {
        const { data: matches, error } = await masterDb
          .from('matches')
          .select('id, home_team, away_team, home_score, away_score, status, kickoff_time')
          .eq('gameweek', parseInt(gameweek))
          .order('kickoff_time');

        if (error) throw error;

        return res.status(200).json({ matches: matches || [] });
      }

      // Default stats action
      const [{ count: totalPredictions }, { count: totalUsers }] = await Promise.all([
        supabase.schema('predictions').from('predictions').select('*', { count: 'exact', head: true }),
        supabase.from('users').select('*', { count: 'exact', head: true })
      ]);

      const { count: totalMatches } = await masterDb.from('matches').select('*', { count: 'exact', head: true });

      const [{ count: predTournaments }, { count: lmsTournaments }, { count: smTournaments }, { count: fmTournaments }] = await Promise.all([
        supabase.schema('predictions').from('tournaments').select('*', { count: 'exact', head: true }),
        supabase.schema('lms').from('tournaments').select('*', { count: 'exact', head: true }),
        supabase.schema('stockmarket').from('tournaments').select('*', { count: 'exact', head: true }),
        supabase.schema('fantasy').from('tournaments').select('*', { count: 'exact', head: true })
      ]);
      const totalTournaments = (predTournaments || 0) + (lmsTournaments || 0) + (smTournaments || 0) + (fmTournaments || 0);

      const { data: matchesByGW } = await masterDb
        .from('matches')
        .select('gameweek, status')
        .order('gameweek');

      const gwBreakdown = {};
      matchesByGW?.forEach(m => {
        if (!gwBreakdown[m.gameweek]) {
          gwBreakdown[m.gameweek] = { total: 0, finished: 0, live: 0, upcoming: 0 };
        }
        gwBreakdown[m.gameweek].total++;
        gwBreakdown[m.gameweek][m.status]++;
      });

      // Get last finalised gameweek from Master Clock
      const { data: masterClock } = await masterDb
        .from('master_clock')
        .select('last_finalised_gameweek')
        .eq('id', 'current')
        .single();
      
      const lastFinalisedGW = masterClock?.last_finalised_gameweek || 0;

      return res.status(200).json({
        total_matches: totalMatches || 0,
        total_predictions: totalPredictions || 0,
        total_users: totalUsers || 0,
        total_tournaments: totalTournaments || 0,
        last_finalised_gameweek: lastFinalisedGW,
        gameweek_breakdown: gwBreakdown
      });
    }

    // POST requests - handle set-score action
    if (req.method === 'POST') {
      const { action, match_id, home_score, away_score, result, status } = req.body;

      if (action === 'set-score') {
        if (!match_id || home_score === undefined || away_score === undefined) {
          return res.status(400).json({ error: 'Missing required fields' });
        }

        // Matches live in the separate master database, not this one —
        // this was updating (and reading back from) a table that doesn't
        // exist here at all, meaning this tool has never actually worked.
        const { data: matchRow, error: matchFetchErr } = await masterDb
          .from('matches').select('gameweek').eq('id', match_id).maybeSingle();
        if (matchFetchErr || !matchRow) {
          return res.status(404).json({ error: 'Match not found', details: matchFetchErr?.message });
        }

        const { error: matchError } = await masterDb
          .from('matches')
          .update({ home_score, away_score, result, status })
          .eq('id', match_id);
        if (matchError) throw matchError;

        let gameweeksRecalculated = [];
        let lmsCorrections = [];
        if (status === 'finished') {
          // Same real, already-correct, already-batched function the live
          // scoring pipeline uses — instead of a second, broken, parallel
          // implementation (the old version referenced a "joker" mechanic
          // that doesn't exist anywhere else in this codebase, and wrote
          // to users.total_points, a field nothing else reads).
          const { calculatePointsForGameweek } = require('./live-scores.js');
          await calculatePointsForGameweek(supabase, masterDb, matchRow.gameweek);
          gameweeksRecalculated.push(matchRow.gameweek);

          // A manually corrected result needs to be able to both
          // eliminate AND revive LMS entries — the normal live-play flow
          // only ever eliminates, since it only checks currently-alive
          // entries. Runs for every live LMS tournament.
          const { recalculateLmsForGameweekCorrection } = require('./tournaments.js');
          const { data: liveLms } = await supabase.schema('lms').from('tournaments').select('id').eq('status', 'live');
          for (const t of (liveLms || [])) {
            const r = await recalculateLmsForGameweekCorrection(masterDb, supabase, t.id, matchRow.gameweek);
            lmsCorrections.push({ tournament_id: t.id, ...r });
          }
        }

        return res.status(200).json({
          message: 'Score updated successfully',
          match_id,
          gameweeks_recalculated: gameweeksRecalculated,
          lms_corrections: lmsCorrections
        });
      }

      // Note: set-manual-gw and clear-manual-gw are deprecated
      // Use /api/master-clock instead
      if (action === 'set-manual-gw' || action === 'clear-manual-gw') {
        return res.status(400).json({ 
          error: 'Deprecated', 
          message: 'Use /api/master-clock instead' 
        });
      }
      
      // Recalculate tournament points - this was completely broken before:
      // it queried an unqualified `tournaments`/`matches` table that has
      // never existed (real data has always lived in schema-qualified
      // predictions.tournaments, and matches lives in the separate master
      // database, not this one at all). Fixed by reusing
      // calculatePointsForGameweek — the same real, already-correct,
      // already-batched function the live scoring pipeline uses — instead
      // of maintaining a second, broken, parallel implementation.
      if (action === 'recalculate-tournament-points') {
        const { calculatePointsForGameweek } = require('./live-scores.js');

        const { data: finishedMatches } = await masterDb
          .from('matches').select('gameweek').eq('status', 'finished');
        const finishedGameweeks = [...new Set((finishedMatches || []).map(m => m.gameweek))].sort((a, b) => a - b);

        const results = { gameweeks_recalculated: [], errors: [] };
        for (const gw of finishedGameweeks) {
          try {
            await calculatePointsForGameweek(supabase, masterDb, gw);
            results.gameweeks_recalculated.push(gw);
          } catch (gwErr) {
            results.errors.push({ gameweek: gw, error: gwErr.message });
          }
        }

        return res.status(200).json({
          message: `Recalculated ${results.gameweeks_recalculated.length} finished gameweek(s)`,
          results
        });
      }

      return res.status(400).json({ error: 'Unknown action' });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (error) {
    console.error('Admin stats error:', error);
    return res.status(500).json({ error: 'Failed to process request', details: error.message });
  }
};

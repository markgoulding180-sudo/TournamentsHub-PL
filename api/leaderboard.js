// Vercel Function: Leaderboard
// GET /api/leaderboard?tournament=all&limit=50

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // Same reasoning as api/tournaments.js — this reflects live scoring,
  // never safe to let a browser or CDN serve a stale cached copy.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const params = new URLSearchParams(req.query);
    const tournament = params.get('tournament') || 'all';
    const limit = parseInt(params.get('limit')) || 50;
    const offset = parseInt(params.get('offset')) || 0;

    const noCacheFetch = (url, options = {}) => fetch(url, { ...options, cache: 'no-store' });

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET,
      { global: { fetch: noCacheFetch } }
    );
    // Master project: master_clock — the one global gameweek pointer every
    // tournament follows, not FPL's live is_current flag.
    const masterDb = createClient(
      process.env.MASTER_SUPABASE_URL,
      process.env.MASTER_SUPABASE_SERVICE_KEY,
      { global: { fetch: noCacheFetch } }
    );

    let currentGameweek = null;
    try {
      const { data: clock } = await masterDb
        .from('master_clock')
        .select('current_gameweek')
        .eq('id', 'current')
        .maybeSingle();
      currentGameweek = clock ? clock.current_gameweek : null;
    } catch (clockError) {
      console.error('Failed to fetch master clock:', clockError);
    }

    // "all"/"season" used to read straight from users.total_points — a
    // field nothing in the real scoring pipeline ever writes to. Real
    // scoring only ever updates predictions.tournament_entries.entry_points
    // (via calculatePointsForGameweek), so users.total_points just sat
    // there holding whatever it was last set to, completely disconnected
    // from actual results — confirmed as the source of a real bug where a
    // full data wipe still showed old leaderboard numbers indefinitely.
    // Resolving to the live predictions tournament and reading from there
    // instead makes this endpoint reflect the same reality every other
    // leaderboard in the app already does.
    let resolvedTournamentId = tournament;
    if (tournament === 'all' || tournament === 'season') {
      const { data: liveTournament } = await supabase
        .schema('predictions').from('tournaments')
        .select('id').eq('status', 'live').maybeSingle();
      resolvedTournamentId = liveTournament ? liveTournament.id : null;
    }

    if (!resolvedTournamentId) {
      return res.status(200).json({
        tournament, leaderboard: [],
        pagination: { offset, limit, total: 0, has_more: false }
      });
    }

    const { data, error } = await supabase
      .schema('predictions').from('tournament_entries')
      .select('user_id, username, entry_points')
      .eq('tournament_id', resolvedTournamentId)
      .order('entry_points', { ascending: false })
      .order('user_id', { ascending: true }) // deterministic tie-breaker — without this, Postgres doesn't guarantee a consistent order for tied entries across separate calls, which is exactly why the same two 60pt players could show in a different order (and different rank number) between the Top 10 preview and the full leaderboard
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard', details: error.message });
    }

    const userIds = data.map(entry => entry.user_id).filter(Boolean);

    // Fetch current gameweek points for all users
    let gwPointsMap = {};
    if (currentGameweek && userIds.length > 0) {
      const { data: predictionsData, error: predictionsError } = await supabase
        .schema('predictions').from('predictions')
        .select('user_id, points_earned')
        .in('user_id', userIds)
        .eq('gameweek', currentGameweek);

      if (!predictionsError && predictionsData) {
        // Sum points per user
        predictionsData.forEach(pred => {
          gwPointsMap[pred.user_id] = (gwPointsMap[pred.user_id] || 0) + (pred.points_earned || 0);
        });
      }
    }

    // Format the response
    const formattedData = data.map((entry, index) => {
      const displayName = entry.username || 'Player';
      return {
        rank: offset + index + 1,
        user: {
          id: entry.user_id,
          username: entry.username,
          display_name: displayName,
          avatar_initials: displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
        },
        total_points: entry.entry_points || 0,
        gw_points: gwPointsMap[entry.user_id] || 0
      };
    });

    const { count: totalCount } = await supabase
      .schema('predictions').from('tournament_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', resolvedTournamentId);

    return res.status(200).json({
      tournament: tournament,
      leaderboard: formattedData,
      pagination: {
        offset,
        limit,
        total: totalCount || 0,
        has_more: (offset + limit) < (totalCount || 0)
      }
    });

  } catch (error) {
    console.error('Leaderboard error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

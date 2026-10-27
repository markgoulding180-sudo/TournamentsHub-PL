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
    // Which Predictions tournament this board is for. Each tournament is
    // completely separate: its own entries, and its own gameweek range
    // (Predictions 1 = GW1-8, Predictions 2 = GW9-16 ...).
    // "all"/"season" means the current one: the live tournament, otherwise
    // the one taking entries (so once Predictions 1 has finished, the page
    // moves on to Predictions 2 instead of still showing Predictions 1),
    // otherwise the most recently finished one. Older tournaments stay
    // viewable by passing their id (listed in `tournaments` below).
    const { data: allPredTournaments } = await supabase
      .schema('predictions').from('tournaments')
      .select('id, name, status, gameweek, end_gameweek, created_at');
    const predTournaments = (allPredTournaments || []).filter(t => ['live', 'upcoming', 'finished'].includes(t.status));
    const newestFirst = (a, b) => ((b.gameweek || 0) - (a.gameweek || 0)) || String(b.created_at || '').localeCompare(String(a.created_at || ''));
    let chosen = null;
    if (tournament === 'all' || tournament === 'season') {
      chosen = predTournaments.filter(t => t.status === 'live').sort(newestFirst)[0]
        || predTournaments.filter(t => t.status === 'upcoming').sort((a, b) => (a.gameweek || 0) - (b.gameweek || 0))[0]
        || predTournaments.filter(t => t.status === 'finished').sort(newestFirst)[0]
        || null;
    } else {
      chosen = (allPredTournaments || []).find(t => t.id === tournament) || null;
    }
    const resolvedTournamentId = chosen ? chosen.id : null;
    const tournamentStatus = chosen ? chosen.status : null;
    const tournamentsList = predTournaments.slice().sort(newestFirst).map(t => ({ id: t.id, name: t.name, status: t.status, gameweek: t.gameweek, end_gameweek: t.end_gameweek }));

    if (!resolvedTournamentId) {
      return res.status(200).json({
        tournament, leaderboard: [], tournaments: tournamentsList,
        pagination: { offset, limit, total: 0, has_more: false }
      });
    }

    const { data, error } = await supabase
      .schema('predictions').from('tournament_entries')
      .select('user_id, username, entry_points, prize_awarded')
      .eq('tournament_id', resolvedTournamentId)
      .order('entry_points', { ascending: false })
      .order('user_id', { ascending: true }) // deterministic tie-breaker — without this, Postgres doesn't guarantee a consistent order for tied entries across separate calls, which is exactly why the same two 60pt players could show in a different order (and different rank number) between the Top 10 preview and the full leaderboard
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard', details: error.message });
    }

    const userIds = data.map(entry => entry.user_id).filter(Boolean);

    // Real bug fixed here: this used to show the raw `username` snapshot
    // stored directly on the tournament_entries row at signup time —
    // different from every other leaderboard in the app, which all
    // correctly join to the real users table and prefer display_name.
    // That's exactly why the same person could show a different name
    // here than on the full leaderboard page. Purely a display source
    // change — entry_points and everything else below is untouched.
    let usersById = {};
    if (userIds.length > 0) {
      const { data: usersData } = await supabase
        .from('users').select('id, username, display_name, avatar_type, avatar_url').in('id', userIds);
      (usersData || []).forEach(u => { usersById[u.id] = u; });
    }

    // This gameweek's points - only when this gameweek is part of this
    // tournament, so a finished tournament never picks up later gameweeks.
    let gwPointsMap = {};
    const inRange = currentGameweek && chosen && currentGameweek >= (chosen.gameweek || 1) && currentGameweek <= (chosen.end_gameweek || chosen.gameweek || 38);
    if (inRange && userIds.length > 0) {
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
      const realUser = usersById[entry.user_id];
      const displayName = (realUser && (realUser.display_name || realUser.username)) || entry.username || 'Player';
      return {
        rank: offset + index + 1,
        user: {
          id: entry.user_id,
          username: (realUser && realUser.username) || entry.username,
          display_name: displayName,
          avatar_initials: displayName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase(),
          // Profile photo (only when the user uploaded one), else null -> initials
          avatar_url: (realUser && realUser.avatar_type === 'upload' && realUser.avatar_url) || null
        },
        total_points: entry.entry_points || 0,
        gw_points: gwPointsMap[entry.user_id] || 0,
        prize_awarded: entry.prize_awarded || 0
      };
    });

    const { count: totalCount } = await supabase
      .schema('predictions').from('tournament_entries')
      .select('*', { count: 'exact', head: true })
      .eq('tournament_id', resolvedTournamentId);

    return res.status(200).json({
      tournament: tournament,
      tournament_id: resolvedTournamentId,
      tournament_name: chosen.name,
      tournament_status: tournamentStatus,
      tournament_gameweeks: { start: chosen.gameweek, end: chosen.end_gameweek || chosen.gameweek },
      tournaments: tournamentsList,
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

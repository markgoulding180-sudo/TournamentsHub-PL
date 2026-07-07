// Vercel Function: Leaderboard
// GET /api/leaderboard?tournament=all&limit=50

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  // CORS headers
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
    const tournament = params.get('tournament') || 'all';
    const limit = parseInt(params.get('limit')) || 50;
    const offset = parseInt(params.get('offset')) || 0;

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET
    );
    // Master project: master_clock — the one global gameweek pointer every
    // tournament follows, not FPL's live is_current flag.
    const masterDb = createClient(
      process.env.MASTER_SUPABASE_URL,
      process.env.MASTER_SUPABASE_SERVICE_KEY
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

    let query;

    if (tournament === 'all' || tournament === 'season') {
      // Get overall leaderboard from users table
      query = supabase
        .from('users')
        .select('id, username, display_name, total_points, correct_scores, current_streak, created_at')
        .order('total_points', { ascending: false })
        .range(offset, offset + limit - 1);
    } else {
      // Get tournament-specific leaderboard
      query = supabase
        .from('tournament_entries')
        .select(`
          entry_points,
          rank,
          users:user_id (id, username, display_name, correct_scores, current_streak)
        `)
        .eq('tournament_id', tournament)
        .order('entry_points', { ascending: false })
        .range(offset, offset + limit - 1);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch leaderboard', details: error.message });
    }

    // Get user IDs to fetch their current GW points
    const userIds = data.map(entry => entry.id || entry.users?.id).filter(Boolean);
    
    // Fetch current gameweek points for all users
    let gwPointsMap = {};
    if (currentGameweek && userIds.length > 0) {
      const { data: predictionsData, error: predictionsError } = await supabase
        .from('predictions')
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
      const userId = entry.id || entry.users?.id;
      const gwPoints = gwPointsMap[userId] || 0;
      
      if (tournament === 'all' || tournament === 'season') {
        return {
          rank: offset + index + 1,
          user: {
            id: entry.id,
            username: entry.username,
            display_name: entry.display_name,
            avatar_initials: entry.display_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
          },
          total_points: entry.total_points,
          correct_scores: entry.correct_scores,
          streak: entry.current_streak,
          gw_points: gwPoints
        };
      } else {
        return {
          rank: entry.rank || offset + index + 1,
          user: {
            id: entry.users.id,
            username: entry.users.username,
            display_name: entry.users.display_name,
            avatar_initials: entry.users.display_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
          },
          total_points: entry.entry_points,
          correct_scores: entry.users.correct_scores,
          streak: entry.users.current_streak,
          gw_points: gwPoints
        };
      }
    });

    // Get total count for pagination
    const { count: totalCount } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });

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

// Vercel Function: Predictions (Get Fixtures & Submit Predictions)
// GET /api/predictions?gameweek=34
// POST /api/predictions

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  
  // Cache control - prevent caching
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
    console.error('Missing environment variables: SUPABASE_URL or SUPABASE_KEY');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Create clients - admin for auth verification and POST operations
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );
  
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET
  );

  // Master project: matches — shared PL facts, synced from FPL.
  // Used server-side only, so the service key is fine here.
  const masterDb = createClient(
    process.env.MASTER_SUPABASE_URL,
    process.env.MASTER_SUPABASE_SERVICE_KEY
  );
  
  // Use admin client for POST operations
  const dbClient = req.method === 'POST' ? supabaseAdmin : supabase;

  // GET - Fetch fixtures for a gameweek OR prediction history
  if (req.method === 'GET') {
    try {
      const params = new URLSearchParams(req.query);
      const gameweek = params.get('gameweek') || '34';
      const action = params.get('action');

      // Handle prediction history request
      if (action === 'history') {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.replace('Bearer ', '');
        
        try {
          const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
          
          if (userError || !user) {
            return res.status(401).json({ error: 'Invalid token' });
          }
          
          // Get prediction history for this user (with match details for readability)
          const { data: history, error: historyError } = await supabaseAdmin
            .schema('predictions').from('prediction_history')
            .select('*')
            .eq('user_id', user.id)
            .order('gameweek', { ascending: false })
            .order('finalised_at', { ascending: false });
          
          if (historyError) {
            console.error('History fetch error:', historyError);
            return res.status(500).json({ error: 'Failed to fetch history', details: historyError.message });
          }
          
          // Get gameweek summaries
          const { data: summaries, error: summaryError } = await supabaseAdmin
            .schema('predictions').from('gameweek_summary')
            .select('*')
            .eq('user_id', user.id)
            .order('gameweek', { ascending: false });
          
          if (summaryError) {
            console.error('Summary fetch error:', summaryError);
          }
          
          return res.status(200).json({
            history: history || [],
            summaries: summaries || []
          });
          
        } catch (authErr) {
          return res.status(500).json({ error: 'Auth failed', details: authErr.message });
        }
      }

      // Handle trends request - aggregate prediction data for all users
      const trends = params.get('trends');
      if (trends === 'true') {
        return await getTrendsData(supabaseAdmin, masterDb, gameweek, res);
      }

      // Get matches for the gameweek (master project)
      const { data: matches, error: matchesError } = await masterDb
        .from('matches')
        .select('*')
        .eq('gameweek', gameweek)
        .order('kickoff_time', { ascending: true });

      if (matchesError) {
        console.error('Database error fetching matches:', matchesError);
        return res.status(500).json({ error: 'Failed to fetch matches', details: matchesError.message });
      }

      // If user is authenticated, get their predictions too
      const authHeader = req.headers.authorization;
      let userPredictions = [];

      if (authHeader) {
        const token = authHeader.replace('Bearer ', '');
        console.log('Predictions GET - Token received:', token.substring(0, 30) + '...');
        
        try {
          const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
          
          if (userError) {
            console.error('Predictions GET - Auth error:', userError);
            return res.status(401).json({ error: 'Invalid token', details: userError.message });
          }
          
          if (!user) {
            console.error('Predictions GET - User not found');
            return res.status(401).json({ error: 'User not found' });
          }
          
          console.log('Predictions GET - User authenticated:', user.id);
          
          // Get predictions with match details for human readability
          const { data: predictions, error: predError } = await supabaseAdmin
            .schema('predictions').from('predictions')
            .select('*')
            .eq('user_id', user.id)
            .eq('gameweek', gameweek);
          
          if (predError) {
            console.error('Predictions GET - Database error:', predError);
            return res.status(500).json({ error: 'Failed to fetch predictions', details: predError.message });
          }
          
          console.log('Predictions GET - Found', predictions?.length || 0, 'predictions');
          userPredictions = predictions || [];
          
        } catch (authErr) {
          console.error('Predictions GET - Exception:', authErr);
          return res.status(500).json({ error: 'Auth failed', details: authErr.message });
        }
      } else {
        console.log('Predictions GET - No auth header');
      }

      return res.status(200).json({
        gameweek: parseInt(gameweek),
        matches: matches || [],
        predictions: userPredictions
      });

    } catch (error) {
      console.error('Predictions GET error:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  // POST - Submit predictions
  if (req.method === 'POST') {
    try {
      console.log('POST /api/predictions - Starting request processing');
      
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        console.error('No authorization header provided');
        return res.status(401).json({ error: 'Authentication required' });
      }

      const token = authHeader.replace('Bearer ', '');
      console.log('Token received, length:', token.length);
      
      // Verify the JWT token and get user
      let user;
      try {
        const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
        
        if (userError) {
          console.error('Auth error - getUser failed:', userError);
          return res.status(401).json({ error: 'Invalid or expired token', details: userError.message });
        }
        
        if (!userData.user) {
          console.error('No user returned from auth');
          return res.status(401).json({ error: 'Invalid or expired token' });
        }
        
        user = userData.user;
        console.log('User authenticated:', user.id);
      } catch (authErr) {
        console.error('Exception during auth verification:', authErr);
        return res.status(401).json({ error: 'Authentication failed', details: authErr.message });
      }

      const { gameweek, predictions } = req.body;
      console.log('Request body:', { gameweek, predictionsCount: predictions?.length });

      if (!gameweek || !predictions || !Array.isArray(predictions)) {
        console.error('Invalid request body:', { gameweek, predictions });
        return res.status(400).json({ error: 'Gameweek and predictions array are required' });
      }

      // Get match details for human-readable columns (master project) —
      // includes kickoff_time so each match's own deadline can be checked
      // individually below, matching the frontend's existing per-match
      // lock behaviour (a gameweek-wide single deadline would incorrectly
      // block editing a not-yet-started match just because an earlier
      // match in the same gameweek has already kicked off).
      const matchIds = predictions.map(p => p.match_id);
      const { data: matches } = await masterDb
        .from('matches')
        .select('id, home_team, away_team, gameweek, kickoff_time')
        .in('id', matchIds);
      
      const matchMap = {};
      matches?.forEach(m => {
        matchMap[m.id] = m;
      });

      // Reject only the specific predictions whose own match has already
      // kicked off — not the whole batch just because one match in it has.
      const now = Date.now();
      const tooLate = predictions.filter(p => {
        const match = matchMap[p.match_id];
        if (!match || !match.kickoff_time) return false; // unknown kickoff — allow, matches temp-ID flow below
        return new Date(match.kickoff_time).getTime() <= now;
      });

      if (tooLate.length > 0 && tooLate.length === predictions.length) {
        // Every submitted match has already kicked off
        return res.status(403).json({
          error: 'Deadline passed',
          message: 'All of these matches have already kicked off. Predictions are locked.'
        });
      }

      const predictionsToSubmit = predictions.filter(p => !tooLate.includes(p));


      // Validate and format predictions
      const predictionsToInsert = [];
      
      for (let i = 0; i < predictionsToSubmit.length; i++) {
        const pred = predictionsToSubmit[i];
        console.log(`Processing prediction ${i}:`, pred);
        
        if (!pred.match_id) {
          console.error(`Prediction ${i} missing match_id`);
          return res.status(400).json({ error: `Prediction ${i} missing match_id` });
        }
        
        // Only require predicted_result - scores are optional for validation
        if (!pred.predicted_result) {
          console.error(`Prediction ${i} missing predicted_result`);
          return res.status(400).json({ error: `Prediction ${i} missing result (1, X, or 2)` });
        }

        // Validate result is H, D, or A
        if (!['H', 'D', 'A'].includes(pred.predicted_result)) {
          console.error(`Prediction ${i} invalid result:`, pred.predicted_result);
          return res.status(400).json({ error: `Prediction ${i}: result must be H, D, or A` });
        }
        
        // Scores can be any value - no validation against result
        const homeScore = pred.home_score !== undefined ? parseInt(pred.home_score) : 0;
        const awayScore = pred.away_score !== undefined ? parseInt(pred.away_score) : 0;

        // Get match details
        const match = matchMap[pred.match_id];
        
        // Handle temporary match IDs (format: temp-gameweek-matchnum)
        let matchId = pred.match_id;
        if (typeof matchId === 'string' && matchId.startsWith('temp-')) {
          // Extract match number from temp ID
          const parts = matchId.split('-');
          const matchNum = parseInt(parts[2]) || 1;
          
          // Check if match exists, if not create it (master project)
          const { data: existingMatch, error: findError } = await masterDb
            .from('matches')
            .select('id')
            .eq('gameweek', gameweek)
            .order('kickoff_time', { ascending: true })
            .range(matchNum - 1, matchNum - 1)
            .single();
          
          if (findError) {
            console.error(`Error finding match for temp ID ${matchId}:`, findError);
          }
          
          if (existingMatch) {
            matchId = existingMatch.id;
            console.log(`Resolved temp ID to match:`, matchId);
          } else {
            // Create a placeholder match (master project)
            console.log(`Creating placeholder match for temp ID:`, matchId);
            const { data: newMatch, error: createError } = await masterDb
              .from('matches')
              .insert({
                gameweek: parseInt(gameweek),
                home_team: `Home Team ${matchNum}`,
                away_team: `Away Team ${matchNum}`,
                home_team_code: 'HOM',
                away_team_code: 'AWY',
                venue: 'TBD',
                kickoff_time: new Date(Date.now() + matchNum * 86400000).toISOString(),
                status: 'upcoming'
              })
              .select()
              .single();
            
            if (createError || !newMatch) {
              console.error('Failed to create match:', createError);
              return res.status(500).json({ error: 'Failed to create match', details: createError?.message });
            }
            matchId = newMatch.id;
            console.log(`Created match with ID:`, matchId);
          }
        }

        predictionsToInsert.push({
          user_id: user.id,
          match_id: matchId,
          gameweek: parseInt(gameweek),
          predicted_result: pred.predicted_result,
          home_score: homeScore,
          away_score: awayScore
        });
      }

      console.log('Inserting predictions:', predictionsToInsert);

      // Upsert predictions (insert or update if exists) - use admin client for RLS
      const { data, error } = await supabaseAdmin
        .schema('predictions').from('predictions')
        .upsert(predictionsToInsert, {
          onConflict: 'user_id,match_id',
          ignoreDuplicates: false
        })
        .select();

      if (error) {
        console.error('Database error inserting predictions:', error);
        return res.status(500).json({ error: 'Failed to save predictions', details: error.message });
      }

      console.log('Predictions saved successfully:', data);

      return res.status(200).json({
        message: tooLate.length > 0
          ? `Predictions saved. ${tooLate.length} match(es) were skipped — already kicked off.`
          : 'Predictions saved successfully',
        predictions: data,
        skipped: tooLate.map(p => p.match_id)
      });

    } catch (error) {
      console.error('Predictions POST error:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// Helper function to get trends data - aggregate predictions across all users
async function getTrendsData(localDb, masterDb, gameweek, res) {
  try {
    // Get all matches for this gameweek (master project)
    const { data: matches, error: matchesError } = await masterDb
      .from('matches')
      .select('*')
      .eq('gameweek', gameweek)
      .order('kickoff_time', { ascending: true });

    if (matchesError) {
      return res.status(500).json({ error: 'Failed to fetch matches', details: matchesError.message });
    }

    if (!matches || matches.length === 0) {
      return res.status(200).json({ trends: [], total_users: 0 });
    }

    // Get all predictions for this gameweek (local project).
    // No cross-project join here (matches lives in a different project),
    // so match/team lookups are done in-memory below via matchesById.
    const { data: allPredictions, error: predError } = await localDb
      .schema('predictions').from('predictions')
      .select('*')
      .eq('gameweek', parseInt(gameweek));

    if (predError) {
      return res.status(500).json({ error: 'Failed to fetch predictions', details: predError.message });
    }

    const matchesById = {};
    matches.forEach(m => { matchesById[m.id] = m; });

    // Count unique users who predicted
    const uniqueUsers = new Set(allPredictions?.map(p => p.user_id) || []);
    const totalUsers = uniqueUsers.size;

    // Debug: log first few predictions to see their structure
    console.log('Trends Debug - Total predictions:', allPredictions?.length || 0);
    console.log('Trends Debug - First prediction:', allPredictions?.[0]);
    console.log('Trends Debug - Prediction match_ids:', allPredictions?.map(p => p.match_id));
    console.log('Trends Debug - Match IDs in DB:', matches.map(m => m.id));

    // Calculate trends for each match
    const trends = matches.map(match => {
      // Match predictions by match_id OR by team names (for temp ID cases)
      const matchPreds = allPredictions?.filter(p => {
        // Direct match_id match
        if (p.match_id === match.id) return true;
        // Fallback: match by team names via the in-memory match lookup
        const predMatch = matchesById[p.match_id];
        if (predMatch) {
          return predMatch.home_team === match.home_team && predMatch.away_team === match.away_team;
        }
        return false;
      }) || [];
      const totalPredictions = matchPreds.length;

      if (totalPredictions === 0) {
        return {
          match_id: match.id,
          home_team: match.home_team,
          away_team: match.away_team,
          total_predictions: 0,
          result_distribution: { H: 0, D: 0, A: 0 },
          most_common_result: null,
          most_common_score: null
        };
      }

      // Calculate result distribution
      const resultCounts = { H: 0, D: 0, A: 0 };
      matchPreds.forEach(p => {
        if (resultCounts[p.predicted_result] !== undefined) {
          resultCounts[p.predicted_result]++;
        }
      });

      const resultDistribution = {
        H: Math.round((resultCounts.H / totalPredictions) * 100),
        D: Math.round((resultCounts.D / totalPredictions) * 100),
        A: Math.round((resultCounts.A / totalPredictions) * 100)
      };

      // Find most common result
      let mostCommonResult = null;
      const maxResultCount = Math.max(resultCounts.H, resultCounts.D, resultCounts.A);
      if (maxResultCount > 0) {
        const mostCommonKey = Object.keys(resultCounts).find(k => resultCounts[k] === maxResultCount);
        mostCommonResult = {
          result: mostCommonKey,
          percentage: Math.round((maxResultCount / totalPredictions) * 100)
        };
      }

      // Find most common score
      const scoreCounts = {};
      matchPreds.forEach(p => {
        const scoreKey = `${p.home_score}-${p.away_score}`;
        scoreCounts[scoreKey] = (scoreCounts[scoreKey] || 0) + 1;
      });

      let mostCommonScore = null;
      const maxScoreCount = Math.max(...Object.values(scoreCounts));
      if (maxScoreCount > 0) {
        const mostCommonScoreKey = Object.keys(scoreCounts).find(k => scoreCounts[k] === maxScoreCount);
        mostCommonScore = {
          score: mostCommonScoreKey,
          count: maxScoreCount,
          percentage: Math.round((maxScoreCount / totalPredictions) * 100)
        };
      }

      return {
        match_id: match.id,
        home_team: match.home_team,
        away_team: match.away_team,
        total_predictions: totalPredictions,
        result_distribution: resultDistribution,
        most_common_result: mostCommonResult,
        most_common_score: mostCommonScore
      };
    });

    return res.status(200).json({
      trends: trends,
      total_users: totalUsers,
      gameweek: parseInt(gameweek),
      debug: {
        predictionsCount: allPredictions?.length || 0,
        predictionMatchIds: allPredictions?.map(p => p.match_id),
        matchIds: matches.map(m => m.id)
      }
    });

  } catch (error) {
    console.error('Trends data error:', error);
    return res.status(500).json({ error: 'Failed to get trends data', details: error.message });
  }
}

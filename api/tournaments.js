// Vercel Function: Tournaments (List & Join)
// GET /api/tournaments - List all tournaments
// POST /api/tournaments - Join a tournament

const { createClient } = require('@supabase/supabase-js');

// Which Supabase schema a tournament's data lives in, based on its type.
// 'predictions' is the default so existing callers that don't send this
// keep working unchanged.
function resolveSchema(tournament_type) {
  if (tournament_type === 'fantasy') return 'fantasy';
  if (tournament_type === 'lms') return 'lms';
  if (tournament_type === 'stockmarket') return 'stockmarket';
  return 'predictions';
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Create clients - admin client for auth verification, regular for data
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
  );
  
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET
  );

  // Master project: players — used for Fantasy Manager squad validation/scoring
  const masterDb = createClient(
    process.env.MASTER_SUPABASE_URL,
    process.env.MASTER_SUPABASE_SERVICE_KEY
  );

  // GET - List tournaments
  if (req.method === 'GET') {
    try {
      const params = new URLSearchParams(req.query);
      const status = params.get('status'); // live, upcoming, closed, finished
      const gameweek = params.get('gameweek');
      const tournamentId = params.get('tournament_id');
      const leaderboard = params.get('leaderboard'); // if set, return leaderboard
      const myEntries = params.get('my_entries'); // if set, return user's entered tournaments

      // Which schema to query: 'predictions' (Score Predictions, default —
      // existing callers that don't send this keep working unchanged),
      // 'fantasy' (Fantasy Manager), or 'lms' (Last Man Standing).
      const schemaName = resolveSchema(params.get('tournament_type'));
      
      // Return user's tournament entries
      if (myEntries) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'Authentication required' });
        }

        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

        if (authError || !user) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        // Get tournaments the user has entered
        const { data: entries, error: entriesError } = await supabaseAdmin
          .schema(schemaName).from('tournament_entries')
          .select('tournament_id')
          .eq('user_id', user.id);

        if (entriesError) {
          return res.status(500).json({ error: 'Failed to fetch entries', details: entriesError.message });
        }

        // Get full tournament details for entered tournaments
        const tournamentIds = entries.map(e => e.tournament_id);
        
        if (tournamentIds.length === 0) {
          return res.status(200).json({ tournaments: [] });
        }

        const { data: tournaments, error: tournamentsError } = await supabase
          .schema(schemaName).from('tournaments')
          .select('*')
          .in('id', tournamentIds);

        if (tournamentsError) {
          return res.status(500).json({ error: 'Failed to fetch tournaments', details: tournamentsError.message });
        }

        return res.status(200).json({ tournaments: tournaments || [] });
      }

      // Return the current user's own entry for one tournament (used by
      // the Fantasy Manager page to know if a squad has already been saved)
      // Return Fantasy Manager's current squad-lock status (public, no auth
      // needed — just tells the page whether editing is currently allowed)
      const lockStatus = params.get('lock_status');
      if (lockStatus === 'true') {
        const lock = await getFantasyLockStatus(masterDb);
        return res.status(200).json(lock);
      }

      // Last Man Standing's lock status (public, no auth needed) — also
      // triggers elimination processing once a gameweek's matches all finish.
      const lmsLockStatus = params.get('lms_lock_status');
      if (lmsLockStatus === 'true' && tournamentId) {
        const lock = await getLmsLockStatus(masterDb, supabaseAdmin, tournamentId);
        return res.status(200).json(lock);
      }

      // Stock Market's status (public, no auth needed) — also triggers
      // market initialization (once, when the draft window closes) and
      // per-gameweek price processing (once matches finish).
      const stockmarketLockStatus = params.get('stockmarket_lock_status');
      if (stockmarketLockStatus === 'true' && tournamentId) {
        const status = await getStockMarketLockStatus(masterDb, supabaseAdmin, tournamentId);
        return res.status(200).json(status);
      }

      // Public market board — every distinct player's current shared price.
      const stockmarketPrices = params.get('stockmarket_prices');
      if (stockmarketPrices === 'true' && tournamentId) {
        const { data: marketRows, error: marketError } = await supabaseAdmin
          .schema('stockmarket').from('player_market')
          .select('*')
          .eq('tournament_id', tournamentId)
          .order('current_value', { ascending: false });

        if (marketError) {
          return res.status(500).json({ error: 'Failed to fetch market', details: marketError.message });
        }
        return res.status(200).json({ market: marketRows || [] });
      }

      // This user's own Stock Market entry — squad, draft-lock state, and
      // portfolio value (with each held player's individual current value).
      const stockmarketState = params.get('stockmarket_state');
      if (stockmarketState === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        const { data: entry, error: entryError } = await supabaseAdmin
          .schema('stockmarket').from('tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (entryError) {
          return res.status(500).json({ error: 'Failed to fetch entry', details: entryError.message });
        }
        if (!entry) {
          return res.status(200).json({ entry: null });
        }

        const squad = entry.squad_players || [];
        let portfolio = [];
        if (squad.length > 0) {
          const { data: marketRows } = await supabaseAdmin
            .schema('stockmarket').from('player_market')
            .select('*')
            .eq('tournament_id', tournamentId)
            .in('player_id', squad.map(s => s.player_id));

          const marketByPid = {};
          (marketRows || []).forEach(m => { marketByPid[m.player_id] = m; });

          portfolio = squad.map(s => {
            const m = marketByPid[s.player_id] || {};
            const ownership = m.ownership_count || 1;
            return {
              player_id: s.player_id,
              name: m.name || '',
              position: m.position || '',
              team: m.team || '',
              ownership_count: ownership,
              your_value: Math.round((m.current_value || 0) / ownership),
              market_value: m.current_value || 0,
              last_gw_stats: m.last_gw_stats || null
            };
          });
        }

        return res.status(200).json({ entry, portfolio });
      }

      const myEntry = params.get('my_entry');
      if (myEntry && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        const { data: entry, error: entryError } = await supabaseAdmin
          .schema(schemaName).from('tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (entryError) {
          return res.status(500).json({ error: 'Failed to fetch entry', details: entryError.message });
        }

        return res.status(200).json({ entry: entry || null });
      }

      // Last Man Standing: return this user's full pick history + which
      // teams are already used (so the frontend can grey them out).
      const lmsState = params.get('lms_state');
      if (lmsState === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        const { data: picks, error: picksError } = await supabaseAdmin
          .schema('lms').from('picks')
          .select('*')
          .eq('tournament_id', tournamentId)
          .eq('user_id', user.id)
          .order('gameweek', { ascending: true });

        if (picksError) {
          return res.status(500).json({ error: 'Failed to fetch picks', details: picksError.message });
        }

        const { data: entry, error: entryError } = await supabaseAdmin
          .schema('lms').from('tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .eq('user_id', user.id)
          .maybeSingle();

        if (entryError) {
          return res.status(500).json({ error: 'Failed to fetch entry', details: entryError.message });
        }

        return res.status(200).json({
          picks: picks || [],
          used_teams: (picks || []).map(p => p.team),
          is_eliminated: entry ? entry.is_eliminated : false,
          eliminated_gameweek: entry ? entry.eliminated_gameweek : null,
          prize_awarded: entry ? (entry.prize_awarded || 0) : 0
        });
      }

      // Return leaderboard for specific tournament
      if (leaderboard && tournamentId) {
        const { data: entries, error: entriesError } = await supabaseAdmin
          .schema(schemaName).from('tournament_entries')
          .select('*')
          .eq('tournament_id', tournamentId)
          .order('entry_points', { ascending: false });
        
        if (entriesError) {
          return res.status(500).json({ error: 'Failed to fetch leaderboard', details: entriesError.message });
        }

        // Fetch usernames separately rather than relying on PostgREST's
        // automatic FK-relationship embedding (users:user_id(...)) — that
        // depends on its schema cache picking up cross-schema foreign keys,
        // which has proven unreliable for this project's custom schemas.
        let usersById = {};
        const userIds = [...new Set((entries || []).map(e => e.user_id))];
        if (userIds.length > 0) {
          const { data: usersData } = await supabaseAdmin
            .from('users')
            .select('id, username, display_name')
            .in('id', userIds);
          (usersData || []).forEach(u => { usersById[u.id] = u; });
        }

        let scoredEntries = (entries || []).map(e => ({
          ...e,
          users: usersById[e.user_id] || null
        }));

        if (schemaName === 'fantasy' && scoredEntries.length > 0) {
          const allIds = new Set();
          scoredEntries.forEach(e => (e.squad_players || []).forEach(id => allIds.add(id)));

          let pointsMap = {};
          if (allIds.size > 0) {
            const { data: playersData } = await masterDb
              .from('players')
              .select('id, total_points, event_points')
              .in('id', Array.from(allIds));
            (playersData || []).forEach(p => {
              pointsMap[p.id] = { total: p.total_points || 0, gw: p.event_points || 0 };
            });
          }

          scoredEntries = scoredEntries.map(e => {
            const squad = e.squad_players || [];
            let total = 0, gw = 0;
            squad.forEach(pid => {
              const pts = pointsMap[pid] || { total: 0, gw: 0 };
              const mult = pid === e.captain_id ? 2 : 1;
              total += pts.total * mult;
              gw += pts.gw * mult;
            });
            return { ...e, entry_points: total, gw_points: gw };
          }).sort((a, b) => b.entry_points - a.entry_points);
        }

        if (schemaName === 'lms' && scoredEntries.length > 0) {
          const { data: allPicks } = await supabaseAdmin
            .schema('lms').from('picks')
            .select('user_id, gameweek, team')
            .eq('tournament_id', tournamentId);

          const picksByUser = {};
          (allPicks || []).forEach(p => {
            (picksByUser[p.user_id] = picksByUser[p.user_id] || []).push(p);
          });

          scoredEntries = scoredEntries.map(e => {
            const userPicks = (picksByUser[e.user_id] || []).sort((a, b) => a.gameweek - b.gameweek);
            return {
              ...e,
              weeks_survived: userPicks.length,
              last_pick: userPicks.length > 0 ? userPicks[userPicks.length - 1] : null
            };
          }).sort((a, b) => {
            // Alive entrants first (still-in players are all tied at the top
            // until one winner remains — there's no ranking among survivors).
            if (a.is_eliminated !== b.is_eliminated) return a.is_eliminated ? 1 : -1;
            if (a.is_eliminated) {
              // Among the eliminated: whoever lasted the most gameweeks ranks higher.
              return (b.eliminated_gameweek || 0) - (a.eliminated_gameweek || 0);
            }
            return (b.weeks_survived || 0) - (a.weeks_survived || 0);
          });
        }

        // Add rank to each entry
        const rankedEntries = scoredEntries.map((entry, index) => ({
          ...entry,
          rank: index + 1
        }));
        
        return res.status(200).json({
          tournament_id: tournamentId,
          leaderboard: rankedEntries,
          ...(schemaName === 'lms' ? { alive_count: rankedEntries.filter(e => !e.is_eliminated).length } : {})
        });
      }

      // Return a single tournament by id (no leaderboard/join, just details)
      if (tournamentId && !leaderboard) {
        const { data: singleTournament, error: singleError } = await supabase
          .schema(schemaName).from('tournaments')
          .select('*')
          .eq('id', tournamentId)
          .single();

        if (singleError || !singleTournament) {
          return res.status(404).json({ error: 'Tournament not found' });
        }

        return res.status(200).json({ tournament: singleTournament });
      }

      let query = supabase
        .schema(schemaName).from('tournaments')
        .select('*')
        .order('closes_at', { ascending: true });

      if (status) {
        query = query.eq('status', status);
      }

      if (gameweek) {
        query = query.eq('gameweek', gameweek);
      }

      const { data, error } = await query;

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch tournaments', details: error.message });
      }

      // Calculate time remaining and live prize pool for each tournament
      const now = new Date();
      const formattedData = (data || []).map(t => {
        const closesAt = new Date(t.closes_at);
        const diff = closesAt - now;
        let timeRemaining = null;

        if (diff > 0) {
          const days = Math.floor(diff / (1000 * 60 * 60 * 24));
          const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
          if (days > 0) {
            timeRemaining = `${days} day${days > 1 ? 's' : ''}`;
          } else {
            timeRemaining = `${hours} hour${hours > 1 ? 's' : ''}`;
          }
        }
        
        // Calculate live prize pool from entry fee × current entries
        const entryFee = parseFloat(t.entry_fee) || 0;
        const currentEntries = parseInt(t.current_entries) || 0;
        const calculatedPrizePool = entryFee * currentEntries;

        return {
          ...t,
          prize_pool: calculatedPrizePool, // Use calculated value, not stored value
          time_remaining: timeRemaining,
          is_full: t.max_entries && t.current_entries >= t.max_entries
        };
      });

      return res.status(200).json({
        tournaments: formattedData
      });

    } catch (error) {
      console.error('Tournaments GET error:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  // POST - Create or Join a tournament
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const token = authHeader.replace('Bearer ', '');
      console.log('Tournaments API - Token received:', token.substring(0, 30) + '...');
      console.log('Tournaments API - SUPABASE_URL:', process.env.SUPABASE_URL);
      
      // Use admin client to verify JWT
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);

      if (authError) {
        console.error('Tournaments API - Auth error:', authError);
        return res.status(401).json({ error: 'Invalid or expired token', details: authError.message });
      }
      
      if (!user) {
        console.error('Tournaments API - User not found');
        return res.status(401).json({ error: 'User not found' });
      }
      
      console.log('Tournaments API - User authenticated:', user.id);

      const { action, tournament_id, name, entry_fee, prize_pool, gameweek, end_gameweek, max_entries, closes_at, squad_players, captain_id, tournament_type, team } = req.body;
      const schemaName = resolveSchema(tournament_type);

      // CREATE tournament (admin action)
      if (action === 'create') {
        if (!name || !gameweek) {
          return res.status(400).json({ error: 'name and gameweek are required' });
        }

        const { data, error } = await supabaseAdmin
          .schema(schemaName).from('tournaments')
          .insert({
            name,
            entry_fee: entry_fee || 0,
            prize_pool: prize_pool || 0,
            top_prize: prize_pool || 0,
            gameweek,
            end_gameweek: end_gameweek || gameweek,
            max_entries: max_entries || 100,
            current_entries: 0,
            status: 'live',
            closes_at: closes_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
          })
          .select()
          .single();

        if (error) {
          console.error('Create tournament error:', error);
          return res.status(500).json({ 
            error: 'Failed to create tournament', 
            details: error.message,
            code: error.code,
            hint: error.hint
          });
        }

        return res.status(201).json({
          message: 'Tournament created successfully',
          tournament: data
        });
      }

      // JOIN tournament (user action) — also used to save/update a Fantasy
      // Manager squad, since a squad is just extra payload on the entry.
      if (action === 'join') {
        try {
          console.log('Join action - tournament_id:', tournament_id, 'user_id:', user.id, 'schema:', schemaName);
          
          if (!tournament_id) {
            return res.status(400).json({ error: 'tournament_id is required' });
          }

          // Check if tournament exists and is open
          const { data: tournament, error: tournamentError } = await supabase
            .schema(schemaName).from('tournaments')
            .select('*')
            .eq('id', tournament_id)
            .single();

          if (tournamentError || !tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
          }

          // Stock Market's drafting phase happens BEFORE the market goes
          // live (status starts 'upcoming' and only flips to 'live' once
          // the draft deadline passes) — every other schema only opens
          // entries once status is 'live', but Stock Market needs to allow
          // joining/drafting during 'upcoming' too.
          const entriesOpen = schemaName === 'stockmarket'
            ? (tournament.status === 'upcoming' || tournament.status === 'live')
            : tournament.status === 'live';

          if (!entriesOpen) {
            return res.status(400).json({ error: 'Tournament is not open for entries' });
          }

          const entryPayload = {
            tournament_id: tournament_id,
            user_id: user.id,
            entered_at: new Date().toISOString()
          };

          // Fantasy Manager: squad_players is optional — omitting it just
          // "enters" the tournament with no squad yet. If it IS provided
          // (saving/editing a squad), validate it and check the lock first.
          if (schemaName === 'fantasy' && squad_players !== undefined) {
            const lock = await getFantasyLockStatus(masterDb);
            if (lock.locked) {
              return res.status(403).json({ error: lock.reason || 'Squad is currently locked.', lock });
            }

            if (!Array.isArray(squad_players) || squad_players.length !== 15) {
              return res.status(400).json({ error: 'squad_players must be an array of 15 player ids' });
            }
            const uniqueIds = new Set(squad_players);
            if (uniqueIds.size !== 15) {
              return res.status(400).json({ error: 'squad_players must not contain duplicates' });
            }
            if (!captain_id || !uniqueIds.has(captain_id)) {
              return res.status(400).json({ error: 'captain_id must be one of the squad_players' });
            }

            const { data: squadRows, error: squadError } = await masterDb
              .from('players')
              .select('id, element_type, now_cost')
              .in('id', squad_players);

            if (squadError) {
              return res.status(500).json({ error: 'Failed to validate squad', details: squadError.message });
            }
            if (!squadRows || squadRows.length !== 15) {
              return res.status(400).json({ error: 'One or more player ids were not recognised' });
            }

            const counts = { 1: 0, 2: 0, 3: 0, 4: 0 }; // GK, DEF, MID, FWD
            let totalCost = 0;
            squadRows.forEach(p => {
              counts[p.element_type] = (counts[p.element_type] || 0) + 1;
              totalCost += p.now_cost || 0;
            });

            if (counts[1] !== 2 || counts[2] !== 5 || counts[3] !== 5 || counts[4] !== 3) {
              return res.status(400).json({
                error: 'Squad must be exactly 2 GK, 5 DEF, 5 MID, 3 FWD',
                counts
              });
            }
            if (totalCost > 1000) { // now_cost is in tenths of £m — 1000 = £100.0m
              return res.status(400).json({ error: `Squad costs £${(totalCost/10).toFixed(1)}m, budget is £100.0m` });
            }

            entryPayload.squad_players = squad_players;
            entryPayload.captain_id = captain_id;
          }

          // Stock Market: squad_players optional on first join (just enters
          // the tournament); if provided, validate the 6-player draft.
          // Once the draft phase ends, getStockMarketLockStatus() flips
          // squad_locked permanently — this branch is only reachable while
          // still in the drafting phase.
          if (schemaName === 'stockmarket' && squad_players !== undefined) {
            const { data: existingEntry } = await supabaseAdmin
              .schema('stockmarket').from('tournament_entries')
              .select('squad_locked')
              .eq('tournament_id', tournament_id)
              .eq('user_id', user.id)
              .maybeSingle();

            if (existingEntry && existingEntry.squad_locked) {
              return res.status(403).json({ error: 'Your squad is locked — the draft window has closed.' });
            }

            if (!Array.isArray(squad_players) || squad_players.length !== 6) {
              return res.status(400).json({ error: 'squad_players must be an array of exactly 6 player ids' });
            }
            const uniqueIds = new Set(squad_players);
            if (uniqueIds.size !== 6) {
              return res.status(400).json({ error: 'squad_players must not contain duplicates' });
            }

            const { data: squadRows, error: squadError } = await masterDb
              .from('players')
              .select('id, web_name, element_type, team')
              .in('id', squad_players);

            if (squadError) {
              return res.status(500).json({ error: 'Failed to validate squad', details: squadError.message });
            }
            if (!squadRows || squadRows.length !== 6) {
              return res.status(400).json({ error: 'One or more player ids were not recognised' });
            }

            // element_type: 1=GK, 2=DEF, 3=MID, 4=FWD (standard FPL mapping)
            const counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
            squadRows.forEach(p => { counts[p.element_type] = (counts[p.element_type] || 0) + 1; });

            if (counts[1] !== 1) {
              return res.status(400).json({ error: 'Squad must include exactly 1 goalkeeper', counts });
            }
            if (counts[2] < 1 || counts[3] < 1 || counts[4] < 1) {
              return res.status(400).json({
                error: 'Squad must include at least 1 defender, 1 midfielder and 1 forward',
                counts
              });
            }

            entryPayload.squad_players = squad_players.map(pid => {
              const p = squadRows.find(r => r.id === pid);
              return { player_id: pid, position: p.element_type };
            });
          }

          // Try insert first; if the user already has an entry (unique
          // constraint on tournament_id+user_id), update it instead so a
          // Fantasy Manager squad can be edited before the deadline.
          // (Stock Market doesn't have an entry_points column — it tracks
          // current_value/start_value instead — so only add entry_points
          // for the schemas that actually have it.)
          const insertPayload = schemaName === 'stockmarket'
            ? { ...entryPayload }
            : { ...entryPayload, entry_points: 0 };

          let entry, entryError;
          ({ data: entry, error: entryError } = await supabaseAdmin
            .schema(schemaName).from('tournament_entries')
            .insert(insertPayload)
            .select()
            .single());

          if (entryError && entryError.code === '23505') {
            // Already entered — update existing row instead (squad edits etc.)
            ({ data: entry, error: entryError } = await supabaseAdmin
              .schema(schemaName).from('tournament_entries')
              .update(entryPayload)
              .eq('tournament_id', tournament_id)
              .eq('user_id', user.id)
              .select()
              .single());
          } else if (!entryError) {
            // Brand-new entry — bump the tournament's entry count
            await supabaseAdmin
              .schema(schemaName).from('tournaments')
              .update({ current_entries: tournament.current_entries + 1 })
              .eq('id', tournament_id);
          }

          console.log('Join/update result:', entry, 'Error:', entryError);

          if (entryError) {
            return res.status(400).json({ error: entryError.message });
          }
          
          return res.status(200).json({ success: true, entry });
          
        } catch (err) {
          console.error('Join handler crash:', err.message);
          return res.status(500).json({ error: err.message });
        }
      }

      // Last Man Standing: submit/change this gameweek's pick.
      if (action === 'lms_pick') {
        try {
          if (!tournament_id || !gameweek || !team) {
            return res.status(400).json({ error: 'tournament_id, gameweek and team are required' });
          }

          const { data: tournament, error: tournamentError } = await supabase
            .schema('lms').from('tournaments')
            .select('*')
            .eq('id', tournament_id)
            .single();

          if (tournamentError || !tournament) {
            return res.status(404).json({ error: 'Tournament not found' });
          }
          if (tournament.status !== 'live') {
            return res.status(400).json({ error: 'This tournament is not open for picks' });
          }

          const lock = await getLmsLockStatus(masterDb, supabaseAdmin, tournament_id);
          if (lock.locked) {
            return res.status(403).json({ error: lock.reason || 'Picks are currently locked.', lock });
          }

          const { data: entry, error: entryError } = await supabaseAdmin
            .schema('lms').from('tournament_entries')
            .select('*')
            .eq('tournament_id', tournament_id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (entryError) {
            return res.status(500).json({ error: 'Failed to check entry', details: entryError.message });
          }
          if (!entry) {
            return res.status(403).json({ error: 'Enter the tournament before making a pick' });
          }
          if (entry.is_eliminated) {
            return res.status(403).json({ error: 'You have been eliminated from this tournament' });
          }

          // A team can only ever be picked once per user in this tournament —
          // check across ALL other gameweeks (not just this one).
          const { data: reuse, error: reuseError } = await supabaseAdmin
            .schema('lms').from('picks')
            .select('gameweek')
            .eq('tournament_id', tournament_id)
            .eq('user_id', user.id)
            .eq('team', team)
            .neq('gameweek', gameweek)
            .maybeSingle();

          if (reuseError) {
            return res.status(500).json({ error: 'Failed to validate pick', details: reuseError.message });
          }
          if (reuse) {
            return res.status(400).json({ error: `You've already used ${team} in Gameweek ${reuse.gameweek}` });
          }

          // Upsert this gameweek's pick (lets the user change their mind
          // right up until the pick page locks it).
          const { data: existingPick, error: existingPickError } = await supabaseAdmin
            .schema('lms').from('picks')
            .select('id')
            .eq('tournament_id', tournament_id)
            .eq('user_id', user.id)
            .eq('gameweek', gameweek)
            .maybeSingle();

          if (existingPickError) {
            return res.status(500).json({ error: 'Failed to check existing pick', details: existingPickError.message });
          }

          let pick, pickError;
          if (existingPick) {
            ({ data: pick, error: pickError } = await supabaseAdmin
              .schema('lms').from('picks')
              .update({ team })
              .eq('id', existingPick.id)
              .select()
              .single());
          } else {
            ({ data: pick, error: pickError } = await supabaseAdmin
              .schema('lms').from('picks')
              .insert({ tournament_id, user_id: user.id, gameweek, team })
              .select()
              .single());
          }

          if (pickError) {
            if (pickError.code === '23505') {
              return res.status(400).json({ error: `You've already used ${team} this tournament` });
            }
            return res.status(400).json({ error: pickError.message });
          }

          return res.status(200).json({ success: true, pick });

        } catch (err) {
          console.error('LMS pick handler crash:', err.message);
          return res.status(500).json({ error: err.message });
        }
      }

      return res.status(400).json({ error: 'Invalid action' });

    } catch (error) {
      console.error('Tournaments POST error:', error);
      return res.status(500).json({ error: 'Internal server error', details: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

// Fantasy Manager squad lock status — follows master_clock.current_gameweek
// as the ONE global pointer every tournament respects (admin-controlled,
// same clock Predictions uses). This function doesn't decide "what
// gameweek is it" — it only asks "for whichever gameweek admin has the
// clock set to, has that gameweek's deadline passed, and has it finished?"
//
// Locked once that gameweek's earliest kickoff has passed; unlocked again
// once every match in it shows finished. If admin manually moves the
// clock (forward, or back to fix a mistake), this immediately reflects
// whatever gameweek the clock now points at — nothing else to reconcile,
// since match/player data for every gameweek stays in the database either way.
async function getFantasyLockStatus(masterDb) {
  try {
    const { data: clock } = await masterDb
      .from('master_clock')
      .select('current_gameweek')
      .eq('id', 'current')
      .maybeSingle();

    if (!clock || !clock.current_gameweek) {
      return { locked: false, gameweek: null, deadline_epoch: null, reason: 'Master clock not set yet.' };
    }

    const currentGW = clock.current_gameweek;

    const { data: gwMatches } = await masterDb
      .from('matches')
      .select('status, kickoff_time')
      .eq('gameweek', currentGW);

    if (!gwMatches || gwMatches.length === 0) {
      return { locked: false, gameweek: currentGW, deadline_epoch: null, reason: null };
    }

    const earliestKickoffMs = gwMatches.reduce((min, m) => {
      const t = new Date(m.kickoff_time).getTime();
      return (min === null || t < min) ? t : min;
    }, null);

    const deadlinePassed = earliestKickoffMs !== null && Date.now() >= earliestKickoffMs;
    const deadlineEpoch = earliestKickoffMs !== null ? Math.floor(earliestKickoffMs / 1000) : null;

    if (!deadlinePassed) {
      return { locked: false, gameweek: currentGW, deadline_epoch: deadlineEpoch, reason: null };
    }

    const allFinished = gwMatches.every(m => m.status === 'finished');

    if (allFinished) {
      await snapshotGameweekIfNeeded(masterDb, currentGW);
    }

    return {
      locked: !allFinished,
      gameweek: currentGW,
      deadline_epoch: deadlineEpoch,
      reason: allFinished ? null : 'Squad is locked until every match in this gameweek has finished.'
    };
  } catch (error) {
    console.error('getFantasyLockStatus error:', error);
    // Fail open rather than locking everyone out on an unexpected error
    return { locked: false, gameweek: null, deadline_epoch: null, reason: null };
  }
}

// Last Man Standing's lock status — identical shape to getFantasyLockStatus,
// but once a gameweek's matches all finish it also works out who's out.
async function getLmsLockStatus(masterDb, supabaseAdmin, tournamentId) {
  try {
    const { data: clock } = await masterDb
      .from('master_clock')
      .select('current_gameweek')
      .eq('id', 'current')
      .maybeSingle();

    if (!clock || !clock.current_gameweek) {
      return { locked: false, gameweek: null, deadline_epoch: null, reason: 'Master clock not set yet.' };
    }

    const currentGW = clock.current_gameweek;

    // This tournament might start later than wherever the site-wide clock
    // currently sits (e.g. clock is on GW38 but this LMS tournament doesn't
    // begin until GW39) — nothing should lock or eliminate before that.
    let startGW = null;
    if (tournamentId && supabaseAdmin) {
      const { data: tournament } = await supabaseAdmin
        .schema('lms').from('tournaments')
        .select('gameweek')
        .eq('id', tournamentId)
        .maybeSingle();
      startGW = tournament ? tournament.gameweek : null;
    }

    if (startGW && currentGW < startGW) {
      return { locked: false, gameweek: startGW, deadline_epoch: null, reason: `Picks open in Gameweek ${startGW}.` };
    }

    const { data: gwMatches } = await masterDb
      .from('matches')
      .select('home_team, away_team, home_score, away_score, status, kickoff_time')
      .eq('gameweek', currentGW);

    if (!gwMatches || gwMatches.length === 0) {
      return { locked: false, gameweek: currentGW, deadline_epoch: null, reason: null };
    }

    const earliestKickoffMs = gwMatches.reduce((min, m) => {
      const t = new Date(m.kickoff_time).getTime();
      return (min === null || t < min) ? t : min;
    }, null);

    const deadlinePassed = earliestKickoffMs !== null && Date.now() >= earliestKickoffMs;
    const deadlineEpoch = earliestKickoffMs !== null ? Math.floor(earliestKickoffMs / 1000) : null;

    if (!deadlinePassed) {
      return { locked: false, gameweek: currentGW, deadline_epoch: deadlineEpoch, reason: null };
    }

    const allFinished = gwMatches.every(m => m.status === 'finished');

    // Still trigger elimination processing once everything's finished —
    // but the pick itself stays locked either way. Unlike Fantasy Manager
    // (where reopening after the gameweek finishes is correct, since
    // that's for editing the *next* squad), a Last Man Standing pick is
    // locked to one specific gameweek forever — there's no legitimate
    // reason to let someone change a pick once the result is known.
    if (allFinished && tournamentId && supabaseAdmin) {
      await processLmsEliminations(supabaseAdmin, tournamentId, currentGW, gwMatches);
    }

    return {
      locked: true,
      gameweek: currentGW,
      deadline_epoch: deadlineEpoch,
      reason: allFinished
        ? 'This gameweek has finished — picks are locked.'
        : 'This gameweek has kicked off — picks are locked.'
    };
  } catch (error) {
    console.error('getLmsLockStatus error:', error);
    return { locked: false, gameweek: null, deadline_epoch: null, reason: null };
  }
}

// Once a gameweek is fully finished: anyone whose picked team didn't WIN
// (draw or loss both count as out — standard Last Man Standing rules) is
// eliminated, and anyone who didn't pick at all is eliminated too.
// Idempotent via tournaments.last_processed_gameweek so a burst of page
// loads polling lms_lock_status doesn't reprocess the same gameweek.
async function processLmsEliminations(supabaseAdmin, tournamentId, gameweek, gwMatches) {
  try {
    // Atomically claim the right to process this gameweek. A plain
    // "read last_processed_gameweek, decide, then write it later" has a
    // race: two concurrent requests (e.g. two people loading the page at
    // the same moment) can both read the old value and both pass the
    // check before either has written anything, so both proceed to
    // process eliminations and payouts. A single conditional UPDATE closes
    // that gap — Postgres guarantees only one concurrent request can
    // actually match the WHERE clause and update the row; the loser gets
    // zero rows back and bails out immediately, before doing any work.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .schema('lms').from('tournaments')
      .update({ last_processed_gameweek: gameweek })
      .eq('id', tournamentId)
      .neq('status', 'finished')
      .or(`last_processed_gameweek.is.null,last_processed_gameweek.lt.${gameweek}`)
      .select('id, entry_fee')
      .maybeSingle();

    if (claimError) {
      console.error('processLmsEliminations claim error:', claimError);
      return;
    }
    if (!claimed) {
      return; // another request already claimed this gameweek, or the tournament's already finished
    }

    // Prize pool = entry fee x however many people are *actually* entered
    // right now, counted directly rather than trusting the tournament's
    // stored prize_pool column (nothing keeps that in sync — it's always
    // 0) or the cached current_entries counter (only updated by the normal
    // "Enter Now" flow, so it can drift if entries are ever added any
    // other way). Counting the real rows avoids both failure modes.
    const { count: entryCount, error: countError } = await supabaseAdmin
      .schema('lms').from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId);

    if (countError) {
      console.error('processLmsEliminations entry count error:', countError);
    }

    const prizePool = (claimed.entry_fee || 0) * (entryCount || 0);

    const { data: entries, error: entriesError } = await supabaseAdmin
      .schema('lms').from('tournament_entries')
      .select('id, user_id')
      .eq('tournament_id', tournamentId)
      .eq('is_eliminated', false);

    if (entriesError || !entries || entries.length === 0) {
      return; // nothing to process — the claim above already recorded this gameweek as handled
    }

    const { data: picks, error: picksError } = await supabaseAdmin
      .schema('lms').from('picks')
      .select('user_id, team')
      .eq('tournament_id', tournamentId)
      .eq('gameweek', gameweek);

    if (picksError) return;

    const pickByUser = new Map((picks || []).map(p => [p.user_id, p.team]));

    const winningTeams = new Set();
    gwMatches.forEach(m => {
      if (m.home_score === null || m.away_score === null) return;
      if (m.home_score > m.away_score) winningTeams.add(m.home_team);
      else if (m.away_score > m.home_score) winningTeams.add(m.away_team);
    });

    const survivors = [];
    for (const entry of entries) {
      const pickedTeam = pickByUser.get(entry.user_id);
      const survived = pickedTeam && winningTeams.has(pickedTeam);
      if (survived) {
        survivors.push(entry);
      } else {
        const { error: elimError } = await supabaseAdmin
          .schema('lms').from('tournament_entries')
          .update({ is_eliminated: true, eliminated_gameweek: gameweek })
          .eq('id', entry.id);
        if (elimError) console.error(`Failed to eliminate entry ${entry.id}:`, elimError);
      }
    }

    // Tournament end condition: exactly one survivor takes the whole pot.
    if (survivors.length === 1) {
      const { error: payoutError } = await supabaseAdmin
        .schema('lms').from('tournament_entries')
        .update({ prize_awarded: prizePool })
        .eq('id', survivors[0].id);
      if (payoutError) console.error(`Failed to award winner ${survivors[0].id}:`, payoutError);

      const { error: finishError } = await supabaseAdmin
        .schema('lms').from('tournaments')
        .update({ status: 'finished' })
        .eq('id', tournamentId);
      if (finishError) console.error(`Failed to mark tournament ${tournamentId} finished:`, finishError);

    // Everyone went out in the same gameweek (every pick drew or lost) —
    // split the pot evenly among whoever was still alive going into this
    // gameweek (the `entries` set, before this round's eliminations).
    } else if (survivors.length === 0) {
      const share = entries.length > 0 ? Math.floor(prizePool / entries.length) : 0;
      for (const entry of entries) {
        const { error: splitError } = await supabaseAdmin
          .schema('lms').from('tournament_entries')
          .update({ prize_awarded: share })
          .eq('id', entry.id);
        if (splitError) console.error(`Failed to award split-pot share to entry ${entry.id}:`, splitError);
      }

      const { error: finishError } = await supabaseAdmin
        .schema('lms').from('tournaments')
        .update({ status: 'finished' })
        .eq('id', tournamentId);
      if (finishError) console.error(`Failed to mark tournament ${tournamentId} finished:`, finishError);
    }
    // Otherwise more than one survivor remains — tournament continues.

  } catch (error) {
    console.error('processLmsEliminations error:', error);
  }
}

async function snapshotGameweekIfNeeded(masterDb, gameweek) {
  try {
    const { count } = await masterDb
      .from('player_gameweek_history')
      .select('id', { count: 'exact', head: true })
      .eq('gameweek', gameweek);

    if (count && count > 0) return; // already snapshotted

    const { data: players } = await masterDb
      .from('players')
      .select('id, event_points');

    if (!players || players.length === 0) return;

    const rows = players.map(p => ({
      player_id: p.id,
      gameweek: gameweek,
      event_points: p.event_points || 0
    }));

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await masterDb
        .from('player_gameweek_history')
        .upsert(rows.slice(i, i + CHUNK), { onConflict: 'player_id,gameweek' });
    }

    console.log(`Snapshotted GW${gameweek} for ${rows.length} players`);
  } catch (error) {
    console.error('snapshotGameweekIfNeeded error:', error);
  }
}

// ============================================================
// STOCK MARKET
// ============================================================

function elementTypeToPosition(elementType) {
  return { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' }[elementType] || null;
}

// Draft phase: open until tournament.closes_at, then the market initializes
// exactly once (locking every entry's squad forever — Stock Market squads
// are drafted once for the whole tournament, no weekly changes) and the
// tournament flips to 'live'. After that, per-gameweek price processing
// takes over, gated on the same gameweek all-finished pattern as
// LMS/Fantasy, with the same atomic-claim race-condition fix.
async function getStockMarketLockStatus(masterDb, supabaseAdmin, tournamentId) {
  try {
    const { data: tournament } = await supabaseAdmin
      .schema('stockmarket').from('tournaments')
      .select('id, status, closes_at, end_gameweek, gameweek, last_processed_gameweek')
      .eq('id', tournamentId)
      .maybeSingle();

    if (!tournament) {
      return { locked: false, drafting: false, reason: 'Tournament not found.' };
    }

    if (tournament.status === 'finished') {
      return { locked: true, drafting: false, marketLive: false, finished: true, reason: 'This market has closed.' };
    }

    if (tournament.status !== 'live') {
      const deadlinePassed = tournament.closes_at && Date.now() >= new Date(tournament.closes_at).getTime();
      if (!deadlinePassed) {
        return { locked: false, drafting: true, marketLive: false, closes_at: tournament.closes_at, reason: null };
      }
      // Deadline just passed — initialize the market exactly once.
      await initializeStockMarket(supabaseAdmin, masterDb, tournamentId);
      return { locked: true, drafting: false, marketLive: true, reason: 'Draft closed — the market is now live.' };
    }

    // Market is live — check whether this gameweek's matches have all
    // finished, and if so (and not already processed), run price processing.
    const { data: clock } = await masterDb
      .from('master_clock')
      .select('current_gameweek')
      .eq('id', 'current')
      .maybeSingle();

    if (!clock || !clock.current_gameweek) {
      return { locked: false, drafting: false, marketLive: true, gameweek: null, reason: 'Master clock not set yet.' };
    }

    const currentGW = clock.current_gameweek;
    if (tournament.gameweek && currentGW < tournament.gameweek) {
      return { locked: false, drafting: false, marketLive: true, gameweek: tournament.gameweek, reason: `Market starts processing from Gameweek ${tournament.gameweek}.` };
    }

    const { data: gwMatches } = await masterDb
      .from('matches')
      .select('status, kickoff_time')
      .eq('gameweek', currentGW);

    const allFinished = gwMatches && gwMatches.length > 0 && gwMatches.every(m => m.status === 'finished');

    if (allFinished) {
      await processStockMarketGameweek(supabaseAdmin, masterDb, tournamentId, currentGW);
    }

    return { locked: false, drafting: false, marketLive: true, gameweek: currentGW, processed: allFinished };
  } catch (error) {
    console.error('getStockMarketLockStatus error:', error);
    return { locked: false, drafting: false, marketLive: false, reason: null };
  }
}

// Runs exactly once when the draft window closes. Builds the shared player
// market from every entrant's squad, sets everyone's starting value equal
// (6 slots x slotValue, regardless of which players they picked), and
// permanently locks every squad.
async function initializeStockMarket(supabaseAdmin, masterDb, tournamentId) {
  try {
    const { data: tournament, error: tError } = await supabaseAdmin
      .schema('stockmarket').from('tournaments')
      .select('id, entry_fee, status')
      .eq('id', tournamentId)
      .maybeSingle();

    if (tError || !tournament || tournament.status === 'live' || tournament.status === 'finished') {
      return; // already initialized, or doesn't exist
    }

    const { data: entries, error: entriesError } = await supabaseAdmin
      .schema('stockmarket').from('tournament_entries')
      .select('id, user_id, squad_players')
      .eq('tournament_id', tournamentId)
      .not('squad_players', 'is', null);

    if (entriesError || !entries || entries.length === 0) {
      // Nothing to initialize — just flip status so we don't retry forever.
      await supabaseAdmin.schema('stockmarket').from('tournaments')
        .update({ status: 'live' }).eq('id', tournamentId);
      return;
    }

    const totalPot = (tournament.entry_fee || 0) * entries.length;
    const totalSlots = entries.length * 6;
    const slotValue = totalSlots > 0 ? Math.floor(totalPot / totalSlots) : 0;

    // Count ownership across every entrant's squad
    const ownership = {}; // player_id -> count
    entries.forEach(e => {
      (e.squad_players || []).forEach(p => {
        ownership[p.player_id] = (ownership[p.player_id] || 0) + 1;
      });
    });

    const playerIds = Object.keys(ownership).map(Number);
    const { data: playerRows } = await masterDb
      .from('players')
      .select('id, web_name, element_type, team')
      .in('id', playerIds);

    const { data: teamRows } = await masterDb.from('teams').select('id, name');
    const teamNameById = {};
    (teamRows || []).forEach(t => { teamNameById[t.id] = t.name; });

    const playerById = {};
    (playerRows || []).forEach(p => { playerById[p.id] = p; });

    const marketRows = playerIds.map(pid => {
      const p = playerById[pid] || {};
      const count = ownership[pid];
      return {
        tournament_id: tournamentId,
        player_id: pid,
        name: p.web_name || `Player ${pid}`,
        position: elementTypeToPosition(p.element_type),
        team: teamNameById[p.team] || '',
        ownership_count: count,
        current_value: count * slotValue,
        last_week_value: count * slotValue
      };
    });

    if (marketRows.length > 0) {
      await supabaseAdmin.schema('stockmarket').from('player_market')
        .upsert(marketRows, { onConflict: 'tournament_id,player_id' });
    }

    await supabaseAdmin.schema('stockmarket').from('config')
      .upsert({ tournament_id: tournamentId, slot_value: slotValue }, { onConflict: 'tournament_id' });

    const startingValue = 6 * slotValue;
    for (const entry of entries) {
      await supabaseAdmin.schema('stockmarket').from('tournament_entries')
        .update({
          squad_locked: true,
          start_value: startingValue,
          current_value: startingValue,
          last_week_value: startingValue
        })
        .eq('id', entry.id);
    }

    await supabaseAdmin.schema('stockmarket').from('tournaments')
      .update({ status: 'live', current_entries: entries.length })
      .eq('id', tournamentId);

    console.log(`Stock Market ${tournamentId} initialized: ${entries.length} entrants, ${playerIds.length} distinct players, slot value ${slotValue}p`);
  } catch (error) {
    console.error('initializeStockMarket error:', error);
  }
}

// Two-tier redistribution: match_share_pct of a delta is drawn from/given
// to other selected players in the SAME real match (concentrated, visible
// swings); the remainder spreads thin across the whole market (so a player
// with no match-mates still gets a real move, just less diluted since it's
// spread across everyone rather than trapped with no one to trade against).
function redistributeTwoTier(prices, targetPid, delta, totalPot, matchSharePct, sameMatchPids) {
  if (!delta) return;
  const target = prices[targetPid];
  if (!target) return;

  target.current_value = Math.round((target.current_value || 0) + delta);

  const matchPeers = sameMatchPids.filter(pid => pid !== targetPid && prices[pid]);
  const allOtherPids = Object.keys(prices).filter(pid => pid !== targetPid);
  if (allOtherPids.length === 0) return;

  if (matchPeers.length > 0) {
    const matchDelta = delta * matchSharePct;
    const globalDelta = delta * (1 - matchSharePct);

    const matchShare = matchDelta / matchPeers.length;
    matchPeers.forEach(pid => { prices[pid].current_value = Math.round((prices[pid].current_value || 0) - matchShare); });

    const globalOthers = allOtherPids.filter(pid => !matchPeers.includes(pid));
    if (globalOthers.length > 0) {
      const globalShare = globalDelta / globalOthers.length;
      globalOthers.forEach(pid => { prices[pid].current_value = Math.round((prices[pid].current_value || 0) - globalShare); });
    } else {
      const extraShare = globalDelta / matchPeers.length;
      matchPeers.forEach(pid => { prices[pid].current_value = Math.round((prices[pid].current_value || 0) - extraShare); });
    }
  } else {
    // No one else selected from this player's match — the whole delta
    // draws from the thin global pool, so this player keeps almost all of it.
    const share = delta / allOtherPids.length;
    allOtherPids.forEach(pid => { prices[pid].current_value = Math.round((prices[pid].current_value || 0) - share); });
  }

  // Floor at £0
  Object.keys(prices).forEach(pid => {
    if ((prices[pid].current_value || 0) < 0) prices[pid].current_value = 0;
  });

  // Rebalance to guard against rounding drift — total must stay exact
  const totalAfter = Object.values(prices).reduce((s, p) => s + (p.current_value || 0), 0);
  if (totalAfter > 0 && Math.abs(totalAfter - totalPot) > 1) {
    const factor = totalPot / totalAfter;
    Object.keys(prices).forEach(pid => {
      prices[pid].current_value = Math.round((prices[pid].current_value || 0) * factor);
    });
  }
}

async function processStockMarketGameweek(supabaseAdmin, masterDb, tournamentId, gameweek) {
  try {
    // Atomic claim — same race-condition fix as LMS.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .schema('stockmarket').from('tournaments')
      .update({ last_processed_gameweek: gameweek })
      .eq('id', tournamentId)
      .neq('status', 'finished')
      .or(`last_processed_gameweek.is.null,last_processed_gameweek.lt.${gameweek}`)
      .select('id, end_gameweek, entry_fee')
      .maybeSingle();

    if (claimError) { console.error('processStockMarketGameweek claim error:', claimError); return; }
    if (!claimed) return; // already processed, or someone else claimed it

    const { data: marketRows, error: marketError } = await supabaseAdmin
      .schema('stockmarket').from('player_market')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (marketError || !marketRows || marketRows.length === 0) return;

    const { data: config } = await supabaseAdmin
      .schema('stockmarket').from('config')
      .select('*')
      .eq('tournament_id', tournamentId)
      .maybeSingle();

    if (!config) return;

    const eventWeights = config.event_weights || {};
    const matchSharePct = config.match_share_pct != null ? Number(config.match_share_pct) : 0.8;
    const goalCap = config.goal_cap || 3;
    const assistCap = config.assist_cap || 3;
    const slotValue = config.slot_value || 0;
    const totalPot = marketRows.reduce((s, p) => s + (p.current_value || 0), 0);

    // Build prices map keyed by player_id (string, for object key safety)
    const prices = {};
    marketRows.forEach(p => { prices[String(p.player_id)] = { ...p }; });

    // Map each player's team to the real match they're playing this gameweek
    const { data: gwMatches } = await masterDb
      .from('matches')
      .select('home_team, away_team, status')
      .eq('gameweek', gameweek);

    const teamToMatchKey = {};
    (gwMatches || []).forEach((m, idx) => {
      const key = `match_${idx}`;
      teamToMatchKey[m.home_team] = key;
      teamToMatchKey[m.away_team] = key;
    });

    // Group selected players by which match they're in
    const matchGroups = {}; // matchKey -> [player_id strings]
    Object.keys(prices).forEach(pid => {
      const team = prices[pid].team;
      const matchKey = teamToMatchKey[team];
      if (!matchKey) return;
      (matchGroups[matchKey] = matchGroups[matchKey] || []).push(pid);
    });

    // Fetch this gameweek's real stats directly from FPL's live event feed
    let liveElements = [];
    try {
      const liveRes = await fetch(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`);
      if (liveRes.ok) {
        const liveData = await liveRes.json();
        liveElements = liveData.elements || [];
      }
    } catch (fetchErr) {
      console.error('Failed to fetch FPL live event data:', fetchErr);
      return;
    }

    const redCardPids = [];

    liveElements.forEach(el => {
      const pid = String(el.id);
      const priceData = prices[pid];
      if (!priceData) return; // not selected by anyone — not part of this market

      const weights = eventWeights[priceData.position];
      if (!weights) return;

      const stats = el.stats || {};
      let rawScore = 0;

      const cappedGoals = Math.min(stats.goals_scored || 0, goalCap);
      const cappedAssists = Math.min(stats.assists || 0, assistCap);
      if (cappedGoals > 0 && weights.goal) rawScore += cappedGoals * weights.goal;
      if (cappedAssists > 0 && weights.assist) rawScore += cappedAssists * weights.assist;
      if ((stats.yellow_cards || 0) > 0 && weights.yellow_card) rawScore += stats.yellow_cards * weights.yellow_card;
      if ((stats.clean_sheets || 0) > 0 && weights.clean_sheet) rawScore += weights.clean_sheet;
      if ((stats.goals_conceded || 0) > 0 && weights.goal_conceded) rawScore += stats.goals_conceded * weights.goal_conceded;
      if ((stats.saves || 0) > 0 && weights.save) rawScore += stats.saves * weights.save;

      if (rawScore !== 0) {
        const delta = Math.round(rawScore * slotValue * (priceData.ownership_count || 1));
        const team = priceData.team;
        const matchKey = teamToMatchKey[team];
        const sameMatchPids = matchKey ? (matchGroups[matchKey] || []) : [];
        redistributeTwoTier(prices, pid, delta, totalPot, matchSharePct, sameMatchPids);
      }

      prices[pid].last_gw_stats = {
        goals: stats.goals_scored || 0,
        assists: stats.assists || 0,
        yellow_cards: stats.yellow_cards || 0,
        red_cards: stats.red_cards || 0,
        clean_sheets: stats.clean_sheets || 0,
        goals_conceded: stats.goals_conceded || 0,
        saves: stats.saves || 0,
        minutes: stats.minutes || 0
      };

      if ((stats.red_cards || 0) > 0) redCardPids.push(pid);
    });

    // Catastrophic red card — full current value wiped, redistributed away
    redCardPids.forEach(pid => {
      const p = prices[pid];
      if (!p || (p.current_value || 0) <= 0) return;
      const delta = -p.current_value;
      const team = p.team;
      const matchKey = teamToMatchKey[team];
      const sameMatchPids = matchKey ? (matchGroups[matchKey] || []) : [];
      redistributeTwoTier(prices, pid, delta, totalPot, matchSharePct, sameMatchPids);
      if (prices[pid].last_gw_stats) prices[pid].last_gw_stats.catastrophic_red_card = true;
    });

    // Save updated market rows
    for (const pid of Object.keys(prices)) {
      const p = prices[pid];
      await supabaseAdmin.schema('stockmarket').from('player_market')
        .update({
          last_week_value: marketRows.find(m => String(m.player_id) === pid)?.current_value || 0,
          current_value: p.current_value,
          last_gw_stats: p.last_gw_stats || null
        })
        .eq('tournament_id', tournamentId)
        .eq('player_id', Number(pid));
    }

    // Recalculate every entrant's portfolio from the final prices
    const { data: entries } = await supabaseAdmin
      .schema('stockmarket').from('tournament_entries')
      .select('id, current_value, squad_players')
      .eq('tournament_id', tournamentId);

    for (const entry of (entries || [])) {
      const squad = entry.squad_players || [];
      const newValue = Math.round(squad.reduce((sum, sp) => {
        const p = prices[String(sp.player_id)];
        if (!p) return sum;
        return sum + (p.current_value || 0) / (p.ownership_count || 1);
      }, 0));

      await supabaseAdmin.schema('stockmarket').from('tournament_entries')
        .update({ last_week_value: entry.current_value, current_value: newValue })
        .eq('id', entry.id);
    }

    // Season over once we've processed the tournament's final gameweek —
    // final portfolio values ARE the payout, nothing further to calculate
    // since the whole system stays zero-sum throughout.
    if (claimed.end_gameweek && gameweek >= claimed.end_gameweek) {
      await supabaseAdmin.schema('stockmarket').from('tournaments')
        .update({ status: 'finished' })
        .eq('id', tournamentId);
    }

    console.log(`Stock Market ${tournamentId} GW${gameweek} processed — ${liveElements.filter(el => prices[String(el.id)]).length} selected players had live data, ${redCardPids.length} catastrophic red cards`);
  } catch (error) {
    console.error('processStockMarketGameweek error:', error);
  }
}

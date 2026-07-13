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
      // Zero-sum audit history — admin only. Shows every processed
      // gameweek's actual total portfolio value against what the pot
      // should be, so drift is visible immediately rather than needing
      // a manual CSV check each time.
      const stockmarketAudit = params.get('stockmarket_audit');
      if (stockmarketAudit === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: auditRows, error: auditError } = await supabaseAdmin
          .schema('stockmarket').from('audit_log')
          .select('*')
          .eq('tournament_id', tournamentId)
          .order('gameweek', { ascending: true });

        if (auditError) return res.status(500).json({ error: 'Failed to fetch audit log', details: auditError.message });
        return res.status(200).json({ audit: auditRows || [] });
      }

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
            .in('player_id', squad.filter(s => !s.empty).map(s => s.player_id));

          const marketByPid = {};
          (marketRows || []).forEach(m => { marketByPid[m.player_id] = m; });

          const filledIds = squad.filter(s => !s.empty).map(s => s.player_id);
          const { data: photoRows } = filledIds.length > 0
            ? await masterDb.from('players').select('id, photo').in('id', filledIds)
            : { data: [] };
          const photoByPid = {};
          (photoRows || []).forEach(p => {
            photoByPid[p.id] = p.photo ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${p.photo.replace('.jpg', '')}.png` : null;
          });

          // If the real market hasn't initialized yet (still drafting),
          // compute a live, non-permanent preview from everyone who's
          // currently entered — same formula the real initialization
          // uses, just recalculated fresh each time rather than written
          // to the database. Updates naturally as more people join/draft.
          let previewSlotValue = 0;
          let previewOwnership = {};
          if ((marketRows || []).length === 0) {
            const { data: tournamentRow } = await supabaseAdmin
              .schema('stockmarket').from('tournaments')
              .select('entry_fee')
              .eq('id', tournamentId)
              .maybeSingle();

            const { data: allEntries } = await supabaseAdmin
              .schema('stockmarket').from('tournament_entries')
              .select('squad_players')
              .eq('tournament_id', tournamentId)
              .not('squad_players', 'is', null);

            const entryCount = (allEntries || []).length;
            if (entryCount > 0 && tournamentRow) {
              const previewPot = (tournamentRow.entry_fee || 0) * entryCount;
              previewSlotValue = Math.floor(previewPot / (entryCount * 6));
              (allEntries || []).forEach(e => {
                (e.squad_players || []).forEach(sp => {
                  previewOwnership[sp.player_id] = (previewOwnership[sp.player_id] || 0) + 1;
                });
              });
            }
          }

          portfolio = squad.map(s => {
            if (s.empty) {
              const shortToLabel = { gk: 'Goalkeeper', def: 'Defender', mid: 'Midfielder', fwd: 'Forward' };
              return {
                player_id: null, name: null, position: s.position, position_label: shortToLabel[s.position] || s.position, team: null,
                empty: true, reserved_value: s.reserved_value || 0,
                your_value: s.reserved_value || 0, preview_value: null, market_value: null
              };
            }
            const m = marketByPid[s.player_id] || {};
            const ownership = m.ownership_count || previewOwnership[s.player_id] || 1;
            const posLabel = { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' }[s.position] || s.position;
            const previewValue = previewSlotValue > 0
              ? previewSlotValue * (previewOwnership[s.player_id] || 1)
              : null;
            const sharedShare = m.current_value ? Math.round(m.current_value / ownership) : null;
            const lastWeekShare = m.last_week_value ? Math.round(m.last_week_value / ownership) : null;
            const yourValue = sharedShare !== null ? sharedShare + (s.bonus_value || 0) : null;
            const yourLastWeekValue = lastWeekShare !== null ? lastWeekShare + (s.bonus_value || 0) : null;
            return {
              player_id: s.player_id,
              name: m.name || s.name || '',
              position: m.position || posLabel || '',
              team: m.team || s.team || '',
              photo: photoByPid[s.player_id] || null,
              ownership_count: ownership,
              your_value: yourValue,
              value_change: (yourValue !== null && yourLastWeekValue !== null) ? yourValue - yourLastWeekValue : null,
              bonus_value: s.bonus_value || 0,
              preview_value: previewValue,
              market_value: m.current_value || null,
              last_gw_stats: m.last_gw_stats || null,
              is_sub: s.is_sub || false
            };
          });
        }

        // The auto-notice popup should only show once — clear it as soon
        // as it's been delivered to the frontend.
        const autoNotice = entry.pending_auto_notice || null;
        if (autoNotice) {
          await supabaseAdmin.schema('stockmarket').from('tournament_entries')
            .update({ pending_auto_notice: null }).eq('id', entry.id);
        }

        return res.status(200).json({ entry, portfolio, auto_notice: autoNotice });
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

      // Notification bell: active admin broadcast messages, plus real
      // pending-action items computed from the user's actual state in
      // each tournament they're entered in (clears itself automatically
      // once the action is done — nothing to dismiss manually).
      const notifications = params.get('notifications');
      if (notifications === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({ error: 'Authentication required' });
        }
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) {
          return res.status(401).json({ error: 'Invalid token' });
        }

        const { data: adminMessages } = await supabaseAdmin
          .from('admin_messages')
          .select('*')
          .eq('active', true)
          .order('created_at', { ascending: false });

        const actionItems = [];

        try {
          // ---- Predictions: unpredicted matches in the current gameweek ----
          const { data: predTournament } = await supabaseAdmin
            .schema('predictions').from('tournaments')
            .select('id').eq('status', 'live').limit(1).maybeSingle();

          if (predTournament) {
            const { data: predEntry } = await supabaseAdmin
              .schema('predictions').from('tournament_entries')
              .select('id').eq('tournament_id', predTournament.id).eq('user_id', user.id).maybeSingle();

            if (predEntry) {
              const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
              const gw = clock?.current_gameweek;
              if (gw) {
                const { data: gwMatches } = await masterDb.from('matches').select('id, kickoff_time').eq('gameweek', gw);
                const upcoming = (gwMatches || []).filter(m => new Date(m.kickoff_time).getTime() > Date.now());
                if (upcoming.length > 0) {
                  const { data: myPreds } = await supabaseAdmin
                    .schema('predictions').from('predictions')
                    .select('match_id').eq('user_id', user.id).eq('gameweek', gw);
                  const predictedIds = new Set((myPreds || []).map(p => p.match_id));
                  const missing = upcoming.filter(m => !predictedIds.has(m.id));
                  if (missing.length > 0) {
                    actionItems.push({
                      type: 'predictions', href: '/predict',
                      message: `You have ${missing.length} unpredicted match${missing.length === 1 ? '' : 'es'} in Gameweek ${gw}.`
                    });
                  }
                }
              }
            }
          }
        } catch (e) { console.error('notifications: predictions check failed', e); }

        try {
          // ---- Fantasy Manager: entered but no squad saved yet ----
          const { data: fmTournament } = await supabaseAdmin
            .schema('fantasy').from('tournaments')
            .select('id').eq('status', 'live').limit(1).maybeSingle();

          if (fmTournament) {
            const { data: fmEntry } = await supabaseAdmin
              .schema('fantasy').from('tournament_entries')
              .select('squad_players').eq('tournament_id', fmTournament.id).eq('user_id', user.id).maybeSingle();

            if (fmEntry && (!fmEntry.squad_players || fmEntry.squad_players.length === 0)) {
              actionItems.push({ type: 'fantasy', href: '/fantasy-manager', message: 'Your Fantasy Manager squad is empty — build it before the deadline.' });
            }
          }
        } catch (e) { console.error('notifications: fantasy check failed', e); }

        try {
          // ---- Last Man Standing: entered, alive, no pick for the current gameweek ----
          const { data: lmsTournament } = await supabaseAdmin
            .schema('lms').from('tournaments')
            .select('id, gameweek').eq('status', 'live').limit(1).maybeSingle();

          if (lmsTournament) {
            const { data: lmsEntry } = await supabaseAdmin
              .schema('lms').from('tournament_entries')
              .select('id, is_eliminated').eq('tournament_id', lmsTournament.id).eq('user_id', user.id).maybeSingle();

            if (lmsEntry && !lmsEntry.is_eliminated) {
              const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
              const gw = clock?.current_gameweek && clock.current_gameweek >= lmsTournament.gameweek ? clock.current_gameweek : lmsTournament.gameweek;
              const { data: myPick } = await supabaseAdmin
                .schema('lms').from('picks')
                .select('id').eq('tournament_id', lmsTournament.id).eq('user_id', user.id).eq('gameweek', gw).maybeSingle();

              if (!myPick) {
                actionItems.push({ type: 'lms', href: `/last-man-standing-pick?gameweek=${gw}`, message: `You haven't made your Last Man Standing pick for Gameweek ${gw} yet.` });
              }
            }
          }
        } catch (e) { console.error('notifications: lms check failed', e); }

        try {
          // ---- Stock Market: entered, still drafting, no squad saved yet ----
          const { data: smTournament } = await supabaseAdmin
            .schema('stockmarket').from('tournaments')
            .select('id, status, closes_at').in('status', ['upcoming', 'live']).limit(1).maybeSingle();

          if (smTournament) {
            const draftOpen = smTournament.status !== 'live' || (smTournament.closes_at && Date.now() < new Date(smTournament.closes_at).getTime());
            const { data: smEntry } = await supabaseAdmin
              .schema('stockmarket').from('tournament_entries')
              .select('squad_players, squad_locked').eq('tournament_id', smTournament.id).eq('user_id', user.id).maybeSingle();

            if (smEntry && !smEntry.squad_locked && (!smEntry.squad_players || smEntry.squad_players.length === 0) && draftOpen) {
              actionItems.push({ type: 'stockmarket', href: '/stock-market-draft', message: "You haven't drafted your Stock Market squad yet." });
            }

            if (smEntry && smEntry.squad_locked && smEntry.squad_players) {
              const emptySlots = smEntry.squad_players.filter(s => s.empty);
              if (emptySlots.length > 0) {
                const posNames = emptySlots.map(s => ({ 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' }[s.position] || 'player').toLowerCase());
                actionItems.push({ type: 'stockmarket', href: '/stock-market', message: `You have an empty ${posNames.join(', ')} slot to fill in Stock Market.` });
              }
            }
          }
        } catch (e) { console.error('notifications: stockmarket check failed', e); }

        return res.status(200).json({ admin_messages: adminMessages || [], action_items: actionItems });
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

      const { action, tournament_id, name, entry_fee, prize_pool, gameweek, end_gameweek, max_entries, closes_at, squad_players, captain_id, tournament_type, team, pack_type, position, player_id, is_sub } = req.body;
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

      // ADMIN: broadcast a message to every user (shows in the notification bell)
      if (action === 'admin_broadcast') {
        const { data: caller, error: callerError } = await supabaseAdmin
          .from('users').select('is_admin').eq('id', user.id).maybeSingle();

        if (callerError || !caller || !caller.is_admin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { message, severity } = req.body;
        if (!message || !message.trim()) {
          return res.status(400).json({ error: 'message is required' });
        }

        const { data: created, error: createError } = await supabaseAdmin
          .from('admin_messages')
          .insert({ message: message.trim(), severity: severity || 'info', created_by: user.id })
          .select()
          .single();

        if (createError) {
          return res.status(500).json({ error: 'Failed to create message', details: createError.message });
        }

        return res.status(201).json({ success: true, message: created });
      }

      // ADMIN: deactivate a previously broadcast message
      if (action === 'admin_broadcast_deactivate') {
        const { data: caller, error: callerError } = await supabaseAdmin
          .from('users').select('is_admin').eq('id', user.id).maybeSingle();

        if (callerError || !caller || !caller.is_admin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const { message_id } = req.body;
        if (!message_id) {
          return res.status(400).json({ error: 'message_id is required' });
        }

        const { error: updateError } = await supabaseAdmin
          .from('admin_messages')
          .update({ active: false })
          .eq('id', message_id);

        if (updateError) {
          return res.status(500).json({ error: 'Failed to deactivate message', details: updateError.message });
        }

        return res.status(200).json({ success: true });
      }


      // ADMIN: sync REAL historical per-gameweek player stats from FPL's
      // live feed into the local master table. This is genuine past data
      // — not invented — so rewinding the master clock to GW1 and
      // advancing week by week plays through an actual real season for
      // testing every tournament type consistently, Stock Market included.
      if (action === 'sync_historical_gameweek_stats') {
        const { data: caller, error: callerError } = await supabaseAdmin
          .from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (callerError || !caller || !caller.is_admin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        const syncGw = req.body.gameweek;
        if (!syncGw) return res.status(400).json({ error: 'gameweek is required' });

        try {
          const liveRes = await fetch(`https://fantasy.premierleague.com/api/event/${syncGw}/live/`);
          if (!liveRes.ok) {
            return res.status(502).json({ error: `FPL API returned ${liveRes.status} for GW${syncGw}` });
          }
          const liveData = await liveRes.json();
          const elements = liveData.elements || [];

          if (elements.length === 0) {
            return res.status(404).json({ error: `No data returned for GW${syncGw} — it may not have been played yet` });
          }

          const statRows = elements.map(el => ({
            gameweek: syncGw, player_id: el.id,
            goals_scored: el.stats?.goals_scored || 0,
            assists: el.stats?.assists || 0,
            yellow_cards: el.stats?.yellow_cards || 0,
            red_cards: el.stats?.red_cards || 0,
            clean_sheets: el.stats?.clean_sheets || 0,
            goals_conceded: el.stats?.goals_conceded || 0,
            saves: el.stats?.saves || 0,
            minutes: el.stats?.minutes || 0
          }));

          const CHUNK = 200;
          for (let i = 0; i < statRows.length; i += CHUNK) {
            await masterDb.from('player_gameweek_stats').upsert(statRows.slice(i, i + CHUNK), { onConflict: 'gameweek,player_id' });
          }

          return res.status(200).json({ success: true, gameweek: syncGw, players_synced: statRows.length });
        } catch (err) {
          console.error('sync_historical_gameweek_stats error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // ADMIN: force a re-sync next time this gameweek is processed, by
      // clearing its cached row(s). Useful if FPL corrects a result after
      // the fact. Omit gameweek to clear the whole cache.
      if (action === 'clear_gameweek_stats_cache') {
        const { data: caller, error: callerError } = await supabaseAdmin
          .from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (callerError || !caller || !caller.is_admin) {
          return res.status(403).json({ error: 'Admin access required' });
        }

        try {
          let query = masterDb.from('player_gameweek_stats').delete();
          query = req.body.gameweek ? query.eq('gameweek', req.body.gameweek) : query.gte('gameweek', 0);
          await query;
          return res.status(200).json({ success: true });
        } catch (err) {
          console.error('clear_gameweek_stats_cache error:', err);
          return res.status(500).json({ error: err.message });
        }
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

            const { data: teamRowsForSquad } = await masterDb.from('teams').select('id, name');
            const teamNameByIdForSquad = {};
            (teamRowsForSquad || []).forEach(t => { teamNameByIdForSquad[t.id] = t.name; });

            entryPayload.squad_players = squad_players.map(pid => {
              const p = squadRows.find(r => r.id === pid);
              return {
                player_id: pid,
                position: p.element_type,
                name: p.web_name,
                team: teamNameByIdForSquad[p.team] || '',
                bonus_value: 0,          // private value on top of the shared stock price — never affects other owners
                acquired_gameweek: null, // set once the market actually initializes
                active_weeks_held: 0,    // only increments while not marked sub — 2 triggers auto-sell
                is_sub: false
              };
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

      // Stock Market: open a pack (starter draft, or a targeted transfer
      // pack after selling). Doesn't commit anything — just returns
      // candidates for the user to choose from.
      if (action === 'stockmarket_open_pack') {
        try {
          if (!tournament_id) return res.status(400).json({ error: 'tournament_id is required' });

          const { data: config } = await supabaseAdmin
            .schema('stockmarket').from('config')
            .select('*').eq('tournament_id', tournament_id).maybeSingle();

          const mode = position ? 'transfer' : 'starter';
          if (mode === 'transfer' && !pack_type) {
            return res.status(400).json({ error: 'pack_type is required for a transfer pack' });
          }

          const candidates = await buildCandidatePool(supabaseAdmin, masterDb, tournament_id, config || {},
            mode === 'starter' ? { mode: 'starter' } : { mode: 'transfer', packType: pack_type, position });

          const packFee = mode === 'transfer' ? packPriceFor(config, pack_type) : null;

          return res.status(200).json({ candidates, mode, pack_fee: packFee });
        } catch (err) {
          console.error('stockmarket_open_pack error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Stock Market: sell a player from your squad. Cashes out your
      // private share of their value; a portion re-seeds the (now empty)
      // slot at the original starting value, the remainder splits across
      // your other remaining players as a private bonus_value — never
      // touches the shared stock price other owners see.
      if (action === 'stockmarket_sell') {
        try {
          if (!tournament_id || !player_id) {
            return res.status(400).json({ error: 'tournament_id and player_id are required' });
          }

          const { data: entry, error: entryError } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('*').eq('tournament_id', tournament_id).eq('user_id', user.id).maybeSingle();

          if (entryError || !entry) return res.status(404).json({ error: 'Entry not found' });
          if (!entry.squad_locked) return res.status(400).json({ error: 'Squad not locked yet — nothing to sell' });

          const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
          const currentGW = clock ? clock.current_gameweek : null;

          if (currentGW && entry.last_transfer_gameweek && entry.last_transfer_gameweek >= currentGW) {
            return res.status(403).json({ error: 'You can only make 1 transfer per gameweek' });
          }

          const squad = entry.squad_players || [];
          const sellIdx = squad.findIndex(s => s.player_id === player_id);
          if (sellIdx === -1) return res.status(404).json({ error: 'That player is not in your squad' });
          if (squad[sellIdx].empty) return res.status(400).json({ error: 'That slot is already empty' });

          const { data: marketRow } = await supabaseAdmin
            .schema('stockmarket').from('player_market')
            .select('*').eq('tournament_id', tournament_id).eq('player_id', player_id).maybeSingle();
          if (!marketRow) return res.status(404).json({ error: 'Player not found in market' });

          const ownership = marketRow.ownership_count || 1;
          const sharedShare = Math.round((marketRow.current_value || 0) / ownership);
          const yourValue = sharedShare + (squad[sellIdx].bonus_value || 0);

          const { data: config } = await supabaseAdmin
            .schema('stockmarket').from('config')
            .select('slot_value').eq('tournament_id', tournament_id).maybeSingle();
          const slotValue = (config && config.slot_value) || 0;

          const reseed = Math.min(yourValue, slotValue);
          const remainder = yourValue - reseed;
          const others = squad.filter((s, i) => i !== sellIdx && !s.empty && !s.is_sub);

          // Reduce ownership on the sold player's shared stock — only
          // this changes what other owners see, and only via ownership
          // count, not a direct value edit.
          const newOwnership = Math.max(0, ownership - 1);
          const newMarketValue = newOwnership > 0
            ? Math.round((marketRow.current_value || 0) * (newOwnership / ownership))
            : 0;
          await supabaseAdmin
            .schema('stockmarket').from('player_market')
            .update({ ownership_count: newOwnership, current_value: newMarketValue })
            .eq('id', marketRow.id);

          squad[sellIdx] = { empty: true, position: POSITION_KEY[squad[sellIdx].position] || squad[sellIdx].position, reserved_value: reseed };

          if (others.length > 0 && remainder > 0) {
            const share = Math.floor(remainder / others.length);
            others.forEach(o => { o.bonus_value = (o.bonus_value || 0) + share; });
          }

          await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .update({ squad_players: squad, last_transfer_gameweek: currentGW })
            .eq('id', entry.id);

          return res.status(200).json({ success: true, sold_for: yourValue, reseed, remainder });
        } catch (err) {
          console.error('stockmarket_sell error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Stock Market: buy a replacement to fill an empty slot after a
      // sale. The pack fee comes out of YOUR squad's own value (spread
      // across your other players) and is redistributed evenly across
      // every OTHER entrant's squad as a private bonus_value.
      if (action === 'stockmarket_buy_replacement') {
        try {
          if (!tournament_id || !player_id || !position) {
            return res.status(400).json({ error: 'tournament_id, player_id and position are required' });
          }

          const { data: entry, error: entryError } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('*').eq('tournament_id', tournament_id).eq('user_id', user.id).maybeSingle();
          if (entryError || !entry) return res.status(404).json({ error: 'Entry not found' });

          const squad = entry.squad_players || [];
          const emptyIdx = squad.findIndex(s => s.empty && s.position === position);
          if (emptyIdx === -1) return res.status(400).json({ error: `No empty ${position} slot to fill` });

          const alreadyOwned = squad.some(s => s.player_id === player_id);
          if (alreadyOwned) return res.status(400).json({ error: 'You already own this player' });

          if (!pack_type) return res.status(400).json({ error: 'pack_type is required' });

          const { data: config } = await supabaseAdmin
            .schema('stockmarket').from('config')
            .select('*').eq('tournament_id', tournament_id).maybeSingle();
          const slotValue = (config && config.slot_value) || 0;
          const packFee = packPriceFor(config, pack_type);

          const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
          const currentGW = clock ? clock.current_gameweek : null;

          const { data: teamRows } = await masterDb.from('teams').select('id, name');
          const { data: playerRow } = await masterDb.from('players').select('id, web_name, team, element_type').eq('id', player_id).maybeSingle();
          if (!playerRow) return res.status(404).json({ error: 'Player not found' });
          const teamName = (teamRows || []).find(t => t.id === playerRow.team)?.name || '';

          const reservedValue = squad[emptyIdx].reserved_value || slotValue;

          // Fill the slot. Starting value = whatever was reserved from the
          // sale, minus this pack's fee (paid by you).
          squad[emptyIdx] = {
            player_id,
            position,
            name: playerRow.web_name,
            team: teamName,
            bonus_value: Math.max(0, reservedValue - packFee),
            acquired_gameweek: currentGW,
            active_weeks_held: 0,
            is_sub: false
          };

          // Spread the pack fee cost across your OTHER players if the
          // reserve alone didn't cover it (fee > reserved_value case);
          // otherwise the fee was already absorbed above.
          const shortfall = Math.max(0, packFee - reservedValue);
          if (shortfall > 0) {
            const others = squad.filter((s, i) => i !== emptyIdx && !s.empty && !s.is_sub);
            if (others.length > 0) {
              const share = Math.ceil(shortfall / others.length);
              others.forEach(o => { o.bonus_value = Math.max(0, (o.bonus_value || 0) - share); });
            }
          }

          // Upsert the new player into the shared market (create the stock
          // if nobody's ever owned it before this tournament). Never add
          // fresh value here — the buyer's contribution is already fully
          // tracked via their private bonus_value; doing both was minting
          // money out of nothing every single purchase.
          const { data: existingMarket } = await supabaseAdmin
            .schema('stockmarket').from('player_market')
            .select('*').eq('tournament_id', tournament_id).eq('player_id', player_id).maybeSingle();

          if (existingMarket) {
            await supabaseAdmin.schema('stockmarket').from('player_market')
              .update({ ownership_count: (existingMarket.ownership_count || 0) + 1 })
              .eq('id', existingMarket.id);
          } else {
            await supabaseAdmin.schema('stockmarket').from('player_market').insert({
              tournament_id, player_id, name: playerRow.web_name,
              position: { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' }[playerRow.element_type] || '',
              team: teamName, ownership_count: 1, current_value: 0, last_week_value: 0
            });
          }

          // Redistribute the pack fee evenly across every OTHER entrant's
          // squad — a private bonus_value bump, same mechanism as above.
          const { data: otherEntries } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, squad_players').eq('tournament_id', tournament_id).neq('user_id', user.id).eq('squad_locked', true);

          if (otherEntries && otherEntries.length > 0 && packFee > 0) {
            const perEntryShare = Math.floor(packFee / otherEntries.length);
            for (const other of otherEntries) {
              const otherSquad = other.squad_players || [];
              const nonEmpty = otherSquad.filter(s => !s.empty);
              if (nonEmpty.length === 0) continue;
              const perPlayerShare = Math.floor(perEntryShare / nonEmpty.length);
              nonEmpty.forEach(s => { s.bonus_value = (s.bonus_value || 0) + perPlayerShare; });
              await supabaseAdmin.schema('stockmarket').from('tournament_entries')
                .update({ squad_players: otherSquad }).eq('id', other.id);
            }
          }

          await supabaseAdmin.schema('stockmarket').from('tournament_entries')
            .update({ squad_players: squad }).eq('id', entry.id);

          return res.status(200).json({ success: true, pack_fee: packFee });
        } catch (err) {
          console.error('stockmarket_buy_replacement error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Stock Market: toggle sub status — pauses the 2-week auto-sell
      // clock while benched, resumes (doesn't reset) when reactivated.
      if (action === 'stockmarket_toggle_sub') {
        try {
          if (!tournament_id || !player_id || typeof is_sub !== 'boolean') {
            return res.status(400).json({ error: 'tournament_id, player_id and is_sub are required' });
          }

          const { data: entry, error: entryError } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('*').eq('tournament_id', tournament_id).eq('user_id', user.id).maybeSingle();
          if (entryError || !entry) return res.status(404).json({ error: 'Entry not found' });

          const squad = entry.squad_players || [];
          const idx = squad.findIndex(s => s.player_id === player_id);
          if (idx === -1) return res.status(404).json({ error: 'That player is not in your squad' });

          squad[idx].is_sub = is_sub;

          await supabaseAdmin.schema('stockmarket').from('tournament_entries')
            .update({ squad_players: squad }).eq('id', entry.id);

          return res.status(200).json({ success: true });
        } catch (err) {
          console.error('stockmarket_toggle_sub error:', err);
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
      .select('id, entry_fee, status, gameweek')
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
      const stampedSquad = (entry.squad_players || []).map(p => ({
        ...p,
        acquired_gameweek: tournament.gameweek,
        active_weeks_held: 0,
        is_sub: p.is_sub || false,
        bonus_value: p.bonus_value || 0
      }));
      await supabaseAdmin.schema('stockmarket').from('tournament_entries')
        .update({
          squad_locked: true,
          squad_players: stampedSquad,
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

// Rarity tiers based on FPL points this season — self-adjusts as the
// season progresses (everyone's "Bronze" early on, proven performers
// migrate to Gold pools later). Matches the original pack system's model.
const RARITY_THRESHOLDS = {
  Bronze: { min: 0, max: 50 },
  Silver: { min: 51, max: 100 },
  Gold: { min: 101, max: 9999 }
};

// How many of each rarity/position slot a STARTER pack offers, scaled
// down from the original 16-man matrix for a 6-man squad.
const STARTER_PACK_MATRIX = {
  Bronze: { gk: 2, def: 4, mid: 3, fwd: 2 },
  Silver: { gk: 1, def: 2, mid: 2, fwd: 1 },
  Gold: { gk: 0, def: 1, mid: 1, fwd: 1 }
};

const POSITION_KEY = { 1: 'gk', 2: 'def', 3: 'mid', 4: 'fwd' };
const POSITION_ELEMENT_TYPE = { gk: 1, def: 2, mid: 3, fwd: 4 };

function packPriceFor(config, rarity) {
  const defaults = { Bronze: 200, Silver: 400, Gold: 600 };
  const configKey = { Bronze: 'pack_price_bronze', Silver: 'pack_price_silver', Gold: 'pack_price_gold' }[rarity];
  return (config && config[configKey]) || defaults[rarity] || defaults.Bronze;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function getMaxCopiesAllowed(supabaseAdmin, tournamentId, config) {
  const { count } = await supabaseAdmin
    .schema('stockmarket').from('tournament_entries')
    .select('id', { count: 'exact', head: true })
    .eq('tournament_id', tournamentId);
  const divisor = (config && config.max_copies_divisor) || 4;
  return Math.max(1, Math.floor((count || 0) / divisor));
}

const FPL_PHOTO_URL = 'https://resources.premierleague.com/premierleague/photos/players/250x250/p';

async function fetchRarityPool(masterDb, rarity, positionKey) {
  const threshold = RARITY_THRESHOLDS[rarity];
  const elementType = POSITION_ELEMENT_TYPE[positionKey];
  const { data, error } = await masterDb
    .from('players')
    .select('id, web_name, element_type, team, total_points, now_cost, photo')
    .eq('element_type', elementType)
    .gte('total_points', threshold.min)
    .lte('total_points', threshold.max)
    .order('total_points', { ascending: false })
    .limit(200);
  if (error) { console.error('fetchRarityPool error:', error); return []; }
  return data || [];
}

function candidateCard(p, teamNameById, rarity, position) {
  return {
    id: p.id,
    name: p.web_name,
    team: teamNameById[p.team] || '',
    total_points: p.total_points,
    cost: p.now_cost ? (p.now_cost / 10).toFixed(1) : null,
    photo: p.photo ? `${FPL_PHOTO_URL}${p.photo.replace('.jpg', '')}.png` : null,
    rarity,
    position
  };
}

async function buildCandidatePool(supabaseAdmin, masterDb, tournamentId, config, opts) {
  const maxCopies = await getMaxCopiesAllowed(supabaseAdmin, tournamentId, config);

  const { data: marketRows } = await supabaseAdmin
    .schema('stockmarket').from('player_market')
    .select('player_id, ownership_count')
    .eq('tournament_id', tournamentId);
  const cappedIds = new Set((marketRows || []).filter(m => m.ownership_count >= maxCopies).map(m => m.player_id));

  const { data: teamRows } = await masterDb.from('teams').select('id, name');
  const teamNameById = {};
  (teamRows || []).forEach(t => { teamNameById[t.id] = t.name; });

  if (opts.mode === 'starter') {
    const picked = [];
    for (const rarity of ['Bronze', 'Silver', 'Gold']) {
      const matrix = STARTER_PACK_MATRIX[rarity];
      for (const pos of ['gk', 'def', 'mid', 'fwd']) {
        const needed = matrix[pos] || 0;
        if (needed === 0) continue;
        const pool = await fetchRarityPool(masterDb, rarity, pos);
        const eligible = pool.filter(p => !cappedIds.has(p.id));
        const chosen = shuffleArray(eligible).slice(0, needed);
        chosen.forEach(p => picked.push(candidateCard(p, teamNameById, rarity, pos)));
      }
    }
    return picked;
  }

  // Transfer pack: targeted position, single rarity tier, offer 6 candidates
  const pool = await fetchRarityPool(masterDb, opts.packType, opts.position);
  const eligible = pool.filter(p => !cappedIds.has(p.id));
  const chosen = shuffleArray(eligible).slice(0, 6);
  return chosen.map(p => candidateCard(p, teamNameById, opts.packType, opts.position));
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
      .select('id, end_gameweek, entry_fee, gameweek')
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

    // Snapshot pre-redistribution shares, so benched players (frozen this
    // week) can have their bonus_value adjusted to exactly cancel out
    // whatever the shared stock moves by — private to them, doesn't touch
    // what other owners of the same player see.
    const oldShareByPid = {};
    marketRows.forEach(p => {
      oldShareByPid[String(p.player_id)] = p.ownership_count > 0 ? Math.round((p.current_value || 0) / p.ownership_count) : 0;
    });

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

    // The master database is the single source of truth for every
    // gameweek's stats. First read of any gameweek pulls from FPL's live
    // feed (real data, works for any gameweek that's actually been
    // played — including past ones, useful for testing by rewinding the
    // master clock) and caches it locally. Every read after that comes
    // from the local table only — real season data and admin-synced
    // historical data live in exactly the same place.
    let liveElements = [];
    try {
      const { data: cachedStats } = await masterDb
        .from('player_gameweek_stats')
        .select('*')
        .eq('gameweek', gameweek);

      if (cachedStats && cachedStats.length > 0) {
        liveElements = cachedStats.map(s => ({
          id: s.player_id,
          stats: {
            goals_scored: s.goals_scored, assists: s.assists,
            yellow_cards: s.yellow_cards, red_cards: s.red_cards,
            clean_sheets: s.clean_sheets, goals_conceded: s.goals_conceded,
            saves: s.saves, minutes: s.minutes
          }
        }));
        console.log(`Stock Market GW${gameweek}: read ${liveElements.length} stat rows from the local master cache`);
      } else {
        const liveRes = await fetch(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`);
        if (liveRes.ok) {
          const liveData = await liveRes.json();
          liveElements = liveData.elements || [];

          if (liveElements.length > 0) {
            const cacheRows = liveElements.map(el => ({
              gameweek, player_id: el.id,
              goals_scored: el.stats?.goals_scored || 0,
              assists: el.stats?.assists || 0,
              yellow_cards: el.stats?.yellow_cards || 0,
              red_cards: el.stats?.red_cards || 0,
              clean_sheets: el.stats?.clean_sheets || 0,
              goals_conceded: el.stats?.goals_conceded || 0,
              saves: el.stats?.saves || 0,
              minutes: el.stats?.minutes || 0
            }));
            const CHUNK = 200;
            for (let i = 0; i < cacheRows.length; i += CHUNK) {
              await masterDb.from('player_gameweek_stats').upsert(cacheRows.slice(i, i + CHUNK), { onConflict: 'gameweek,player_id' });
            }
            console.log(`Stock Market GW${gameweek}: cached ${cacheRows.length} real FPL stat rows into the local master table`);
          }
        }
      }
    } catch (fetchErr) {
      console.error('Failed to fetch gameweek stats:', fetchErr);
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

    // Benching freeze (kept): a benched player's contribution to the
    // owner's value is cancelled out privately each week — the shared
    // stock still moves normally for anyone else holding them actively.
    const { data: entriesForClock } = await supabaseAdmin
      .schema('stockmarket').from('tournament_entries')
      .select('*')
      .eq('tournament_id', tournamentId)
      .eq('squad_locked', true);

    const { data: clockConfig } = await supabaseAdmin
      .schema('stockmarket').from('config')
      .select('*').eq('tournament_id', tournamentId).maybeSingle();
    const clockSlotValue = (clockConfig && clockConfig.slot_value) || 0;

    for (const entry of (entriesForClock || [])) {
      const squad = entry.squad_players || [];
      let changed = false;

      for (const slot of squad) {
        if (!slot || slot.empty || !slot.is_sub) continue;
        const p = prices[String(slot.player_id)];
        if (!p) continue;
        const newShare = p.ownership_count > 0 ? Math.round((p.current_value || 0) / p.ownership_count) : 0;
        const oldShare = oldShareByPid[String(slot.player_id)] || 0;
        const delta = newShare - oldShare;
        if (delta !== 0) {
          slot.bonus_value = (slot.bonus_value || 0) - delta;
          changed = true;
        }
      }

      // Mandatory 1 sell per gameweek: if this entry didn't make a manual
      // sell this gameweek AND doesn't already have an empty slot waiting
      // to be filled, the system picks a random active (non-benched)
      // player, sells them, and immediately buys a random Bronze-tier
      // replacement in the same position — so nobody ever starts a
      // gameweek's matches with a gap in their squad. Doesn't apply on
      // the tournament's very first processed gameweek — the market's
      // only just gone live, nobody's had a real chance to transfer yet.
      const isFirstProcessedWeek = gameweek === claimed.gameweek;
      const alreadySoldThisGw = entry.last_transfer_gameweek === gameweek;
      const hasEmptySlot = squad.some(s => s.empty);

      if (!isFirstProcessedWeek && !alreadySoldThisGw && !hasEmptySlot) {
        const activeIdxs = squad
          .map((s, i) => ({ s, i }))
          .filter(({ s }) => s && !s.empty && !s.is_sub)
          .map(({ i }) => i);

        if (activeIdxs.length > 0) {
          const sellIdx = activeIdxs[Math.floor(Math.random() * activeIdxs.length)];
          const soldSlot = squad[sellIdx];
          const p = prices[String(soldSlot.player_id)];

          if (p) {
            const ownership = p.ownership_count || 1;
            const sharedShare = Math.round((p.current_value || 0) / ownership);
            const yourValue = sharedShare + (soldSlot.bonus_value || 0);
            const reseed = Math.min(yourValue, clockSlotValue);

            const newOwnership = Math.max(0, ownership - 1);
            const newMarketValue = newOwnership > 0
              ? Math.round((p.current_value || 0) * (newOwnership / ownership))
              : 0;
            await supabaseAdmin.schema('stockmarket').from('player_market')
              .update({ ownership_count: newOwnership, current_value: newMarketValue })
              .eq('tournament_id', tournamentId).eq('player_id', soldSlot.player_id);
            p.ownership_count = newOwnership;
            p.current_value = newMarketValue;

            const remainder = yourValue - reseed;
            const others = squad.filter((s, j) => j !== sellIdx && !s.empty && !s.is_sub);
            if (others.length > 0 && remainder > 0) {
              const share = Math.floor(remainder / others.length);
              others.forEach(o => { o.bonus_value = (o.bonus_value || 0) + share; });
            }

            const positionKey = POSITION_KEY[soldSlot.position] || soldSlot.position;
            const soldInfo = { player_id: soldSlot.player_id, name: soldSlot.name, team: soldSlot.team, position: positionKey, value: yourValue };

            // Immediately auto-buy a random Bronze-tier replacement in the
            // same position, funded from the reserve + shortfall, exactly
            // like a manual buy.
            const bronzePool = await buildCandidatePool(supabaseAdmin, masterDb, tournamentId, clockConfig || {}, { mode: 'transfer', packType: 'Bronze', position: positionKey });
            const ownedIds = new Set(squad.filter(s => !s.empty).map(s => s.player_id));
            const eligible = bronzePool.filter(c => !ownedIds.has(c.id));

            if (eligible.length > 0) {
              const chosen = eligible[Math.floor(Math.random() * eligible.length)];
              const bronzeFee = packPriceFor(clockConfig, 'Bronze');
              const shortfall = Math.max(0, bronzeFee - reseed);
              const finalOthers = squad.filter((s, j) => j !== sellIdx && !s.empty && !s.is_sub);
              if (shortfall > 0 && finalOthers.length > 0) {
                const share = Math.ceil(shortfall / finalOthers.length);
                finalOthers.forEach(o => { o.bonus_value = Math.max(0, (o.bonus_value || 0) - share); });
              }

              squad[sellIdx] = {
                player_id: chosen.id, position: positionKey, name: chosen.name, team: chosen.team,
                bonus_value: Math.max(0, reseed - bronzeFee),
                acquired_gameweek: gameweek, is_sub: false
              };

              const { data: existingMarket } = await supabaseAdmin
                .schema('stockmarket').from('player_market')
                .select('*').eq('tournament_id', tournamentId).eq('player_id', chosen.id).maybeSingle();
              if (existingMarket) {
                await supabaseAdmin.schema('stockmarket').from('player_market')
                  .update({ ownership_count: (existingMarket.ownership_count || 0) + 1 })
                  .eq('id', existingMarket.id);
              } else {
                await supabaseAdmin.schema('stockmarket').from('player_market').insert({
                  tournament_id: tournamentId, player_id: chosen.id, name: chosen.name,
                  position: { gk: 'Goalkeeper', def: 'Defender', mid: 'Midfielder', fwd: 'Forward' }[positionKey] || '',
                  team: chosen.team, ownership_count: 1, current_value: 0, last_week_value: 0
                });
              }

              // Spread the auto-buy fee across every OTHER entrant, same as a manual buy.
              const { data: otherEntries } = await supabaseAdmin
                .schema('stockmarket').from('tournament_entries')
                .select('id, squad_players').eq('tournament_id', tournamentId).neq('id', entry.id).eq('squad_locked', true);
              if (otherEntries && otherEntries.length > 0 && bronzeFee > 0) {
                const perEntryShare = Math.floor(bronzeFee / otherEntries.length);
                for (const other of otherEntries) {
                  const otherSquad = other.squad_players || [];
                  const nonEmpty = otherSquad.filter(s => !s.empty);
                  if (nonEmpty.length === 0) continue;
                  const perPlayerShare = Math.floor(perEntryShare / nonEmpty.length);
                  nonEmpty.forEach(s => { s.bonus_value = (s.bonus_value || 0) + perPlayerShare; });
                  await supabaseAdmin.schema('stockmarket').from('tournament_entries')
                    .update({ squad_players: otherSquad }).eq('id', other.id);
                }
              }

              entry.pending_auto_notice = {
                gameweek, sold: soldInfo,
                bought: { player_id: chosen.id, name: chosen.name, team: chosen.team, position: positionKey, photo: chosen.photo, rarity: 'Bronze', fee: bronzeFee }
              };
            } else {
              // No eligible Bronze replacement — leave the slot empty rather
              // than fail silently; the usual empty-slot notification covers it.
              squad[sellIdx] = { empty: true, position: positionKey, reserved_value: reseed };
              entry.pending_auto_notice = { gameweek, sold: soldInfo, bought: null };
            }

            changed = true;
          }
        }
      }

      if (changed) {
        await supabaseAdmin.schema('stockmarket').from('tournament_entries')
          .update({ squad_players: squad, pending_auto_notice: entry.pending_auto_notice || null }).eq('id', entry.id);
      }
    }

    // Recalculate every entrant's portfolio from the final prices
    const { data: entries } = await supabaseAdmin
      .schema('stockmarket').from('tournament_entries')
      .select('id, current_value, squad_players')
      .eq('tournament_id', tournamentId);

    let actualTotal = 0;

    for (const entry of (entries || [])) {
      const squad = entry.squad_players || [];
      const newValue = Math.round(squad.reduce((sum, sp) => {
        if (sp.empty) return sum + (sp.reserved_value || 0);
        const p = prices[String(sp.player_id)];
        const sharePart = p ? (p.current_value || 0) / (p.ownership_count || 1) : 0;
        return sum + sharePart + (sp.bonus_value || 0);
      }, 0));

      actualTotal += newValue;

      await supabaseAdmin.schema('stockmarket').from('tournament_entries')
        .update({ last_week_value: entry.current_value, current_value: newValue })
        .eq('id', entry.id);
    }

    // Zero-sum audit: log every gameweek's actual total against what the
    // pot should be. This is the whole system's core promise — the total
    // must never grow or shrink, only move between players. Any drift
    // here means value is leaking somewhere in the redistribution math.
    try {
      const expectedPot = (claimed.entry_fee || 0) * (entries || []).length;
      await supabaseAdmin.schema('stockmarket').from('audit_log').insert({
        tournament_id: tournamentId, gameweek, expected_pot: expectedPot,
        actual_total: actualTotal, drift: actualTotal - expectedPot
      });
    } catch (auditErr) {
      console.error('audit_log insert failed:', auditErr);
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

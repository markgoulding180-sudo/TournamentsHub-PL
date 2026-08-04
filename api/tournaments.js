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

// Every table each tournament type actually uses — pulled directly from
// every place in the codebase that touches these schemas, not guessed.
// Shared by the data-count inspector (GET) and the delete action (POST),
// so they can never drift out of sync with each other.
const TOURNAMENT_SCHEMA_TABLES = {
  predictions: ['gameweek_summary', 'prediction_history', 'predictions', 'tournament_entries', 'tournaments'],
  lms: ['picks', 'tournament_entries', 'tournaments'],
  fantasy: ['tournament_entries', 'tournaments'],
  stockmarket: ['audit_log', 'config', 'matchups', 'player_gw_history', 'player_market', 'tournament_entries', 'tournament_stages', 'tournaments', 'transactions']
};

// Almost every table uses 'id' as its primary key — these are the
// exceptions, confirmed against the real database schema rather than
// assumed.
const TOURNAMENT_TABLE_PK_OVERRIDES = {
  'stockmarket.config': 'tournament_id'
};

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  // Every response here needs to reflect current data — leaderboards,
  // live values, lock states. No caching header was ever set, so browsers
  // and Vercel's edge fell back to their own default heuristics, which
  // could serve a stale response (confirmed: a full data wipe still
  // showed the old leaderboard until a hard refresh forced a real fetch).
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Vercel serverless functions get reused across requests ("warm
  // starts") for performance — confirmed via logs that this let a stale
  // response for an identical query get served on a later request within
  // the same warm instance (LMS's finished-match count stuck at 3 long
  // after all 10 were genuinely finished in the database, causing
  // eliminations to be computed from outdated data). Forcing every
  // Supabase REST call through a fetch that explicitly disables caching
  // closes this off at the source, for every client and every query.
  const noCacheFetch = (url, options = {}) => fetch(url, { ...options, cache: 'no-store' });

  // Create clients - admin client for auth verification, regular for data
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY,
    { global: { fetch: noCacheFetch } }
  );
  
  const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET,
    { global: { fetch: noCacheFetch } }
  );

  // Master project: players — used for Fantasy Manager squad validation/scoring
  const masterDb = createClient(
    process.env.MASTER_SUPABASE_URL,
    process.env.MASTER_SUPABASE_SERVICE_KEY,
    { global: { fetch: noCacheFetch } }
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
      // Your current gameweek matchup: your squad, your opponent's squad,
      // and — for any of your players also owned by other entrants —
      // the best value that same real player is achieving elsewhere.
      // Full gameweek-by-gameweek history for a user's entry — every
      // player's breakdown for every processed week, plus who they
      // played and the result, for full week-by-week verification.
      // Leaderboard — every entrant in the tournament, ranked by current
      // portfolio value.
      const stockmarketLeaderboard = params.get('stockmarket_leaderboard');
      if (stockmarketLeaderboard === 'true' && tournamentId) {
        const { data: allEntries } = await supabaseAdmin
          .schema('stockmarket').from('tournament_entries')
          .select('id, user_id, squad_players, current_value, start_value, relegated, relegated_at_gameweek')
          .eq('tournament_id', tournamentId).eq('squad_locked', true);

        // current_value only gets written at final settlement (once the
        // whole gameweek finishes) — mid-gameweek it's still last week's
        // frozen number. Confirmed as a real bug: the leaderboard showed
        // everyone flat at their starting value the entire time matches
        // were actually playing, even though the individual squad page
        // was correctly live the whole time. Computing a live value per
        // entry from their own matchup — same mechanism the individual
        // page already uses — fixes this for everyone at once instead of
        // just whoever happens to be looking at their own squad.
        const { data: clockRow } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
        const currentGw = clockRow ? clockRow.current_gameweek : null;

        const liveValueByEntryId = {};
        if (currentGw) {
          const { data: gwMatchStatus } = await masterDb
            .from('matches').select('home_team, away_team, status').eq('gameweek', currentGw);
          const allFinished = gwMatchStatus && gwMatchStatus.length > 0 && gwMatchStatus.every(m => m.status === 'finished');

          if (!allFinished) {
            const { data: matchupsForGw } = await supabaseAdmin
              .schema('stockmarket').from('matchups')
              .select('entry_id_1, entry_id_2, settled')
              .eq('tournament_id', tournamentId).eq('gameweek', currentGw);

            const startedTeams = new Set();
            (gwMatchStatus || []).forEach(m => {
              if (m.status === 'live' || m.status === 'finished') { startedTeams.add(m.home_team); startedTeams.add(m.away_team); }
            });

            const allPlayerIds = [...new Set((allEntries || []).flatMap(e => (e.squad_players || []).filter(s => !s.empty).map(s => s.player_id)))];
            const { data: statRows } = allPlayerIds.length > 0
              ? await masterDb.from('player_gameweek_stats').select('*').eq('gameweek', currentGw).in('player_id', allPlayerIds)
              : { data: [] };
            const statsByPid = {};
            (statRows || []).forEach(s => { if (startedTeams.has(s.team)) statsByPid[s.player_id] = s; });

            const concededByTeam = await getTeamGoalsConcededMap(masterDb, currentGw);

            const { data: tForMult } = await supabaseAdmin
              .schema('stockmarket').from('tournaments').select('cost_multiplier').eq('id', tournamentId).maybeSingle();
            const costMultiplier = (tForMult && tForMult.cost_multiplier) || 1;

            const entryById = {};
            (allEntries || []).forEach(e => { entryById[e.id] = e; });

            for (const m of (matchupsForGw || [])) {
              if (m.settled) continue; // already final — current_value is already correct for these
              const e1 = entryById[m.entry_id_1];
              const e2 = m.entry_id_2 ? entryById[m.entry_id_2] : null;
              if (!e1) continue;
              try {
                if (e2) {
                  const { provA, provB } = computeUnifiedSettlement(e1.squad_players || [], e2.squad_players || [], statsByPid, concededByTeam, costMultiplier);
                  liveValueByEntryId[e1.id] = Math.round(provA.reduce((s, p) => s + p.liveValue, 0));
                  liveValueByEntryId[e2.id] = Math.round(provB.reduce((s, p) => s + p.liveValue, 0));
                } else {
                  // Bye — nobody to redistribute with, just their own raw live total
                  const provA = prepSquadForSettlement(e1.squad_players || [], statsByPid, concededByTeam, costMultiplier);
                  liveValueByEntryId[e1.id] = Math.round(provA.reduce((s, p) => s + p.liveValue, 0));
                }
              } catch (matchupCalcErr) {
                console.error(`Leaderboard live calc failed for matchup ${m.entry_id_1}/${m.entry_id_2}:`, matchupCalcErr);
              }
            }
          }
        }

        const liveValue = (e) => liveValueByEntryId[e.id] !== undefined ? liveValueByEntryId[e.id] : (e.current_value || 0);

        const userIds = (allEntries || []).map(e => e.user_id);
        const { data: users } = userIds.length > 0
          ? await supabaseAdmin.from('users').select('id, username, display_name').in('id', userIds)
          : { data: [] };
        const nameByUserId = {};
        (users || []).forEach(u => { nameByUserId[u.id] = pickDisplayName(u); });

        // Next unapplied stage tells us how many of the currently-active
        // bottom entries are in the relegation zone right now.
        const { data: nextStage } = await supabaseAdmin
          .schema('stockmarket').from('tournament_stages')
          .select('stage_number, trigger_gameweek, relegate_count')
          .eq('tournament_id', tournamentId).eq('applied', false)
          .order('stage_number', { ascending: true }).limit(1).maybeSingle();

        // Sort by live value now, not the stale persisted column.
        const sortedEntries = [...(allEntries || [])].sort((a, b) => liveValue(b) - liveValue(a));

        // allEntries is sorted current_value descending, so the last
        // `zoneSize` entries in the active-only subset are the lowest
        // active values — exactly who'd be cut if the next stage ran now.
        const activeIdsInOrder = sortedEntries.filter(e => !e.relegated).map(e => e.id);
        const zoneSize = nextStage ? Math.min(nextStage.relegate_count || 0, activeIdsInOrder.length) : 0;
        const zoneIds = new Set(zoneSize > 0 ? activeIdsInOrder.slice(activeIdsInOrder.length - zoneSize) : []);

        // Active entries get their own clean 1..N ranking — relegated
        // players are pulled out entirely rather than interleaved, since
        // their frozen value no longer means the same thing as an active
        // player's still-moving value.
        const activeEntries = sortedEntries.filter(e => !e.relegated);
        const relegatedEntries = sortedEntries.filter(e => e.relegated)
          .sort((a, b) => (b.relegated_at_gameweek || 0) - (a.relegated_at_gameweek || 0) || liveValue(b) - liveValue(a));

        const leaderboard = activeEntries.map((e, i) => ({
          rank: i + 1,
          entry_id: e.id,
          player_name: nameByUserId[e.user_id] || 'Player',
          current_value: liveValue(e),
          gain_loss: liveValue(e) - (e.start_value || 0),
          in_relegation_zone: zoneIds.has(e.id)
        }));

        const relegated = relegatedEntries.map(e => ({
          entry_id: e.id,
          player_name: nameByUserId[e.user_id] || 'Player',
          current_value: liveValue(e),
          gain_loss: liveValue(e) - (e.start_value || 0),
          relegated_at_gameweek: e.relegated_at_gameweek || null
        }));

        return res.status(200).json({
          leaderboard,
          relegated,
          next_stage: nextStage ? { stage_number: nextStage.stage_number, trigger_gameweek: nextStage.trigger_gameweek, relegate_count: nextStage.relegate_count } : null
        });
      }

      // Final results for a FINISHED tournament — separate from the live
      // leaderboard above since it reads the locked final_value snapshot,
      // not current_value. Survivors and relegated entries both included,
      // survivors ranked by final value, relegated grouped by which stage
      // they went out in.
      const stockmarketResults = params.get('stockmarket_results');
      if (stockmarketResults === 'true' && tournamentId) {
        const { data: tourn } = await supabaseAdmin
          .schema('stockmarket').from('tournaments')
          .select('id, name, status, end_gameweek').eq('id', tournamentId).maybeSingle();
        if (!tourn) return res.status(404).json({ error: 'Tournament not found' });
        if (tourn.status !== 'finished') {
          return res.status(200).json({ finished: false });
        }

        const { data: allEntriesFinal } = await supabaseAdmin
          .schema('stockmarket').from('tournament_entries')
          .select('id, user_id, final_value, start_value, relegated, relegated_at_gameweek')
          .eq('tournament_id', tournamentId).eq('squad_locked', true);

        const userIdsFinal = (allEntriesFinal || []).map(e => e.user_id);
        const { data: usersFinal } = userIdsFinal.length > 0
          ? await supabaseAdmin.from('users').select('id, username, display_name').in('id', userIdsFinal)
          : { data: [] };
        const nameByUserIdFinal = {};
        (usersFinal || []).forEach(u => { nameByUserIdFinal[u.id] = pickDisplayName(u); });

        const survivorsFinal = (allEntriesFinal || [])
          .filter(e => !e.relegated)
          .sort((a, b) => (b.final_value || 0) - (a.final_value || 0))
          .map((e, i) => ({
            rank: i + 1,
            player_name: nameByUserIdFinal[e.user_id] || 'Player',
            final_value: e.final_value,
            gain_loss: (e.final_value || 0) - (e.start_value || 0)
          }));

        const relegatedFinal = (allEntriesFinal || [])
          .filter(e => e.relegated)
          .sort((a, b) => (b.relegated_at_gameweek || 0) - (a.relegated_at_gameweek || 0) || (b.final_value || 0) - (a.final_value || 0))
          .map(e => ({
            player_name: nameByUserIdFinal[e.user_id] || 'Player',
            final_value: e.final_value,
            gain_loss: (e.final_value || 0) - (e.start_value || 0),
            relegated_at_gameweek: e.relegated_at_gameweek || null
          }));

        return res.status(200).json({
          finished: true,
          tournament_name: tourn.name,
          end_gameweek: tourn.end_gameweek,
          survivors: survivorsFinal,
          relegated: relegatedFinal
        });
      }

      const stockmarketHistory = params.get('stockmarket_history');
      if (stockmarketHistory === 'true' && tournamentId) {
        const publicEntryId = params.get('entry_id');
        let myEntry = null;
        let viewedPlayerName = null;

        if (publicEntryId) {
          // Public per-player history view — clicking a name on the
          // leaderboard, no login required. Same underlying data anyone
          // can already see week-by-week via the live matchup/leaderboard
          // screens, just laid out for one specific entrant.
          const { data: viewedEntry } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, user_id, current_value, start_value, relegated, relegated_at_gameweek')
            .eq('id', publicEntryId).eq('tournament_id', tournamentId).maybeSingle();
          if (!viewedEntry) return res.status(200).json({ entry: null });
          myEntry = viewedEntry;
          const { data: viewedUser } = await supabaseAdmin.from('users').select('username, display_name').eq('id', viewedEntry.user_id).maybeSingle();
          viewedPlayerName = pickDisplayName(viewedUser);
        } else {
          const authHeader = req.headers.authorization;
          if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
          const token = authHeader.replace('Bearer ', '');
          const { data: { user } } = await supabaseAdmin.auth.getUser(token);
          if (!user) return res.status(401).json({ error: 'Invalid token' });

          const { data: ownEntry } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, current_value, start_value').eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
          if (!ownEntry) return res.status(200).json({ entry: null });
          myEntry = ownEntry;
        }

        const { data: historyRows } = await supabaseAdmin
          .schema('stockmarket').from('player_gw_history')
          .select('*').eq('entry_id', myEntry.id).order('gameweek', { ascending: true });

        const { data: matchupRows } = await supabaseAdmin
          .schema('stockmarket').from('matchups')
          .select('*').eq('tournament_id', tournamentId)
          .or(`entry_id_1.eq.${myEntry.id},entry_id_2.eq.${myEntry.id}`)
          .order('gameweek', { ascending: true });

        // Resolve opponent names for every matchup
        const opponentEntryIds = [...new Set((matchupRows || [])
          .map(m => m.entry_id_1 === myEntry.id ? m.entry_id_2 : m.entry_id_1)
          .filter(Boolean))];
        let opponentNameByEntryId = {};
        if (opponentEntryIds.length > 0) {
          const { data: oppEntries } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, user_id').in('id', opponentEntryIds);
          const oppUserIds = (oppEntries || []).map(e => e.user_id);
          const { data: oppUsers } = oppUserIds.length > 0
            ? await supabaseAdmin.from('users').select('id, username, display_name').in('id', oppUserIds)
            : { data: [] };
          const nameByUserId = {};
          (oppUsers || []).forEach(u => { nameByUserId[u.id] = pickDisplayName(u); });
          (oppEntries || []).forEach(e => { opponentNameByEntryId[e.id] = nameByUserId[e.user_id] || 'Player'; });
        }

        // Group everything by gameweek for easy display
        const byGameweek = {};
        (historyRows || []).forEach(row => {
          byGameweek[row.gameweek] = byGameweek[row.gameweek] || { gameweek: row.gameweek, players: [] };
          byGameweek[row.gameweek].players.push(row);
        });
        (matchupRows || []).forEach(m => {
          byGameweek[m.gameweek] = byGameweek[m.gameweek] || { gameweek: m.gameweek, players: [] };
          const oppEntryId = m.entry_id_1 === myEntry.id ? m.entry_id_2 : m.entry_id_1;
          byGameweek[m.gameweek].opponent_name = oppEntryId ? (opponentNameByEntryId[oppEntryId] || 'Unknown') : null;
          byGameweek[m.gameweek].bye = !oppEntryId;
          byGameweek[m.gameweek].settled = m.settled;
          byGameweek[m.gameweek].gap = m.gap;
          byGameweek[m.gameweek].won = m.settled ? (m.winner_entry_id === myEntry.id) : null;
        });

        const weeks = Object.values(byGameweek).sort((a, b) => a.gameweek - b.gameweek);
        return res.status(200).json({ entry: myEntry, weeks, player_name: viewedPlayerName });
      }

      const stockmarketMatchup = params.get('stockmarket_matchup');
      if (stockmarketMatchup === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user } } = await supabaseAdmin.auth.getUser(token);
        if (!user) return res.status(401).json({ error: 'Invalid token' });

        const { data: myEntry } = await supabaseAdmin
          .schema('stockmarket').from('tournament_entries')
          .select('*').eq('tournament_id', tournamentId).eq('user_id', user.id).maybeSingle();
        if (!myEntry) return res.status(200).json({ entry: null });

        const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
        const currentGw = clock ? clock.current_gameweek : null;

        const { data: matchup } = await supabaseAdmin
          .schema('stockmarket').from('matchups')
          .select('*').eq('tournament_id', tournamentId).eq('gameweek', currentGw)
          .or(`entry_id_1.eq.${myEntry.id},entry_id_2.eq.${myEntry.id}`)
          .maybeSingle();

        let opponentEntry = null;
        let opponentName = null;
        if (matchup) {
          const opponentId = matchup.entry_id_1 === myEntry.id ? matchup.entry_id_2 : matchup.entry_id_1;
          if (opponentId) {
            const { data: oppData } = await supabaseAdmin
              .schema('stockmarket').from('tournament_entries')
              .select('id, user_id, squad_players, current_value, last_week_value, start_value').eq('id', opponentId).maybeSingle();
            opponentEntry = oppData;
            if (opponentEntry) {
              const { data: oppUser } = await supabaseAdmin.from('users').select('username, display_name').eq('id', opponentEntry.user_id).maybeSingle();
              opponentName = pickDisplayName(oppUser);
            }
          }
        }

        const { data: tForMult } = await supabaseAdmin
          .schema('stockmarket').from('tournaments')
          .select('cost_multiplier').eq('id', tournamentId).maybeSingle();
        const costMultiplier = (tForMult && tForMult.cost_multiplier) || 1;

        // Player photos for both squads — same FPL resource pattern used
        // for the pre-lock draft preview.
        const myIds = (myEntry.squad_players || []).filter(s => !s.empty).map(s => s.player_id);
        const oppIds = opponentEntry ? (opponentEntry.squad_players || []).filter(s => !s.empty).map(s => s.player_id) : [];
        const photoIds = [...new Set([...myIds, ...oppIds])];
        const { data: photoRows } = photoIds.length > 0
          ? await masterDb.from('players').select('id, photo, custom_photo_url').in('id', photoIds)
          : { data: [] };
        const photoByPid = {};
        (photoRows || []).forEach(p => {
          photoByPid[p.id] = p.custom_photo_url || (p.photo ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${p.photo.replace('.jpg', '')}.png` : null);
        });
        const withPhotos = (squad) => (squad || []).map(s => s.empty ? s : { ...s, photo: photoByPid[s.player_id] || null });

        const mySquadWithComparison = withPhotos(myEntry.squad_players);
        if (opponentEntry) opponentEntry.squad_players = withPhotos(opponentEntry.squad_players);

        // If this week's matchup exists but hasn't been finally settled
        // yet, compute a LIVE, provisional view — every event funds
        // directly from the opponent, evenly, updating in real time as
        // stats come in — the exact same mechanic as the real final
        // settlement, just not yet persisted. Purely a display
        // computation until GW${currentGw} actually finishes.
        let liveMine = null, liveOpponent = null, liveDebug = null;
        if (matchup && opponentEntry && !matchup.settled) {
          try {
            const myPlayerIds = mySquadWithComparison.filter(s => !s.empty).map(s => s.player_id);
            const oppPlayerIds = (opponentEntry.squad_players || []).filter(s => !s.empty).map(s => s.player_id);
            const allIds = [...new Set([...myPlayerIds, ...oppPlayerIds])];
            const { data: statRows, error: statErr } = allIds.length > 0
              ? await masterDb.from('player_gameweek_stats').select('*').eq('gameweek', currentGw).in('player_id', allIds)
              : { data: [], error: null };

            // Only count stats for teams whose match has actually started
            // (live or finished). In production FPL only supplies stats
            // once games play, so this is automatic — but our test rig
            // pre-stages a whole gameweek's stats in advance, and without
            // this filter values would visibly move before "kickoff".
            const { data: gwMatchStatus } = await masterDb
              .from('matches').select('home_team, away_team, status').eq('gameweek', currentGw);
            const startedTeams = new Set();
            (gwMatchStatus || []).forEach(m => {
              if (m.status === 'live' || m.status === 'finished') { startedTeams.add(m.home_team); startedTeams.add(m.away_team); }
            });
            const statsByPid = {};
            (statRows || []).forEach(s => { if (startedTeams.has(s.team)) statsByPid[s.player_id] = s; });
            const concededByTeam = await getTeamGoalsConcededMap(masterDb, currentGw);

            const { provA, provB } = computeUnifiedSettlement(
              mySquadWithComparison, opponentEntry.squad_players || [], statsByPid, concededByTeam, costMultiplier
            );
            const mapOut = (p) => ({
              player_id: p.player_id, name: p.name, position: p.position, team: p.team, is_sub: p.is_sub,
              liveValue: p.liveValue, liveContribution: (p.received || 0) - (p.paid || 0),
              received: p.received || 0, paid: p.paid || 0,
              ownEventNet: (p.ownEventReceived || 0) - (p.ownEventPaid || 0),
              liveStats: p.gwStats, shortBy: p.shortBy || 0
            });
            liveMine = provA.map(mapOut);
            liveOpponent = provB.map(mapOut);
            liveDebug = {
              currentGw, allIdsCount: allIds.length, allIds,
              statErr: statErr ? statErr.message : null,
              statRowsFound: (statRows || []).length,
              matchedStatsForMyIds: myPlayerIds.map(id => ({ id, hasStats: !!statsByPid[id], stats: statsByPid[id] || null }))
            };
          } catch (liveErr) {
            console.error('computeUnifiedSettlement (live) failed:', liveErr);
            liveDebug = { error: liveErr.message, stack: liveErr.stack };
          }
        }

        return res.status(200).json({
          entry: { ...myEntry, squad_players: mySquadWithComparison },
          opponent: opponentEntry,
          matchup: matchup || null,
          live_debug: liveDebug,
          gameweek: currentGw,
          live: liveMine ? { mine: liveMine, opponent: liveOpponent } : null,
          opponent_name: opponentName,
          cost_multiplier: costMultiplier,
          relegated: !!myEntry.relegated
        });
      }

// Supabase caps any single select at 1000 rows by default — silently,
// with no error, no truncated flag, nothing. A full-tournament export
// (34 entrants x 6 players x 38 gameweeks) blows past that easily, so
// every query in the export path pages through with .range() until it
// genuinely runs out, rather than trusting whatever the first page returns.
async function fetchAllRows(queryFactory, pageSize = 1000) {
  let all = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

      // Full-tournament export for offline analysis — admin only. Every
      // entrant's per-gameweek player breakdown plus every logged
      // sell/buy transaction, each row tagged with which user it belongs
      // to. The frontend turns this into a two-sheet Excel file.
      // TEMPORARY DEBUG TOOL — DELETE BEFORE REAL LAUNCH. Dumps the exact
      // mid-settlement state for one matchup: every player's computed
      // event amounts (before settlement) and their final received/paid
      // (after settlement), so the real math can be checked precisely
      // instead of reverse-engineered from an export. Admin only.
      // The tournament's own `gameweek` column is set once at creation
      // and never updated again — actual progress is tracked entirely via
      // the shared master_clock. This gives the admin UI (and anywhere
      // else) the real current gameweek instead of that stale value.
      const stockmarketCurrentGameweek = params.get('stockmarket_current_gameweek');
      if (stockmarketCurrentGameweek === 'true') {
        const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
        return res.status(200).json({ current_gameweek: clock ? clock.current_gameweek : null });
      }

      // Real transfer deadline for the "Transfers open until..." banner —
      // the next gameweek's actual first kickoff, same source of truth
      // the sell/buy enforcement below checks against.
      const stockmarketTransferDeadline = params.get('stockmarket_transfer_deadline');
      if (stockmarketTransferDeadline === 'true') {
        const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
        const currentGW = clock ? clock.current_gameweek : null;
        if (!currentGW) return res.status(200).json({ open: true, deadline_epoch: null });

        const tdTournamentId = params.get('tournament_id');
        const windowCheck = tdTournamentId
          ? await isStockMarketTransferWindowOpen(masterDb, supabaseAdmin, tdTournamentId, currentGW)
          : { open: true, reason: null };

        // While open, the deadline shown is THIS gameweek's own kickoff
        // (the window closes the moment it starts) — not next gameweek's,
        // which was the old, incorrect framing.
        const { data: gwMatches } = await masterDb.from('matches').select('kickoff_time').eq('gameweek', currentGW);
        const earliestKickoffMs = (gwMatches || []).reduce((min, m) => {
          const t = new Date(m.kickoff_time).getTime();
          return (min === null || t < min) ? t : min;
        }, null);
        const deadlineEpoch = earliestKickoffMs !== null ? Math.floor(earliestKickoffMs / 1000) : null;

        // If a tournament_id is given and the caller is authenticated,
        // also check whether THIS user has already used their one
        // transfer for the current gameweek — the window being open
        // doesn't mean THEY can do anything more with it.
        let alreadyTransferred = false;
        if (tdTournamentId) {
          const authHeader = req.headers.authorization;
          if (authHeader) {
            const { data: { user: tdUser } } = await supabaseAdmin.auth.getUser(authHeader.replace('Bearer ', ''));
            if (tdUser) {
              const { data: tdEntry } = await supabaseAdmin
                .schema('stockmarket').from('tournament_entries')
                .select('last_transfer_gameweek').eq('tournament_id', tdTournamentId).eq('user_id', tdUser.id).maybeSingle();
              if (tdEntry && tdEntry.last_transfer_gameweek && tdEntry.last_transfer_gameweek >= currentGW) {
                alreadyTransferred = true;
              }
            }
          }
        }

        return res.status(200).json({
          current_gameweek: currentGW, next_gameweek: currentGW + 1,
          open: windowCheck.open, reason: windowCheck.reason,
          deadline_epoch: windowCheck.open ? deadlineEpoch : null,
          already_transferred: alreadyTransferred
        });
      }

      // Checks each player's actual photo URL against FPL's CDN (a real
      // network request, not just "does the DB have a code stored") and
      // records true/false on players.photo_verified. Paginated via
      // offset/batch_size — the admin UI calls this repeatedly until
      // `done` comes back true, since checking all ~840 players in one
      // request would risk hitting the serverless function's time limit.
      const verifyPlayerPhotos = params.get('verify_player_photos');
      if (verifyPlayerPhotos === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user: verifyUser }, error: verifyAuthError } = await supabaseAdmin.auth.getUser(token);
        if (verifyAuthError || !verifyUser) return res.status(401).json({ error: 'Invalid token' });
        const { data: verifyCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', verifyUser.id).maybeSingle();
        if (!verifyCaller || !verifyCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const offset = parseInt(params.get('offset') || '0', 10);
        const batchSize = Math.min(parseInt(params.get('batch_size') || '25', 10), 50);

        const { count: totalCount } = await masterDb.from('players').select('id', { count: 'exact', head: true });
        const { data: teamRows } = await masterDb.from('teams').select('id, name');
        const teamNameById = {};
        (teamRows || []).forEach(t => { teamNameById[t.id] = t.name; });

        const { data: batchPlayers, error: batchErr } = await masterDb
          .from('players').select('id, web_name, team, photo')
          .order('id', { ascending: true })
          .range(offset, offset + batchSize - 1);
        if (batchErr) return res.status(500).json({ error: 'Failed to load players', detail: batchErr.message });

        const results = [];
        for (const p of (batchPlayers || [])) {
          const teamName = teamNameById[p.team] || 'Unknown';
          if (!p.photo) {
            await masterDb.from('players').update({ photo_verified: false }).eq('id', p.id);
            results.push({ id: p.id, web_name: p.web_name, team: teamName, verified: false, reason: 'no photo code stored' });
            continue;
          }
          const url = `${FPL_PHOTO_URL}${p.photo.replace('.jpg', '')}.png`;
          let ok = false;
          try {
            const resp = await fetch(url);
            ok = resp.ok;
          } catch (e) {
            ok = false;
          }
          await masterDb.from('players').update({ photo_verified: ok }).eq('id', p.id);
          results.push({ id: p.id, web_name: p.web_name, team: teamName, verified: ok });
        }

        const nextOffset = offset + batchSize;
        const done = nextOffset >= (totalCount || 0);
        return res.status(200).json({
          processed: results.length,
          offset, next_offset: nextOffset, total: totalCount || 0, done,
          missing_this_batch: results.filter(r => !r.verified).map(r => ({ web_name: r.web_name, team: r.team })),
          results
        });
      }

      // Feeds the "Upload Player Photo" dropdown — everyone currently
      // confirmed missing a working photo (run Player Photo Verification
      // first if this looks stale/incomplete).
      const missingPhotoPlayers = params.get('missing_photo_players');
      if (missingPhotoPlayers === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user: mpUser }, error: mpAuthError } = await supabaseAdmin.auth.getUser(token);
        if (mpAuthError || !mpUser) return res.status(401).json({ error: 'Invalid token' });
        const { data: mpCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', mpUser.id).maybeSingle();
        if (!mpCaller || !mpCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: teamRows } = await masterDb.from('teams').select('id, name');
        const teamNameById = {};
        (teamRows || []).forEach(t => { teamNameById[t.id] = t.name; });

        const { data: missing } = await masterDb
          .from('players').select('id, web_name, team')
          .eq('photo_verified', false)
          .order('web_name', { ascending: true });

        return res.status(200).json({
          players: (missing || []).map(p => ({ id: p.id, web_name: p.web_name, team: teamNameById[p.team] || 'Unknown' }))
        });
      }

      // Shows any player IDs FPL has reassigned to a different real
      // player since we started watching — logged automatically by
      // sync-players every time it runs.
      const playerIdChanges = params.get('player_id_changes');
      if (playerIdChanges === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user: picUser }, error: picAuthError } = await supabaseAdmin.auth.getUser(token);
        if (picAuthError || !picUser) return res.status(401).json({ error: 'Invalid token' });
        const { data: picCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', picUser.id).maybeSingle();
        if (!picCaller || !picCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: changes, error: changesErr } = await masterDb
          .from('player_id_change_log').select('*').order('detected_at', { ascending: false }).limit(100);
        if (changesErr) return res.status(500).json({ error: changesErr.message });
        return res.status(200).json({ changes: changes || [] });
      }

      const stockmarketDebugSettlement = params.get('stockmarket_debug_settlement');
      if (stockmarketDebugSettlement === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user: debugUser }, error: debugAuthError } = await supabaseAdmin.auth.getUser(token);
        if (debugAuthError || !debugUser) return res.status(401).json({ error: 'Invalid token' });
        const { data: debugCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', debugUser.id).maybeSingle();
        if (!debugCaller || !debugCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const debugEntryId = params.get('entry_id');
        const debugGameweek = parseInt(params.get('gameweek'));
        if (!debugEntryId || !debugGameweek) return res.status(400).json({ error: 'entry_id and gameweek are required' });

        try {
          const { data: matchup } = await supabaseAdmin
            .schema('stockmarket').from('matchups')
            .select('*').eq('tournament_id', tournamentId).eq('gameweek', debugGameweek)
            .or(`entry_id_1.eq.${debugEntryId},entry_id_2.eq.${debugEntryId}`).maybeSingle();
          if (!matchup) return res.status(404).json({ error: 'No matchup found for that entry/gameweek' });

          const otherEntryId = matchup.entry_id_1 === debugEntryId ? matchup.entry_id_2 : matchup.entry_id_1;
          const { data: entryA } = await supabaseAdmin.schema('stockmarket').from('tournament_entries').select('*').eq('id', debugEntryId).maybeSingle();
          const { data: entryB } = await supabaseAdmin.schema('stockmarket').from('tournament_entries').select('*').eq('id', otherEntryId).maybeSingle();

          const { data: tRow } = await supabaseAdmin.schema('stockmarket').from('tournaments').select('cost_multiplier').eq('id', tournamentId).maybeSingle();
          const costMultiplier = (tRow && tRow.cost_multiplier) || 1;

          const allPlayerIds = [...new Set([...(entryA.squad_players||[]), ...(entryB.squad_players||[])].filter(s => !s.empty).map(s => s.player_id))];
          const { data: statRows } = allPlayerIds.length > 0
            ? await masterDb.from('player_gameweek_stats').select('*').eq('gameweek', debugGameweek).in('player_id', allPlayerIds)
            : { data: [] };
          const statsByPid = {};
          (statRows || []).forEach(s => { statsByPid[s.player_id] = s; });
          const concededByTeam = await getTeamGoalsConcededMap(masterDb, debugGameweek);

          // Use each player's ACTUAL starting value for this specific
          // gameweek (from the permanent per-gameweek record), not their
          // current value — current value reflects everything that's
          // happened SINCE this gameweek (later settlements, relegation
          // bonuses, transfers), which would make a historical replay
          // wildly wrong. This is what makes verifying a past gameweek
          // apples-to-apples with what was actually recorded.
          const { data: historicalRows } = await supabaseAdmin
            .schema('stockmarket').from('player_gw_history')
            .select('entry_id, player_id, starting_value')
            .in('entry_id', [debugEntryId, otherEntryId]).eq('gameweek', debugGameweek);
          const startingValueByEntryPid = {};
          (historicalRows || []).forEach(h => { startingValueByEntryPid[`${h.entry_id}:${h.player_id}`] = h.starting_value; });
          const applyHistoricalStart = (squad, eId) => (squad || []).map(s => {
            if (s.empty) return s;
            const key = `${eId}:${s.player_id}`;
            return startingValueByEntryPid[key] !== undefined ? { ...s, value: startingValueByEntryPid[key] } : s;
          });
          const squadAHistorical = applyHistoricalStart(entryA.squad_players, debugEntryId);
          const squadBHistorical = applyHistoricalStart(entryB.squad_players, otherEntryId);
          const missingHistory = squadAHistorical.some(s => !s.empty && startingValueByEntryPid[`${debugEntryId}:${s.player_id}`] === undefined)
            || squadBHistorical.some(s => !s.empty && startingValueByEntryPid[`${otherEntryId}:${s.player_id}`] === undefined);

          const provA = prepSquadForSettlement(squadAHistorical, statsByPid, concededByTeam, costMultiplier);
          const provB = prepSquadForSettlement(squadBHistorical, statsByPid, concededByTeam, costMultiplier);

          // Deep-clone the pre-settlement state (events + starting
          // liveValue) before settleUnified mutates provA/provB in place.
          const before = {
            entry_a: provA.map(p => ({ name: p.name, position: p.position, liveValue: p.liveValue, events: p.events })),
            entry_b: provB.map(p => ({ name: p.name, position: p.position, liveValue: p.liveValue, events: p.events }))
          };

          settleUnified(provA, provB);

          const after = {
            entry_a: provA.map(p => ({ name: p.name, liveValue: p.liveValue, received: p.received || 0, paid: p.paid || 0, shortBy: p.shortBy || 0 })),
            entry_b: provB.map(p => ({ name: p.name, liveValue: p.liveValue, received: p.received || 0, paid: p.paid || 0, shortBy: p.shortBy || 0 }))
          };

          return res.status(200).json({
            tournament_id: tournamentId, gameweek: debugGameweek, cost_multiplier: costMultiplier,
            entry_a_id: debugEntryId, entry_b_id: otherEntryId,
            starting_capacity_a: before.entry_a.reduce((s, p) => s + p.liveValue, 0),
            starting_capacity_b: before.entry_b.reduce((s, p) => s + p.liveValue, 0),
            used_historical_starting_values: !missingHistory,
            warning: missingHistory ? 'Some players had no historical starting_value record for this gameweek — their CURRENT value was used instead, which may not match what actually happened.' : null,
            before, after
          });
        } catch (err) {
          console.error('stockmarket_debug_settlement error:', err);
          return res.status(500).json({ error: err.message });
        }
      }


      const stockmarketFullExport = params.get('stockmarket_full_export');
      if (stockmarketFullExport === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user: exportUser }, error: exportAuthError } = await supabaseAdmin.auth.getUser(token);
        if (exportAuthError || !exportUser) return res.status(401).json({ error: 'Invalid token' });

        const { data: exportCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', exportUser.id).maybeSingle();
        if (!exportCaller || !exportCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        try {
          const { data: allTournamentEntries } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, user_id, relegated, relegated_at_gameweek').eq('tournament_id', tournamentId);

          const entryIds = (allTournamentEntries || []).map(e => e.id);
          const userIds = (allTournamentEntries || []).map(e => e.user_id);
          const { data: exportUsers } = userIds.length > 0
            ? await supabaseAdmin.from('users').select('id, email').in('id', userIds)
            : { data: [] };
          const exportEmailByUserId = {};
          (exportUsers || []).forEach(u => { exportEmailByUserId[u.id] = u.email; });

          const entryMeta = {};
          (allTournamentEntries || []).forEach(e => {
            entryMeta[e.id] = { email: exportEmailByUserId[e.user_id] || 'Unknown', relegated: !!e.relegated, relegated_at_gameweek: e.relegated_at_gameweek || null };
          });

          const allHistoryRows = entryIds.length > 0
            ? await fetchAllRows(() => supabaseAdmin.schema('stockmarket').from('player_gw_history').select('*').in('entry_id', entryIds).order('gameweek', { ascending: true }).order('id', { ascending: true }))
            : [];

          const players = (allHistoryRows || []).map(row => ({
            user_email: entryMeta[row.entry_id]?.email || 'Unknown',
            relegated: entryMeta[row.entry_id]?.relegated || false,
            relegated_at_gameweek: entryMeta[row.entry_id]?.relegated_at_gameweek || null,
            ...row
          }));

          let transactions = [];
          let transactionsError = null;
          try {
            const allTransactions = await fetchAllRows(() =>
              supabaseAdmin.schema('stockmarket').from('transactions').select('*').eq('tournament_id', tournamentId).order('gameweek', { ascending: true }).order('id', { ascending: true })
            );
            transactions = (allTransactions || []).map(row => ({
              user_email: entryMeta[row.entry_id]?.email || 'Unknown',
              ...row
            }));
          } catch (txErr) {
            // Most likely cause: the stockmarket.transactions table hasn't
            // been created yet (migration 005 not run). Don't fail the
            // whole export over it — the player history half is still
            // valuable — just flag it clearly instead.
            console.error('Transactions fetch failed in full export:', txErr);
            transactionsError = `Couldn't load transactions — has migration 005_transactions_log.sql been run in TB-PL? (${txErr.message})`;
          }

          return res.status(200).json({ players, transactions, transactions_error: transactionsError });
        } catch (err) {
          console.error('stockmarket_full_export error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Returns all 8 stage slots for the admin "Relegation Stages" panel —
      // any slot not yet configured comes back as a blank template
      // (relegate_count 0, cost_multiplier 1) rather than being omitted,
      // so the admin UI always has exactly 8 rows to render.
      const stockmarketStages = params.get('stockmarket_stages');
      if (stockmarketStages === 'true' && tournamentId) {
        const { data: existingStages } = await supabaseAdmin
          .schema('stockmarket').from('tournament_stages')
          .select('*').eq('tournament_id', tournamentId).order('stage_number', { ascending: true });

        const byNumber = {};
        (existingStages || []).forEach(s => { byNumber[s.stage_number] = s; });

        const stages = [];
        for (let n = 1; n <= 8; n++) {
          if (byNumber[n]) {
            stages.push(byNumber[n]);
          } else {
            stages.push({
              tournament_id: tournamentId, stage_number: n,
              trigger_gameweek: null, relegate_count: 0, cost_multiplier: 1, applied: false
            });
          }
        }
        return res.status(200).json({ stages });
      }

      const stockmarketLockStatus = params.get('stockmarket_lock_status');
      if (stockmarketLockStatus === 'true' && tournamentId) {
        const status = await getStockMarketLockStatus(masterDb, supabaseAdmin, tournamentId);
        return res.status(200).json(status);
      }

      // Live pot reconciliation — admin only. The old audit_log table was
      // written only by the legacy shared-market settlement path and is
      // never touched by the current head-to-head engine, so it always
      // reads empty/stale. This instead checks the real invariant for the
      // current model directly, on demand: every relegation stage moves a
      // relegated entry's ENTIRE value into the survivors, 1-for-1, so the
      // sum of every still-active entry's current_value should always
      // equal (entry_fee x total entries that ever locked a squad),
      // regardless of how many relegation stages have fired. Relegated
      // entries' displayed values are a frozen historical record only —
      // that money already left the live pot the moment they were cut, so
      // it's reported separately rather than added back into the total.
      const stockmarketAudit = params.get('stockmarket_audit');
      if (stockmarketAudit === 'true' && tournamentId) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: tournamentRow, error: tErr } = await supabaseAdmin
          .schema('stockmarket').from('tournaments')
          .select('entry_fee, cost_multiplier').eq('id', tournamentId).maybeSingle();
        if (tErr || !tournamentRow) return res.status(404).json({ error: 'Tournament not found' });

        const { data: allEntries, error: eErr } = await supabaseAdmin
          .schema('stockmarket').from('tournament_entries')
          .select('current_value, relegated').eq('tournament_id', tournamentId).eq('squad_locked', true);
        if (eErr) return res.status(500).json({ error: 'Failed to fetch entries', details: eErr.message });

        const totalEntries = (allEntries || []).length;
        const activeEntries = (allEntries || []).filter(e => !e.relegated);
        const relegatedEntries = (allEntries || []).filter(e => e.relegated);

        const expectedPot = (tournamentRow.entry_fee || 0) * totalEntries;
        const actualActiveTotal = activeEntries.reduce((s, e) => s + Math.round(e.current_value || 0), 0);
        const relegatedFrozenTotal = relegatedEntries.reduce((s, e) => s + Math.round(e.current_value || 0), 0);
        const drift = actualActiveTotal - expectedPot;

        // Deep check: replay every settled matchup, every gameweek, using
        // TODAY's live reward values, and compare every player's real
        // recorded Won/Paid against what their actual recorded actions
        // should produce. Only meaningful for gameweeks settled entirely
        // under the current reward values — if FLAT_REWARDS gets tuned
        // again later, older gameweeks would need re-checking against
        // whatever was live when they actually settled.
        const { data: settledMatchups } = await supabaseAdmin
          .schema('stockmarket').from('matchups')
          .select('gameweek, entry_id_1, entry_id_2').eq('tournament_id', tournamentId).eq('settled', true);

        const { data: stageRows } = await supabaseAdmin
          .schema('stockmarket').from('tournament_stages')
          .select('trigger_gameweek, cost_multiplier').eq('tournament_id', tournamentId).eq('applied', true)
          .order('stage_number', { ascending: true });
        const multiplierAtGameweek = (gw) => {
          let m = 1;
          (stageRows || []).forEach(s => { if (s.trigger_gameweek <= gw) m = s.cost_multiplier; });
          return m;
        };

        const allHistoryForAudit = await fetchAllRows(() =>
          supabaseAdmin.schema('stockmarket').from('player_gw_history').select('*').eq('tournament_id', tournamentId)
        );
        const historyByEntryGw = {};
        (allHistoryForAudit || []).forEach(r => {
          const key = `${r.entry_id}:${r.gameweek}`;
          if (!historyByEntryGw[key]) historyByEntryGw[key] = [];
          historyByEntryGw[key].push(r);
        });

        const buildProvFromHistory = (rows, mult) => rows.map(r => {
          const st = r.stats || {};
          const events = r.benched
            ? { goalAmt: 0, assistAmt: 0, saveAmt: 0, cleanSheetAmt: 0, yellowAmt: 0, redAmt: 0, concededAmt: 0 }
            : computePlayerEventBreakdown(r.position, {
                goals_scored: st.goals || 0, assists: st.assists || 0, yellow_cards: st.yellow_cards || 0,
                red_cards: st.red_cards || 0, clean_sheets: st.clean_sheets || 0, saves: st.saves || 0,
                goals_conceded: st.goals_conceded || 0, team_goals_conceded: st.goals_conceded || 0
              }, mult);
          return { player_id: r.player_id, name: r.name, liveValue: Math.round(r.starting_value || 0), events, received: 0, paid: 0, shortBy: 0 };
        });

        const mismatches = [];
        let playerRowsChecked = 0;
        for (const m of (settledMatchups || [])) {
          const rowsA = historyByEntryGw[`${m.entry_id_1}:${m.gameweek}`] || [];
          const rowsB = historyByEntryGw[`${m.entry_id_2}:${m.gameweek}`] || [];
          if (rowsA.length === 0 || rowsB.length === 0) continue;
          const mult = multiplierAtGameweek(m.gameweek);
          const provA = buildProvFromHistory(rowsA, mult);
          const provB = buildProvFromHistory(rowsB, mult);
          settleUnified(provA, provB);

          [[provA, rowsA, m.entry_id_1], [provB, rowsB, m.entry_id_2]].forEach(([prov, rows, entryId]) => {
            prov.forEach(p => {
              playerRowsChecked++;
              const real = rows.find(r => r.player_id === p.player_id);
              if (!real) return;
              const wonDiff = Math.abs((real.win_bonus || 0) - p.received);
              const paidDiff = Math.abs((real.penalty_paid || 0) - p.paid);
              if (wonDiff > 1 || paidDiff > 1) {
                mismatches.push({
                  gameweek: m.gameweek, entry_id: entryId, player: p.name,
                  expected_won: p.received, actual_won: real.win_bonus || 0,
                  expected_paid: p.paid, actual_paid: real.penalty_paid || 0
                });
              }
            });
          });
        }

        return res.status(200).json({
          audit: {
            total_entries: totalEntries,
            active_entries: activeEntries.length,
            relegated_entries: relegatedEntries.length,
            entry_fee: tournamentRow.entry_fee || 0,
            expected_pot: expectedPot,
            actual_active_total: actualActiveTotal,
            drift,
            relegated_frozen_total_informational: relegatedFrozenTotal,
            cost_multiplier: tournamentRow.cost_multiplier || 1,
            ok: Math.abs(drift) <= 1 // 1p tolerance for rounding
          },
          action_audit: {
            matchups_checked: (settledMatchups || []).length,
            player_rows_checked: playerRowsChecked,
            mismatches_found: mismatches.length,
            ok: mismatches.length === 0,
            mismatches: mismatches.slice(0, 50),
            note: 'Checks every settled matchup against TODAY\'s live reward values. Only fully reliable for gameweeks settled entirely under the current FLAT_REWARDS — if those values get tuned again later, run this again right after on a fresh tournament to re-validate.'
          }
        });
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
            ? await masterDb.from('players').select('id, photo, custom_photo_url').in('id', filledIds)
            : { data: [] };
          const photoByPid = {};
          (photoRows || []).forEach(p => {
            photoByPid[p.id] = p.custom_photo_url || (p.photo ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${p.photo.replace('.jpg', '')}.png` : null);
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
            const sharedShare = m.current_value != null ? Math.round(m.current_value / ownership) : null;
            const lastWeekShare = m.last_week_value != null ? Math.round(m.last_week_value / ownership) : null;
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
              market_value: m.current_value != null ? m.current_value : null,
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

      // Wallet: the logged-in user's own transaction history + running
      // total owed. Read-only ledger view — nothing here charges or pays
      // anything, it just shows what's already been recorded.
      // Admin — just the polling-paused flag, cheap to check on page load
      const adminPollingStatus = params.get('admin_polling_status');
      if (adminPollingStatus === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: clock } = await masterDb.from('master_clock').select('polling_paused').eq('id', 'current').maybeSingle();
        return res.status(200).json({ polling_paused: !!clock?.polling_paused });
      }

      // Admin — match list for the Simulate Match tool, plus whether
      // real polling is currently paused.
      // Admin — row counts for every table a tournament type uses. Lets
      // you actually see there's nothing left over after a delete, rather
      // than just trusting it worked.
      const adminTournamentDataCounts = params.get('admin_tournament_data_counts');
      if (adminTournamentDataCounts) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const tables = TOURNAMENT_SCHEMA_TABLES[adminTournamentDataCounts];
        if (!tables) return res.status(400).json({ error: `Unknown tournament type — must be one of: ${Object.keys(TOURNAMENT_SCHEMA_TABLES).join(', ')}` });

        const counts = {};
        for (const table of tables) {
          const { count, error: countErr } = await supabaseAdmin
            .schema(adminTournamentDataCounts).from(table).select('*', { count: 'exact', head: true });
          counts[table] = countErr ? `error: ${countErr.message}` : (count ?? 0);
        }
        return res.status(200).json({ tournament_type: adminTournamentDataCounts, counts });
      }

      const adminMatchesGw = params.get('admin_matches_for_gameweek');
      if (adminMatchesGw) {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: matches, error: matchesErr } = await masterDb
          .from('matches')
          .select('id, home_team, away_team, status, home_score, away_score, kickoff_time')
          .eq('gameweek', parseInt(adminMatchesGw))
          .order('kickoff_time', { ascending: true });
        if (matchesErr) return res.status(500).json({ error: matchesErr.message });

        const { data: clock } = await masterDb.from('master_clock').select('polling_paused').eq('id', 'current').maybeSingle();

        return res.status(200).json({ matches: matches || [], polling_paused: !!clock?.polling_paused });
      }

      const wallet = params.get('wallet');
      if (wallet === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

        const { data: transactions, error: txError } = await supabaseAdmin
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (txError) return res.status(500).json({ error: 'Failed to load wallet', details: txError.message });

        const owed = (transactions || []).reduce((sum, t) => sum + t.amount, 0);
        return res.status(200).json({ owed, transactions: transactions || [] });
      }

      // Admin — Payments & Bookkeeping: every registered user with their
      // running total owed, computed fresh from the ledger every time
      // (never a cached/stored balance that could drift out of sync).
      const adminWalletList = params.get('admin_wallet_list');
      if (adminWalletList === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { data: allUsers, error: usersError } = await supabaseAdmin
          .from('users')
          .select('id, username, display_name, email')
          .order('username', { ascending: true });
        if (usersError) return res.status(500).json({ error: 'Failed to load users', details: usersError.message });

        const { data: allTx, error: txError } = await supabaseAdmin
          .from('wallet_transactions')
          .select('user_id, amount');
        if (txError) return res.status(500).json({ error: 'Failed to load transactions', details: txError.message });

        const owedByUser = {};
        (allTx || []).forEach(t => { owedByUser[t.user_id] = (owedByUser[t.user_id] || 0) + t.amount; });

        const list = (allUsers || []).map(u => ({ ...u, owed: owedByUser[u.id] || 0 }));

        return res.status(200).json({ users: list });
      }

      // Admin — a single user's full transaction history, for the
      // click-to-expand row in the Payments & Bookkeeping panel.
      const adminWalletDetail = params.get('admin_wallet_detail');
      if (adminWalletDetail === 'true') {
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
        const token = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
        if (authError || !user) return res.status(401).json({ error: 'Invalid token' });

        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const targetUserId = params.get('user_id');
        if (!targetUserId) return res.status(400).json({ error: 'user_id is required' });

        const { data: transactions, error: txError } = await supabaseAdmin
          .from('wallet_transactions')
          .select('*')
          .eq('user_id', targetUserId)
          .order('created_at', { ascending: false });

        if (txError) return res.status(500).json({ error: 'Failed to load transactions', details: txError.message });

        return res.status(200).json({ transactions: transactions || [] });
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
          entered: !!entry,
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
              const isCaptain = pid === e.captain_id;
              // Captain doubling only ever applies to the current
              // gameweek's points, not their whole season total — total
              // already includes this gameweek's contribution once, so
              // captain just adds one extra copy of it, same real FPL rule.
              total += pts.total + (isCaptain ? pts.gw : 0);
              gw += isCaptain ? pts.gw * 2 : pts.gw;
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

      // current_entries is only ever incremented by the normal "Enter Now"
      // join flow, so it drifts whenever entries get added any other way
      // (e.g. the admin test-seeding tools) — counting the real rows
      // avoids trusting a cache that's known to go stale.
      const tournamentIds = (data || []).map(t => t.id);
      const realEntryCounts = {};
      if (tournamentIds.length > 0) {
        const { data: entryRows } = await supabaseAdmin
          .schema(schemaName).from('tournament_entries')
          .select('tournament_id').in('tournament_id', tournamentIds);
        (entryRows || []).forEach(e => {
          realEntryCounts[e.tournament_id] = (realEntryCounts[e.tournament_id] || 0) + 1;
        });
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
        
        // Calculate live prize pool from entry fee × real entry count
        const entryFee = parseFloat(t.entry_fee) || 0;
        const currentEntries = realEntryCounts[t.id] ?? (parseInt(t.current_entries) || 0);
        const calculatedPrizePool = entryFee * currentEntries;

        return {
          ...t,
          current_entries: currentEntries, // real count, not the drift-prone cache
          prize_pool: calculatedPrizePool, // Use calculated value, not stored value
          time_remaining: timeRemaining,
          is_full: t.max_entries && currentEntries >= t.max_entries
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

        // Every display page (Predictions/LMS/Stock Market hero cards) and
        // the wallet charge on join both divide/treat this as pence — but
        // the admin form's "Entry Fee (£)" field is typed in pounds. This
        // converts once here, at the single point of creation, instead of
        // requiring every caller to remember to do it themselves.
        const entryFeePence = Math.round((entry_fee || 0) * 100);
        const prizePoolPence = Math.round((prize_pool || 0) * 100);

        // Stock Market's tournaments table has no prize_pool/top_prize
        // columns at all — confirmed against the real schema, not
        // assumed. The other three schemas do, so this only needs to be
        // conditional here rather than everywhere.
        const insertPayload = {
          name,
          entry_fee: entryFeePence,
          gameweek,
          end_gameweek: end_gameweek || gameweek,
          max_entries: max_entries || 100,
          current_entries: 0,
          // Stock Market's own lock-status check treats status='live' as
          // "drafting already closed", regardless of closes_at — it needs
          // to start 'upcoming' so there's an actual open draft window
          // before the market goes live. Every other schema is fine
          // starting 'live' immediately (they don't have a separate draft
          // phase), confirmed against the real getStockMarketLockStatus
          // logic rather than assumed.
          status: schemaName === 'stockmarket' ? 'upcoming' : 'live',
          closes_at: closes_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        };
        if (schemaName !== 'stockmarket') {
          insertPayload.prize_pool = prizePoolPence;
          insertPayload.top_prize = prizePoolPence;
        }
        // fantasy-manager.js specifically filters for format='fantasy_squad'
        // to find its live tournament — the column's default ('predictions',
        // a copy-paste leftover from the schema being cloned) silently
        // meant Fantasy tournaments were invisible to their own page.
        if (schemaName === 'fantasy') {
          insertPayload.format = 'fantasy_squad';
        }

        const { data, error } = await supabaseAdmin
          .schema(schemaName).from('tournaments')
          .insert(insertPayload)
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
      // Admin — Payments & Bookkeeping: record a real-world payment
      // received from a user (cash, bank transfer, whatever — happens
      // entirely outside this app). Just writes a negative ledger entry
      // that reduces what they owe; never touches real money itself.
      if (action === 'admin_record_payment') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { user_id: targetUserId, amount: paymentAmount } = req.body;
        if (!targetUserId || !paymentAmount || paymentAmount <= 0) {
          return res.status(400).json({ error: 'user_id and a positive amount (in pence) are required' });
        }

        const { data: txRow, error: txError } = await supabaseAdmin
          .from('wallet_transactions')
          .insert({
            user_id: targetUserId,
            type: 'payment',
            amount: -Math.abs(paymentAmount),
            description: `Payment received — £${(paymentAmount / 100).toFixed(2)}`,
            created_by: user.id
          })
          .select()
          .single();

        if (txError) return res.status(500).json({ error: 'Failed to record payment', details: txError.message });

        return res.status(200).json({ success: true, transaction: txRow });
      }

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

        const result = await syncGameweekStatsFromFPL(masterDb, syncGw, false);
        return res.status(result.status).json(result.body);
      }

      // Same sync as above, but safe for ANY logged-in user (no admin
      // check) and figures out which gameweek to sync itself from
      // master_clock — this is what live-poll.js calls automatically
      // every 2 minutes, the same way it already calls /api/sync-players.
      // FPL's own "not played yet" response is harmless here; it just
      // means there's nothing new yet, same as any other poll tick.
      if (action === 'sync_current_gameweek_stats') {
        const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
        const currentGw = clock ? clock.current_gameweek : null;
        if (!currentGw) return res.status(200).json({ skipped: true, reason: 'master clock not set' });

        const result = await syncGameweekStatsFromFPL(masterDb, currentGw, true);
        return res.status(result.status).json(result.body);
      }

      // ADMIN TEST TOOL: generates believable fake match results AND
      // player stats for a real gameweek's real fixtures, in one action.
      // Unlike the old approach (relabeling real historical data onto
      // fake gameweek numbers), this uses the REAL fixtures already
      // sitting in `matches` for whichever real gameweek is picked, and
      // fabricates a result + stats consistent with each other — a
      // player's clean_sheets/goals_conceded always matches what their
      // own team's fake scoreline says, same as it would for real data.
      if (action === 'generate_test_gameweek_data') {
        const { data: genCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!genCaller || !genCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const testGw = parseInt(req.body.gameweek);
        if (!testGw || testGw < 1 || testGw > 38) {
          return res.status(400).json({ error: 'A real gameweek (1-38) is required' });
        }

        const result = await generateTestGameweekData(masterDb, testGw, supabaseAdmin);
        return res.status(result.status).json(result.body);
      }

      // Seed a whole range of gameweeks with realistic results + player
      // stats, WITHOUT marking any of them finished — matches stay
      // 'upcoming', ready for the "Mark Games Finished" checkbox tool to
      // flip individually later. This is the one-time bulk seed for a
      // full test season; the checkbox tool is what actually progresses
      // things from there.
      if (action === 'seed_gameweek_range') {
        const { data: seedCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!seedCaller || !seedCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const fromGw = parseInt(req.body.from_gw);
        const toGw = parseInt(req.body.to_gw);
        if (!fromGw || !toGw || fromGw < 1 || toGw > 38 || toGw < fromGw) {
          return res.status(400).json({ error: 'from_gw and to_gw (1-38, from_gw <= to_gw) are required' });
        }
        if (toGw - fromGw > 15) {
          return res.status(400).json({ error: 'Max 15 gameweeks at once — run it again for the rest' });
        }

        const results = {};
        for (let gw = fromGw; gw <= toGw; gw++) {
          const r = await generateTestGameweekData(masterDb, gw, supabaseAdmin, false);
          results[gw] = { status: r.status, ...r.body };
        }
        return res.status(200).json({ success: true, seeded: results });
      }

      // Wipes every row in every table a tournament type uses. Delete-only
      // — deliberately doesn't recreate a fresh tournament afterward, so
      // you use the normal Launch Tournament flow for that type once
      // you're ready, rather than this guessing at the right defaults.
      if (action === 'admin_wipe_tournament_schema') {
        const { data: wipeCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!wipeCaller || !wipeCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const tType = req.body.tournament_type;
        const tables = TOURNAMENT_SCHEMA_TABLES[tType];
        if (!tables) return res.status(400).json({ error: `Unknown tournament_type — must be one of: ${Object.keys(TOURNAMENT_SCHEMA_TABLES).join(', ')}` });

        try {
          const deletedCounts = {};
          for (const table of tables) {
            const pkColumn = TOURNAMENT_TABLE_PK_OVERRIDES[`${tType}.${table}`] || 'id';
            const { error: delErr, count } = await supabaseAdmin
              .schema(tType).from(table).delete({ count: 'exact' }).not(pkColumn, 'is', null);
            if (delErr) {
              console.error(`admin_wipe_tournament_schema: failed to clear ${tType}.${table}:`, delErr.message);
              deletedCounts[table] = `error: ${delErr.message}`;
            } else {
              deletedCounts[table] = count ?? 0;
            }
          }
          return res.status(200).json({ success: true, tournament_type: tType, deleted: deletedCounts });
        } catch (err) {
          console.error('admin_wipe_tournament_schema error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Resets matches in a gameweek range back to blank/upcoming and
      // deletes their player_gameweek_stats — a clean slate for
      // re-testing, since matches finished during earlier test runs
      // (before the seed tool existed, or before the settlement bug was
      // fixed) would otherwise sit there with stale results and mess up
      // a fresh test. Scoped to an explicit GW range on purpose — no
      // "clear everything" option, so this can never touch a gameweek
      // outside the range typed in. Requires typing CLEAR to confirm,
      // since this deletes real rows.
      if (action === 'clear_gameweek_range') {
        const { data: clearCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!clearCaller || !clearCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const clearFromGw = parseInt(req.body.from_gw);
        const clearToGw = parseInt(req.body.to_gw);
        const confirmPhrase = req.body.confirm;
        if (!clearFromGw || !clearToGw || clearFromGw < 1 || clearToGw > 38 || clearToGw < clearFromGw) {
          return res.status(400).json({ error: 'from_gw and to_gw (1-38, from_gw <= to_gw) are required' });
        }
        if (confirmPhrase !== 'CLEAR') {
          return res.status(400).json({ error: 'Confirmation phrase did not match' });
        }

        try {
          const { error: matchClearErr, count: matchCount } = await masterDb
            .from('matches')
            .update({ status: 'upcoming', home_score: null, away_score: null, result: null }, { count: 'exact' })
            .gte('gameweek', clearFromGw).lte('gameweek', clearToGw);
          if (matchClearErr) return res.status(500).json({ error: matchClearErr.message });

          const { error: statsClearErr, count: statsCount } = await masterDb
            .from('player_gameweek_stats')
            .delete({ count: 'exact' })
            .gte('gameweek', clearFromGw).lte('gameweek', clearToGw);
          if (statsClearErr) return res.status(500).json({ error: statsClearErr.message });

          return res.status(200).json({
            success: true, from_gw: clearFromGw, to_gw: clearToGw,
            matches_reset: matchCount ?? null, stat_rows_deleted: statsCount ?? null
          });
        } catch (err) {
          console.error('clear_gameweek_range error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // The checkbox tool — mark specific matches finished using
      // whatever result/stats data is ALREADY sitting in the database
      // (e.g. inserted directly via SQL), rather than generating
      // anything. This is deliberately separate from
      // generate_test_gameweek_data, which fabricates its own data —
      // this one trusts what's already there and just flips status,
      // then fires the same real trigger functions production uses.
      if (action === 'mark_matches_finished') {
        const { data: markCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!markCaller || !markCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { match_ids: matchIds } = req.body;
        if (!Array.isArray(matchIds) || matchIds.length === 0) {
          return res.status(400).json({ error: 'match_ids (array) is required' });
        }
        console.log(`[MARK_MATCHES_FINISHED] Starting — match_ids: ${JSON.stringify(matchIds)}`);

        try {
          const { data: matchesToMark, error: fetchErr } = await masterDb
            .from('matches').select('id, gameweek, home_score, away_score').in('id', matchIds);
          if (fetchErr) return res.status(500).json({ error: fetchErr.message });

          const gameweeksTouched = new Set();
          for (const m of (matchesToMark || [])) {
            const hs = m.home_score ?? 0;
            const as = m.away_score ?? 0;
            const result = hs > as ? 'H' : as > hs ? 'A' : 'D';
            await masterDb.from('matches').update({ status: 'finished', result }).eq('id', m.id);
            gameweeksTouched.add(m.gameweek);
          }

          // Same real function live-scores.js uses for real.
          let predictionsScored = false;
          try {
            console.log(`[PREDICTIONS_DEBUG] mark_matches_finished: requiring live-scores.js, gameweeksTouched=${JSON.stringify([...gameweeksTouched])}`);
            const { calculatePointsForGameweek } = require('./live-scores.js');
            console.log(`[PREDICTIONS_DEBUG] mark_matches_finished: require succeeded, calculatePointsForGameweek is ${typeof calculatePointsForGameweek}`);
            for (const gw of gameweeksTouched) {
              await calculatePointsForGameweek(supabaseAdmin, masterDb, gw);
            }
            predictionsScored = true;
            console.log(`[PREDICTIONS_DEBUG] mark_matches_finished: all gameweeks processed successfully`);
          } catch (predErr) {
            console.error('[PREDICTIONS_DEBUG] mark_matches_finished: Predictions scoring failed (non-fatal):', predErr, predErr?.stack);
          }

          // Fantasy and LMS both update live per-match, same as
          // Predictions — a player's points, or whether their LMS pick
          // survived, are knowable the moment the relevant match finishes,
          // not just once the whole gameweek is done. Stock Market/LMS's
          // round-completion (settlement, winner declaration) still waits
          // for the full gameweek below, since those genuinely can't be
          // decided safely early.
          const fantasyResults = {};
          const lmsResults = {};
          for (const gw of gameweeksTouched) {
            fantasyResults[gw] = await updateFantasyPointsForGameweek(masterDb, gw);
            console.log(`[MARK_MATCHES_FINISHED] GW${gw} Fantasy: ${fantasyResults[gw].fantasy_players_updated} players updated`);

            const { data: liveLmsTournaments, error: lmsFetchErr } = await supabaseAdmin
              .schema('lms').from('tournaments').select('id').eq('status', 'live');
            console.log(`[MARK_MATCHES_FINISHED] GW${gw} LMS: found ${(liveLmsTournaments || []).length} live tournament(s), fetch error: ${lmsFetchErr ? lmsFetchErr.message : 'none'}`);
            let newlyEliminated = 0;
            for (const t of (liveLmsTournaments || [])) {
              const r = await updateLmsPicksForGameweek(masterDb, supabaseAdmin, t.id, gw);
              console.log(`[MARK_MATCHES_FINISHED] GW${gw} LMS tournament ${t.id}: ${r.newly_eliminated} newly eliminated`);
              newlyEliminated += r.newly_eliminated;
            }
            lmsResults[gw] = { newly_eliminated: newlyEliminated };
          }

          const gameweekResults = {};
          for (const gw of gameweeksTouched) {
            gameweekResults[gw] = await finalizeGameweekIfComplete(masterDb, supabaseAdmin, gw);
            gameweekResults[gw].fantasy_players_updated = fantasyResults[gw]?.fantasy_players_updated || 0;
            gameweekResults[gw].lms_newly_eliminated = lmsResults[gw]?.newly_eliminated || 0;
          }

          return res.status(200).json({
            success: true, matches_marked: (matchesToMark || []).length,
            predictions_scored: predictionsScored, gameweek_results: gameweekResults
          });
        } catch (err) {
          console.error('mark_matches_finished error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Simulate ONE match finishing — same generation logic as the bulk
      // tool above (literally the same function), same points-calculation
      // call, just scoped to a single match instead of a whole gameweek.
      // This is what lets a gameweek be tested match-by-match, the way a
      // real Saturday 3pm slate actually plays out, instead of everything
      // resolving at once.
      if (action === 'simulate_match_finish') {
        const { data: simCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!simCaller || !simCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { match_id: simMatchId } = req.body;
        if (!simMatchId) return res.status(400).json({ error: 'match_id is required' });

        try {
          const { data: match, error: matchErr } = await masterDb
            .from('matches').select('id, gameweek, home_team, away_team').eq('id', simMatchId).maybeSingle();
          if (matchErr || !match) return res.status(404).json({ error: 'Match not found' });

          const { data: teams } = await masterDb.from('teams').select('id, name');
          const teamIdByName = {};
          (teams || []).forEach(t => { teamIdByName[t.name] = t.id; });

          const { data: allPlayers } = await masterDb
            .from('players').select('id, web_name, team, element_type, photo, custom_photo_url');
          const playersByTeamId = {};
          (allPlayers || []).forEach(p => {
            if (!playersByTeamId[p.team]) playersByTeamId[p.team] = [];
            playersByTeamId[p.team].push(p);
          });

          const statByPlayerId = {};
          const matchUpdate = simulateOneMatchIntoAccumulator(match, match.gameweek, teamIdByName, playersByTeamId, statByPlayerId);

          const { error: matchUpdateErr } = await masterDb.from('matches').update({
            home_score: matchUpdate.home_score, away_score: matchUpdate.away_score,
            status: matchUpdate.status, result: matchUpdate.result
          }).eq('id', matchUpdate.id);
          if (matchUpdateErr) return res.status(500).json({ error: matchUpdateErr.message });

          const statRows = Object.values(statByPlayerId);
          if (statRows.length > 0) {
            await masterDb.from('player_gameweek_stats').upsert(statRows, { onConflict: 'gameweek,player_id' });
          }

          // Same real function live-scores.js will use for real — not a
          // reimplementation. Safe to call after every single match too;
          // it only scores predictions for matches that are actually
          // finished, and it's idempotent (upsert-based).
          let predictionsScored = false;
          try {
            const { calculatePointsForGameweek } = require('./live-scores.js');
            await calculatePointsForGameweek(supabaseAdmin, masterDb, match.gameweek);
            predictionsScored = true;
          } catch (predErr) {
            console.error('simulate_match_finish: Predictions scoring step failed (non-fatal):', predErr);
          }

          const fantasyResult = await updateFantasyPointsForGameweek(masterDb, match.gameweek);

          return res.status(200).json({
            success: true, match_id: matchUpdate.id, gameweek: match.gameweek,
            home_team: match.home_team, away_team: match.away_team,
            home_score: matchUpdate.home_score, away_score: matchUpdate.away_score,
            players_with_stats: statRows.length, predictions_scored: predictionsScored,
            fantasy_players_updated: fantasyResult.fantasy_players_updated
          });
        } catch (err) {
          console.error('simulate_match_finish error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Simulate ONE match going live (in progress) — no player stats or
      // points yet, matching real behaviour: a live match doesn't award
      // points until it's actually finished. This is purely so the "In
      // Play" live-score UI can be tested before committing to a result.
      if (action === 'simulate_match_live') {
        const { data: liveCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!liveCaller || !liveCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { match_id: liveMatchId, home_score: liveHomeScore, away_score: liveAwayScore } = req.body;
        if (!liveMatchId) return res.status(400).json({ error: 'match_id is required' });

        try {
          const { error: liveUpdateErr } = await masterDb.from('matches').update({
            status: 'live',
            home_score: Number.isInteger(liveHomeScore) ? liveHomeScore : 0,
            away_score: Number.isInteger(liveAwayScore) ? liveAwayScore : 0
          }).eq('id', liveMatchId);
          if (liveUpdateErr) return res.status(500).json({ error: liveUpdateErr.message });

          return res.status(200).json({ success: true });
        } catch (err) {
          console.error('simulate_match_live error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Toggle the testing pause switch — while paused, live-scores.js,
      // sync-players.js, and sync-fixtures.js all skip real FPL calls
      // entirely (checked at the very top of each), so admin-simulated
      // test data for the current gameweek can't be silently overwritten.
      if (action === 'admin_set_polling_paused') {
        const { data: pauseCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!pauseCaller || !pauseCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { paused } = req.body;
        try {
          await masterDb.from('master_clock').update({ polling_paused: !!paused }).eq('id', 'current');
          return res.status(200).json({ success: true, polling_paused: !!paused });
        } catch (err) {
          console.error('admin_set_polling_paused error:', err);
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
      // ADMIN: instantly seed valid random squads for a list of existing
      // users, skipping the draft UI entirely — for repeated testing
      // without having to click through drafting every single time.
      // TEMPORARY TEST TOOL — delete after testing. Force-closes the
      // draft window right now instead of needing manual SQL each time.
      // TEMPORARY TEST TOOL — delete after testing. Advances the master
      // clock's current gameweek by 1. Used to just bump the clock,
      // relying on real historical FPL data already being finished for
      // that gameweek — but with the season freshly reset to 0, there's
      // no real data to rely on any more. Now it generates a full test
      // result for the gameweek being left (same generator function used
      // everywhere else, so it's the same real mechanics, not new logic)
      // before advancing, so Stock Market always has something to settle.
      if (action === 'stockmarket_advance_gameweek') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        try {
          const { data: clock } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
          const leavingGw = clock ? clock.current_gameweek : 0;
          const newGw = leavingGw + 1;

          let testDataGenerated = false;
          let stockMarketSettled = 0;
          let lmsSettled = 0;
          let fantasyUpdated = 0;

          if (leavingGw > 0) {
            // Check BEFORE generating anything — if the leaving gameweek
            // was already finished (e.g. via Mark Games Finished), it
            // already has real results everything downstream has been
            // scored/settled against. Regenerating here would silently
            // overwrite those with brand new random results, corrupting
            // Predictions/Stock Market/LMS without any of them knowing
            // the ground truth had changed under them. Only auto-generate
            // as a safety net when the admin genuinely never finished it.
            const { data: gwMatchesBefore } = await masterDb
              .from('matches')
              .select('status')
              .eq('gameweek', leavingGw);
            const alreadyFinished = gwMatchesBefore && gwMatchesBefore.length > 0
              && gwMatchesBefore.every(m => m.status === 'finished');

            if (!alreadyFinished) {
              // generateTestGameweekData itself refuses to fabricate
              // results while real polling is active — this just
              // surfaces that as a clear error instead of silently
              // treating it as "nothing generated".
              const genResult = await generateTestGameweekData(masterDb, leavingGw, supabaseAdmin);
              if (genResult.status !== 200) {
                return res.status(genResult.status).json(genResult.body);
              }
              testDataGenerated = true;
            }

            // Fantasy updates live per-match/whenever called, not gated
            // on the whole gameweek — same as mark_matches_finished.
            const fantasyResult = await updateFantasyPointsForGameweek(masterDb, leavingGw);
            fantasyUpdated = fantasyResult.fantasy_players_updated;

            // Settlement only ever checks "is the CURRENT clock gameweek's
            // matches all finished" — and this action is about to move the
            // clock away from leavingGw forever. Without explicitly
            // settling it here first, no page load would ever check back
            // on it again, and it would just silently never settle. Same
            // real functions production uses, just called directly instead
            // of waiting for a page load to trigger them.
            const { data: gwMatches } = await masterDb
              .from('matches')
              .select('home_team, away_team, home_score, away_score, status, kickoff_time')
              .eq('gameweek', leavingGw);
            const allFinished = gwMatches && gwMatches.length > 0 && gwMatches.every(m => m.status === 'finished');

            if (allFinished) {
              // Fantasy's "Best Single Gameweek" / "Longest Scoring Streak"
              // records depend on this snapshot existing for every finished
              // gameweek. It used to only fire if someone happened to load
              // Fantasy Manager's page (or save a squad) in the narrow
              // window between a gameweek finishing and it being advanced —
              // easy to miss entirely, which is exactly why those records
              // were showing "no data yet". Guaranteed here instead.
              await snapshotGameweekIfNeeded(masterDb, leavingGw);

              const { data: liveStockMarkets } = await supabaseAdmin
                .schema('stockmarket').from('tournaments').select('id').eq('status', 'live');
              for (const t of (liveStockMarkets || [])) {
                await ensureMatchupsForGameweek(supabaseAdmin, t.id, leavingGw);
                await applyDueStages(supabaseAdmin, t.id, leavingGw);
                await processHeadToHeadGameweek(supabaseAdmin, masterDb, t.id, leavingGw);
                stockMarketSettled++;
              }

              const { data: liveLms } = await supabaseAdmin
                .schema('lms').from('tournaments').select('id').eq('status', 'live');
              for (const t of (liveLms || [])) {
                await updateLmsPicksForGameweek(masterDb, supabaseAdmin, t.id, leavingGw);
                await finalizeLmsRoundIfComplete(supabaseAdmin, t.id, leavingGw);
                lmsSettled++;
              }
            }
          }

          // Auto-pause real polling the first time this test button is
          // used, so the data it just generated can't get silently
          // overwritten by background live-poll syncing 2 minutes later.
          await masterDb.from('master_clock').update({ current_gameweek: newGw, polling_paused: true }).eq('id', 'current');
          return res.status(200).json({
            success: true, new_gameweek: newGw, test_data_generated: testDataGenerated,
            stock_market_tournaments_settled: stockMarketSettled,
            lms_tournaments_settled: lmsSettled,
            fantasy_players_updated: fantasyUpdated,
            polling_paused: true
          });
        } catch (err) {
          console.error('stockmarket_advance_gameweek error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Admin saves the relegation-stage schedule for a tournament — up to
      // 8 stages, each independently editable (trigger gameweek, how many
      // get cut, and the cost-per-action multiplier from that point on).
      // A stage already applied is left untouched even if included in the
      // payload — its effect already happened and can't be un-done by
      // editing the row after the fact.
      if (action === 'stockmarket_save_stages') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: stagesTournamentId, stages } = req.body;
        if (!stagesTournamentId || !Array.isArray(stages)) {
          return res.status(400).json({ error: 'tournament_id and a stages array are required' });
        }

        try {
          const { data: existingStages } = await supabaseAdmin
            .schema('stockmarket').from('tournament_stages')
            .select('stage_number, applied').eq('tournament_id', stagesTournamentId);
          const appliedNumbers = new Set((existingStages || []).filter(s => s.applied).map(s => s.stage_number));

          const results = [];
          for (const s of stages) {
            const stageNumber = parseInt(s.stage_number);
            if (!stageNumber || stageNumber < 1 || stageNumber > 8) continue;
            if (appliedNumbers.has(stageNumber)) {
              results.push({ stage_number: stageNumber, skipped: true, reason: 'already applied' });
              continue;
            }
            const triggerGw = s.trigger_gameweek === '' || s.trigger_gameweek == null ? null : parseInt(s.trigger_gameweek);
            const relegateCount = Math.max(0, parseInt(s.relegate_count) || 0);
            const costMultiplier = Math.max(0.01, parseFloat(s.cost_multiplier) || 1);

            if (triggerGw == null) {
              // Blank trigger week = this slot isn't in use; remove any
              // existing unapplied row for it rather than leaving a stale one.
              await supabaseAdmin.schema('stockmarket').from('tournament_stages')
                .delete().eq('tournament_id', stagesTournamentId).eq('stage_number', stageNumber).eq('applied', false);
              results.push({ stage_number: stageNumber, cleared: true });
              continue;
            }

            await supabaseAdmin.schema('stockmarket').from('tournament_stages')
              .upsert({
                tournament_id: stagesTournamentId, stage_number: stageNumber,
                trigger_gameweek: triggerGw, relegate_count: relegateCount, cost_multiplier: costMultiplier,
                applied: false
              }, { onConflict: 'tournament_id,stage_number' });
            results.push({ stage_number: stageNumber, saved: true, trigger_gameweek: triggerGw, relegate_count: relegateCount, cost_multiplier: costMultiplier });
          }

          return res.status(200).json({ success: true, results });
        } catch (err) {
          console.error('stockmarket_save_stages error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Admin: change how long a tournament runs after it's already live —
      // e.g. shortening or extending it. Only blocked once the tournament
      // has actually finished, since that point is meant to be permanent.
      if (action === 'stockmarket_edit_end_gameweek') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: editTournamentId, end_gameweek: newEndGameweek } = req.body;
        if (!editTournamentId || !newEndGameweek) {
          return res.status(400).json({ error: 'tournament_id and end_gameweek are required' });
        }

        const { data: editTourn } = await supabaseAdmin
          .schema('stockmarket').from('tournaments')
          .select('status').eq('id', editTournamentId).maybeSingle();
        if (!editTourn) return res.status(404).json({ error: 'Tournament not found' });
        if (editTourn.status === 'finished') {
          return res.status(400).json({ error: 'Tournament has already finished — end_gameweek is locked' });
        }

        const { error: editError } = await supabaseAdmin
          .schema('stockmarket').from('tournaments')
          .update({ end_gameweek: parseInt(newEndGameweek) })
          .eq('id', editTournamentId);
        if (editError) return res.status(500).json({ error: editError.message });

        return res.status(200).json({ success: true, end_gameweek: parseInt(newEndGameweek) });
      }

      // One-click version of the manual SQL reset used for testing —
      // wipes every Stock Market table clean, creates one fresh
      // 'upcoming' tournament at gameweek 1, and resets the shared
      // master clock. Admin only, and deliberately mirrors the existing
      // reset SQL exactly rather than trying to be clever about scoping,
      // since that SQL has been the trusted, hand-verified process all
      // along.
      if (action === 'stockmarket_full_reset') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        try {
          await supabaseAdmin.schema('stockmarket').from('matchups').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('player_gw_history').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('transactions').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('audit_log').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('player_market').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('tournament_entries').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('tournament_stages').delete().neq('id', '00000000-0000-0000-0000-000000000000');
          await supabaseAdmin.schema('stockmarket').from('tournaments').delete().neq('id', '00000000-0000-0000-0000-000000000000');

          const name = (req.body.name) || 'Test Stock Market';
          const entryFee = req.body.entry_fee != null ? parseInt(req.body.entry_fee) : 2400;
          const maxEntries = req.body.max_entries != null ? parseInt(req.body.max_entries) : 200;
          const endGameweek = req.body.end_gameweek != null ? parseInt(req.body.end_gameweek) : 38;

          const { data: newTournament, error: createErr } = await supabaseAdmin
            .schema('stockmarket').from('tournaments')
            .insert({
              name, description: 'description', gameweek: 1, end_gameweek: endGameweek,
              entry_fee: entryFee, max_entries: maxEntries, status: 'upcoming',
              closes_at: new Date(Date.now() + 30 * 60 * 1000).toISOString()
            })
            .select('id').single();
          if (createErr) throw createErr;

          await masterDb.from('master_clock').update({ current_gameweek: 1 }).eq('id', 'current');

          return res.status(200).json({ success: true, tournament_id: newTournament.id });
        } catch (err) {
          console.error('stockmarket_full_reset error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      if (action === 'stockmarket_force_close') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: closeTournamentId } = req.body;
        if (!closeTournamentId) return res.status(400).json({ error: 'tournament_id is required' });

        try {
          await supabaseAdmin.schema('stockmarket').from('tournaments')
            .update({ closes_at: new Date(Date.now() - 60000).toISOString() })
            .eq('id', closeTournamentId);
          return res.status(200).json({ success: true });
        } catch (err) {
          console.error('stockmarket_force_close error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // TEMPORARY TEST TOOL — delete after testing. Creates N test user
      // accounts via Supabase's admin auth API, for large-scale testing.
      if (action === 'stockmarket_create_test_users') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { count } = req.body;
        const n = Math.min(Math.max(parseInt(count) || 0, 1), 50);

        try {
          const created = [];
          for (let i = 1; i <= n; i++) {
            const email = `loadtest${i}@stocktest.local`;
            const { data: existingUser } = await supabaseAdmin.from('users').select('id').eq('email', email).maybeSingle();
            if (existingUser) { created.push(existingUser.id); continue; }

            const { data: newUser, error: createErr } = await supabaseAdmin.auth.admin.createUser({
              email, password: `LoadTest${i}!2026`, email_confirm: true
            });
            if (createErr) { console.error(`Failed to create ${email}:`, createErr); continue; }

            const { error: profileErr } = await supabaseAdmin.from('users').insert({
              id: newUser.user.id, username: `loadtest${i}`, display_name: `Load Test ${i}`, email
            });
            if (profileErr) { console.error(`Failed to create profile for ${email}:`, profileErr); continue; }

            created.push(newUser.user.id);
          }
          return res.status(200).json({ success: true, created: created.length, user_ids: created });
        } catch (err) {
          console.error('stockmarket_create_test_users error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      if (action === 'stockmarket_seed_squads') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: seedTournamentId, user_ids } = req.body;
        if (!seedTournamentId || !Array.isArray(user_ids) || user_ids.length === 0) {
          return res.status(400).json({ error: 'tournament_id and a non-empty user_ids array are required' });
        }

        try {
          const { data: teamRows } = await masterDb.from('teams').select('id, name');
          const teamNameById = {};
          (teamRows || []).forEach(t => { teamNameById[t.id] = t.name; });

          const { data: playerRows } = await masterDb.from('players').select('id, web_name, element_type, team').limit(700);
          const byPosition = { 1: [], 2: [], 3: [], 4: [] };
          (playerRows || []).forEach(p => { if (byPosition[p.element_type]) byPosition[p.element_type].push(p); });

          const targetUserIds = user_ids.filter(uid => uid !== user.id); // never touch your own squad

          // Fetch existing entries in bulk first — existing ones must
          // keep their real current_value/start_value/last_week_value
          // rather than being reset to 0 just because they're being
          // re-seeded with a fresh squad.
          const { data: existingRows } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, user_id, current_value, start_value, last_week_value')
            .eq('tournament_id', seedTournamentId).in('user_id', targetUserIds);
          const existingByUser = {};
          (existingRows || []).forEach(e => { existingByUser[e.user_id] = e; });

          const results = [];
          const entryRows = [];
          for (const uid of targetUserIds) {
            // 1 GK, 1 DEF, 1 MID, 1 FWD, then 2 more from DEF/MID/FWD at random.
            const picks = [];
            const usedIds = new Set();
            const pickRandom = (pool) => {
              const eligible = pool.filter(p => !usedIds.has(p.id));
              const chosen = eligible[Math.floor(Math.random() * eligible.length)];
              usedIds.add(chosen.id);
              return chosen;
            };

            picks.push({ p: pickRandom(byPosition[1]), pos: 'gk' });
            picks.push({ p: pickRandom(byPosition[2]), pos: 'def' });
            picks.push({ p: pickRandom(byPosition[3]), pos: 'mid' });
            picks.push({ p: pickRandom(byPosition[4]), pos: 'fwd' });
            for (let i = 0; i < 2; i++) {
              const flexType = [2, 3, 4][Math.floor(Math.random() * 3)];
              const posKey = { 2: 'def', 3: 'mid', 4: 'fwd' }[flexType];
              picks.push({ p: pickRandom(byPosition[flexType]), pos: posKey });
            }

            const squad_players = picks.map(({ p, pos }) => ({
              player_id: p.id, position: pos, name: p.web_name, team: teamNameById[p.team] || '', is_sub: false
            }));

            const existing = existingByUser[uid];
            entryRows.push({
              tournament_id: seedTournamentId, user_id: uid, squad_players, squad_locked: false,
              current_value: existing ? existing.current_value : 0,
              start_value: existing ? existing.start_value : 0,
              last_week_value: existing ? existing.last_week_value : 0
            });
            results.push({ user_id: uid, squad: squad_players.map(s => s.name) });
          }

          // One batch upsert instead of a per-user select-then-write loop
          // (this is what made seeding actually slow).
          if (entryRows.length > 0) {
            const { error: upsertErr } = await supabaseAdmin
              .schema('stockmarket').from('tournament_entries')
              .upsert(entryRows, { onConflict: 'tournament_id,user_id' });
            if (upsertErr) throw upsertErr;
          }

          return res.status(200).json({ success: true, seeded: results.length, results });
        } catch (err) {
          console.error('stockmarket_seed_squads error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // TEMPORARY TEST TOOL — delete after testing. Enters each given
      // user into the live Predictions tournament (if not already) and
      // submits a random-but-valid prediction for every match in the
      // given gameweek, using the exact same submission shape a real
      // user's form would send.
      if (action === 'predictions_seed_entries') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: predTournamentId, user_ids: predUserIds, gameweek: predGw } = req.body;
        if (!predTournamentId || !Array.isArray(predUserIds) || predUserIds.length === 0 || !predGw) {
          return res.status(400).json({ error: 'tournament_id, user_ids (array), and gameweek are required' });
        }

        try {
          const { data: gwMatches } = await masterDb
            .from('matches').select('id, home_team, away_team').eq('gameweek', predGw);
          if (!gwMatches || gwMatches.length === 0) {
            return res.status(404).json({ error: `No fixtures found for GW${predGw}` });
          }

          const targetUserIds = predUserIds.filter(uid => uid !== user.id); // never touch your own predictions

          const { data: usersRows } = await supabaseAdmin.from('users').select('id, username').in('id', targetUserIds);
          const usernameById = {};
          (usersRows || []).forEach(u => { usernameById[u.id] = u.username; });

          // Batch-upsert every entry and every prediction in two calls
          // total instead of a per-user, per-match select-then-write loop
          // (30 users x 10 matches was ~660 sequential round trips — this
          // is what made seeding actually slow).
          const entryRows = targetUserIds.map(uid => ({
            tournament_id: predTournamentId, user_id: uid, username: usernameById[uid] || null, entry_points: 0
          }));
          if (entryRows.length > 0) {
            const { error: entryErr } = await supabaseAdmin
              .schema('predictions').from('tournament_entries')
              .upsert(entryRows, { onConflict: 'tournament_id,user_id', ignoreDuplicates: true });
            if (entryErr) throw entryErr;
          }

          const predictionRows = [];
          for (const uid of targetUserIds) {
            for (const m of gwMatches) {
              const outcome = ['H', 'D', 'A'][Math.floor(Math.random() * 3)];
              let homeScore, awayScore;
              if (outcome === 'H') { homeScore = 1 + Math.floor(Math.random() * 3); awayScore = Math.floor(Math.random() * homeScore); }
              else if (outcome === 'A') { awayScore = 1 + Math.floor(Math.random() * 3); homeScore = Math.floor(Math.random() * awayScore); }
              else { homeScore = awayScore = Math.floor(Math.random() * 3); }

              predictionRows.push({
                user_id: uid, match_id: m.id, gameweek: predGw, predicted_result: outcome,
                home_score: homeScore, away_score: awayScore,
                home_team: m.home_team, away_team: m.away_team, username: usernameById[uid] || null
              });
            }
          }

          if (predictionRows.length > 0) {
            const { error: predErr } = await supabaseAdmin
              .schema('predictions').from('predictions')
              .upsert(predictionRows, { onConflict: 'user_id,match_id' });
            if (predErr) throw predErr;
          }

          return res.status(200).json({ success: true, seeded: targetUserIds.length, matches: gwMatches.length });
        } catch (err) {
          console.error('predictions_seed_entries error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // TEMPORARY TEST TOOL — delete after testing. Enters each given
      // user into the live LMS tournament (if not already) and submits a
      // random pick from the given gameweek's fixtures, avoiding any team
      // that user has already picked in an earlier gameweek — same
      // no-reuse rule the real pick page enforces.
      if (action === 'lms_seed_entries') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: lmsTournamentId, user_ids: lmsUserIds, gameweek: lmsGw } = req.body;
        if (!lmsTournamentId || !Array.isArray(lmsUserIds) || lmsUserIds.length === 0 || !lmsGw) {
          return res.status(400).json({ error: 'tournament_id, user_ids (array), and gameweek are required' });
        }

        try {
          const { data: gwMatches } = await masterDb
            .from('matches').select('home_team, away_team').eq('gameweek', lmsGw);
          if (!gwMatches || gwMatches.length === 0) {
            return res.status(404).json({ error: `No fixtures found for GW${lmsGw}` });
          }
          const teamsThisWeek = [];
          gwMatches.forEach(m => { teamsThisWeek.push(m.home_team, m.away_team); });

          const targetUserIds = lmsUserIds.filter(uid => uid !== user.id); // never touch your own pick

          // Fetch everything needed in bulk (2 queries for up to 30 users)
          // instead of a per-user select-then-write loop — this is what
          // made seeding actually slow.
          const { data: existingEntries } = await supabaseAdmin
            .schema('lms').from('tournament_entries')
            .select('id, user_id, is_eliminated').eq('tournament_id', lmsTournamentId).in('user_id', targetUserIds);
          const entryByUser = {};
          (existingEntries || []).forEach(e => { entryByUser[e.user_id] = e; });

          const { data: allPastPicks } = await supabaseAdmin
            .schema('lms').from('picks')
            .select('user_id, team').eq('tournament_id', lmsTournamentId).in('user_id', targetUserIds).neq('gameweek', lmsGw);
          const pastPicksByUser = {};
          (allPastPicks || []).forEach(p => {
            if (!pastPicksByUser[p.user_id]) pastPicksByUser[p.user_id] = new Set();
            pastPicksByUser[p.user_id].add(p.team);
          });

          const newEntryRows = targetUserIds
            .filter(uid => !entryByUser[uid])
            .map(uid => ({ tournament_id: lmsTournamentId, user_id: uid, is_eliminated: false }));
          if (newEntryRows.length > 0) {
            const { error: entryErr } = await supabaseAdmin
              .schema('lms').from('tournament_entries')
              .upsert(newEntryRows, { onConflict: 'tournament_id,user_id', ignoreDuplicates: true });
            if (entryErr) throw entryErr;
          }

          const pickRows = [];
          const results = [];
          for (const uid of targetUserIds) {
            const entry = entryByUser[uid];
            if (entry && entry.is_eliminated) {
              results.push({ user_id: uid, skipped: 'already eliminated' });
              continue;
            }
            const alreadyUsed = pastPicksByUser[uid] || new Set();
            const eligible = teamsThisWeek.filter(t => !alreadyUsed.has(t));
            const pool = eligible.length > 0 ? eligible : teamsThisWeek; // fallback if genuinely nothing left
            const pick = pool[Math.floor(Math.random() * pool.length)];
            pickRows.push({ tournament_id: lmsTournamentId, user_id: uid, gameweek: lmsGw, team: pick });
            results.push({ user_id: uid, picked: pick });
          }

          if (pickRows.length > 0) {
            const { error: pickErr } = await supabaseAdmin
              .schema('lms').from('picks')
              .upsert(pickRows, { onConflict: 'tournament_id,user_id,gameweek' });
            if (pickErr) throw pickErr;
          }

          return res.status(200).json({ success: true, seeded: results.length, results });
        } catch (err) {
          console.error('lms_seed_entries error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // TEMPORARY TEST TOOL — delete after testing. Enters each given
      // user into the live Fantasy tournament (if not already) with a
      // valid random 15-player squad (2 GK, 5 DEF, 5 MID, 3 FWD) within
      // the real £100.0m budget, same rules the join action itself
      // enforces. Biases toward the cheaper half of each position's pool
      // so 15 random picks comfortably stay under budget without needing
      // a full optimizer — fine for test data, not trying to build
      // competitive squads.
      if (action === 'fantasy_seed_entries') {
        const { data: caller } = await supabaseAdmin.from('users').select('is_admin').eq('id', user.id).maybeSingle();
        if (!caller || !caller.is_admin) return res.status(403).json({ error: 'Admin access required' });

        const { tournament_id: fmTournamentId, user_ids: fmUserIds } = req.body;
        if (!fmTournamentId || !Array.isArray(fmUserIds) || fmUserIds.length === 0) {
          return res.status(400).json({ error: 'tournament_id and user_ids (array) are required' });
        }

        try {
          const { data: allPlayers } = await masterDb
            .from('players').select('id, element_type, now_cost').limit(700);
          const byPosition = { 1: [], 2: [], 3: [], 4: [] };
          (allPlayers || []).forEach(p => { if (byPosition[p.element_type]) byPosition[p.element_type].push(p); });
          Object.values(byPosition).forEach(pool => pool.sort((a, b) => (a.now_cost || 0) - (b.now_cost || 0)));

          const needed = { 1: 2, 2: 5, 3: 5, 4: 3 };

          const buildSquad = () => {
            const squad = [];
            const usedIds = new Set();
            for (const [type, count] of Object.entries(needed)) {
              const pool = byPosition[type];
              // Bias toward the cheaper half so 15 picks comfortably fit
              // the £100.0m budget without a full knapsack solve.
              const cheaperHalf = pool.slice(0, Math.max(count, Math.ceil(pool.length * 0.5)));
              const available = cheaperHalf.filter(p => !usedIds.has(p.id));
              const shuffled = [...available].sort(() => Math.random() - 0.5);
              for (let i = 0; i < count; i++) {
                const pick = shuffled[i % shuffled.length];
                squad.push(pick);
                usedIds.add(pick.id);
              }
            }
            return squad;
          };

          const targetUserIds = fmUserIds.filter(uid => uid !== user.id); // never touch your own squad
          const entryRows = [];
          const results = [];
          for (const uid of targetUserIds) {
            let squad = buildSquad();
            let totalCost = squad.reduce((sum, p) => sum + (p.now_cost || 0), 0);
            // Extremely unlikely with the cheaper-half bias, but re-roll
            // once if it somehow still went over budget rather than fail.
            if (totalCost > 1000) {
              squad = buildSquad();
              totalCost = squad.reduce((sum, p) => sum + (p.now_cost || 0), 0);
            }

            const squad_players = squad.map(p => p.id);
            const captain_id = squad_players[Math.floor(Math.random() * squad_players.length)];

            entryRows.push({
              tournament_id: fmTournamentId, user_id: uid, squad_players, captain_id,
              entered_at: new Date().toISOString(), entry_points: 0
            });
            results.push({ user_id: uid, squad_cost: (totalCost / 10).toFixed(1) });
          }

          // One batch upsert instead of a per-user select-then-write loop
          // (this is what made seeding actually slow).
          if (entryRows.length > 0) {
            const { error: upsertErr } = await supabaseAdmin
              .schema('fantasy').from('tournament_entries')
              .upsert(entryRows, { onConflict: 'tournament_id,user_id' });
            if (upsertErr) throw upsertErr;
          }

          return res.status(200).json({ success: true, seeded: results.length, results });
        } catch (err) {
          console.error('fantasy_seed_entries error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

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
                position: POSITION_KEY[p.element_type] || p.element_type,
                name: p.web_name,
                team: teamNameByIdForSquad[p.team] || '',
                value: 0,                // set once the market actually initializes
                acquired_gameweek: null, // set once the market actually initializes
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

            // Charge the entry fee to the user's wallet ledger — a "promise
            // to pay" record, not a real payment. No money moves here; this
            // just tracks what they now owe. Admin settles it later via the
            // Payments & Bookkeeping panel in /admin. Only fires on a truly
            // NEW entry (this branch), never when an existing entry is
            // updated (e.g. editing a Fantasy squad, drafting Stock Market)
            // — otherwise a user would be charged again every time they
            // saved changes to something they'd already entered.
            if (tournament.entry_fee && tournament.entry_fee > 0) {
              const { error: walletError } = await supabaseAdmin
                .from('wallet_transactions')
                .insert({
                  user_id: user.id,
                  type: 'entry_fee',
                  amount: tournament.entry_fee,
                  tournament_type: schemaName,
                  tournament_id: tournament_id,
                  description: `Entry fee — ${tournament.name}`
                });
              if (walletError) console.error('Failed to record wallet entry_fee charge:', walletError);
            }
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

      // Admin: upload a manually-sourced photo for a player whose FPL
      // photo is confirmed missing. Uploads to Supabase Storage (so it's
      // live immediately, no git commit/redeploy needed) and points that
      // player's photo at it from then on, everywhere in the app.
      if (action === 'upload_player_photo') {
        try {
          const authHeader = req.headers.authorization;
          if (!authHeader) return res.status(401).json({ error: 'Authentication required' });
          const token = authHeader.replace('Bearer ', '');
          const { data: { user: upUser }, error: upAuthError } = await supabaseAdmin.auth.getUser(token);
          if (upAuthError || !upUser) return res.status(401).json({ error: 'Invalid token' });
          const { data: upCaller } = await supabaseAdmin.from('users').select('is_admin').eq('id', upUser.id).maybeSingle();
          if (!upCaller || !upCaller.is_admin) return res.status(403).json({ error: 'Admin access required' });

          const { player_id: uploadPlayerId, image_base64, file_ext } = req.body;
          if (!uploadPlayerId || !image_base64) {
            return res.status(400).json({ error: 'player_id and image_base64 are required' });
          }
          const ext = (file_ext || 'png').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'png';
          const path = `${uploadPlayerId}.${ext}`;
          const buffer = Buffer.from(image_base64, 'base64');
          if (buffer.length > 5 * 1024 * 1024) {
            return res.status(400).json({ error: 'Image too large (5MB max)' });
          }

          const { error: uploadError } = await masterDb.storage
            .from('player-photos')
            .upload(path, buffer, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true });
          if (uploadError) {
            return res.status(500).json({ error: 'Upload failed', detail: uploadError.message });
          }

          const { data: publicUrlData } = masterDb.storage.from('player-photos').getPublicUrl(path);
          const publicUrl = publicUrlData.publicUrl;

          const { error: dbError } = await masterDb
            .from('players')
            .update({ custom_photo_url: publicUrl, photo_verified: true })
            .eq('id', uploadPlayerId);
          if (dbError) {
            return res.status(500).json({ error: 'Uploaded but failed to save to player record', detail: dbError.message });
          }

          return res.status(200).json({ ok: true, photo_url: publicUrl });
        } catch (err) {
          console.error('upload_player_photo error:', err);
          return res.status(500).json({ error: 'Failed to upload photo', detail: err.message });
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

          // Real deadline enforcement — independent of whether admin has
          // clicked Advance Gameweek yet. Locks the moment this
          // gameweek's matches actually start, not at next kickoff.
          // test_bypass_deadline is an explicit, visible, per-tournament
          // opt-in for testing against historical data (where every real
          // "next kickoff" is already in the past) — off by default, so
          // it can never silently disable enforcement on a real tournament.
          if (currentGW) {
            const windowCheck = await isStockMarketTransferWindowOpen(masterDb, supabaseAdmin, tournament_id, currentGW);
            if (!windowCheck.open) {
              return res.status(403).json({ error: windowCheck.reason });
            }
          }

          const squad = entry.squad_players || [];
          const sellIdx = squad.findIndex(s => s.player_id === player_id);
          if (sellIdx === -1) return res.status(404).json({ error: 'That player is not in your squad' });
          if (squad[sellIdx].empty) return res.status(400).json({ error: 'That slot is already empty' });

          // Their own current value — nothing shared, this is entirely
          // theirs, from their own actions and match results so far.
          const soldValue = squad[sellIdx].value || 0;
          const soldName = squad[sellIdx].name || null;
          const positionKey = POSITION_KEY[squad[sellIdx].position] || squad[sellIdx].position;

          squad[sellIdx] = { empty: true, position: positionKey, reserved_value: soldValue };

          const newTotal = await recomputeEntryValue(supabaseAdmin, tournament_id, squad);
          await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .update({ squad_players: squad, last_transfer_gameweek: currentGW, current_value: newTotal })
            .eq('id', entry.id);

          const { error: sellLogErr } = await supabaseAdmin.schema('stockmarket').from('transactions').insert({
            tournament_id, entry_id: entry.id, gameweek: currentGW, type: 'sell',
            player_id, player_name: soldName, position: positionKey, amount: soldValue
          });
          if (sellLogErr) console.error('[TRANSACTION LOG FAILED - sell]', sellLogErr.message);

          return res.status(200).json({ success: true, sold_for: soldValue });
        } catch (err) {
          console.error('stockmarket_sell error:', err);
          return res.status(500).json({ error: err.message });
        }
      }

      // Buy a replacement to fill an empty slot after a sale. Fee comes
      // out of the reserve first, then the rest of your own squad if the
      // reserve doesn't cover it — but the fee itself doesn't stay in your
      // economy at all. It leaves your squad entirely and spreads as a
      // tiny, visible bump across every OTHER entrant's players in the
      // tournament — a real, felt cost for upgrading, not an internal shuffle.
      if (action === 'stockmarket_buy_replacement') {
        try {
          if (!tournament_id || !player_id || !position) {
            return res.status(400).json({ error: 'tournament_id, player_id and position are required' });
          }

          const { data: entry, error: entryError } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('*').eq('tournament_id', tournament_id).eq('user_id', user.id).maybeSingle();
          if (entryError || !entry) return res.status(404).json({ error: 'Entry not found' });

          // Same real deadline enforcement as sell — independent of
          // whether admin has advanced the clock yet. Same explicit,
          // opt-in test bypass as sell — off by default.
          const { data: clockForDeadline } = await masterDb.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle();
          const currentGWForDeadline = clockForDeadline ? clockForDeadline.current_gameweek : null;
          if (currentGWForDeadline) {
            const windowCheckBuy = await isStockMarketTransferWindowOpen(masterDb, supabaseAdmin, tournament_id, currentGWForDeadline);
            if (!windowCheckBuy.open) {
              return res.status(403).json({ error: windowCheckBuy.reason });
            }
          }

          const squad = entry.squad_players || [];
          const emptyIdx = squad.findIndex(s => s.empty && s.position === position);
          if (emptyIdx === -1) {
            const squadDebug = squad.map(s => s.empty ? { empty: true, position: s.position } : { player_id: s.player_id, position: s.position });
            console.log('[NO EMPTY SLOT DEBUG]', JSON.stringify({ requestedPosition: position, squad: squadDebug }));
            return res.status(400).json({ error: `No empty ${position} slot to fill`, debug: { requestedPosition: position, squad: squadDebug } });
          }

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

          const reservedValue = squad[emptyIdx].reserved_value || 0;

          // Fill the slot. Starting value = whatever was reserved from the
          // sale, minus this pack's fee.
          squad[emptyIdx] = {
            player_id,
            position,
            name: playerRow.web_name,
            team: teamName,
            value: Math.max(0, reservedValue - packFee),
            acquired_gameweek: currentGW,
            is_sub: false
          };

          // If the reserve didn't cover the fee, the shortfall comes out
          // of your own other players too.
          const shortfall = Math.max(0, packFee - reservedValue);
          if (shortfall > 0) {
            const others = squad.filter((s, i) => i !== emptyIdx && !s.empty && !s.is_sub);
            if (others.length > 0) {
              const share = Math.ceil(shortfall / others.length);
              others.forEach(o => { o.value = Math.max(0, (o.value || 0) - share); });
            }
          }

          // The fee itself leaves your squad's economy entirely and
          // spreads as a small, real bump across every OTHER entrant's
          // own players — a genuine tournament-wide cost for upgrading,
          // not an internal shuffle. Distributed pence-exact: no leak,
          // however many entrants or players it's split across.
          const { data: otherEntries } = await supabaseAdmin
            .schema('stockmarket').from('tournament_entries')
            .select('id, squad_players').eq('tournament_id', tournament_id).neq('user_id', user.id).eq('squad_locked', true).eq('relegated', false);

          let feeRecipients = 0;
          if (otherEntries && otherEntries.length > 0 && packFee > 0) {
            // Flatten to one list of every player across every other
            // entrant — dividing once across this flat list (instead of
            // per-entry then per-player) is what avoids the double-floor
            // leak. Any leftover pence from the division go to the first
            // few players in the list, so the full fee always lands
            // exactly, to the penny, every single time.
            const allOtherPlayers = [];
            otherEntries.forEach(other => {
              (other.squad_players || []).filter(s => !s.empty).forEach(s => allOtherPlayers.push({ entry: other, slot: s }));
            });

            if (allOtherPlayers.length > 0) {
              const baseShare = Math.floor(packFee / allOtherPlayers.length);
              const remainder = packFee - (baseShare * allOtherPlayers.length);
              allOtherPlayers.forEach((item, i) => {
                const bump = baseShare + (i < remainder ? 1 : 0);
                item.slot.value = (item.slot.value || 0) + bump;
                item.slot.fee_bump = bump;
              });
              feeRecipients = allOtherPlayers.length;

              for (const other of otherEntries) {
                const otherSquad = other.squad_players || [];
                const otherTotal = Math.round(otherSquad.reduce((sum, s) => sum + (s.empty ? (s.reserved_value || 0) : (s.value || 0)), 0));
                await supabaseAdmin.schema('stockmarket').from('tournament_entries')
                  .update({ squad_players: otherSquad, current_value: otherTotal }).eq('id', other.id);
              }
            }
          }

          const newTotal = await recomputeEntryValue(supabaseAdmin, tournament_id, squad);
          await supabaseAdmin.schema('stockmarket').from('tournament_entries')
            .update({ squad_players: squad, current_value: newTotal }).eq('id', entry.id);

          const { error: buyLogErr } = await supabaseAdmin.schema('stockmarket').from('transactions').insert({
            tournament_id, entry_id: entry.id, gameweek: currentGW, type: 'buy',
            player_id, player_name: playerRow.web_name, position, amount: -packFee,
            pack_type, shortfall, fee_recipients: feeRecipients
          });
          if (buyLogErr) console.error('[TRANSACTION LOG FAILED - buy]', buyLogErr.message);

          return res.status(200).json({ success: true, pack_fee: packFee, shortfall, fee_recipients: feeRecipients });
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

    // Same as LMS: a match being live/finished means the gameweek has
    // genuinely started, even if the real-world kickoff_time (which only
    // matters once the real season runs) hasn't passed yet.
    const anyMatchStarted = gwMatches.some(m => m.status === 'live' || m.status === 'finished');
    const deadlinePassed = anyMatchStarted || (earliestKickoffMs !== null && Date.now() >= earliestKickoffMs);
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

    // Real kickoff time passing is the normal signal — but during
    // testing, matches get marked 'live'/'finished' directly without
    // their real kickoff_time (still weeks away for the real season)
    // ever actually passing. Either signal being true means the same
    // thing: this gameweek has genuinely started, so treat them as
    // equivalent rather than let a stale real-world timestamp block
    // eliminations that clearly should already be resolvable.
    const anyMatchStarted = gwMatches.some(m => m.status === 'live' || m.status === 'finished');
    const deadlinePassed = anyMatchStarted || (earliestKickoffMs !== null && Date.now() >= earliestKickoffMs);
    const deadlineEpoch = earliestKickoffMs !== null ? Math.floor(earliestKickoffMs / 1000) : null;

    if (!deadlinePassed) {
      return { locked: false, gameweek: currentGW, deadline_epoch: deadlineEpoch, reason: null };
    }

    const allFinished = gwMatches.every(m => m.status === 'finished');

    // Picks get resolved progressively as each match finishes — a user
    // whose team's match is done already knows their fate, same as a
    // real LMS. Round completion (declaring a winner or split pot) still
    // waits for every match, since that can't be decided safely early.
    if (tournamentId && supabaseAdmin) {
      await updateLmsPicksForGameweek(masterDb, supabaseAdmin, tournamentId, currentGW);
      if (allFinished) {
        await finalizeLmsRoundIfComplete(supabaseAdmin, tournamentId, currentGW);
      }
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
// Progressive — checks whichever picks CAN be resolved right now, based
// on whatever matches have actually finished, regardless of whether the
// rest of the gameweek is done. A pick for a team whose match hasn't
// happened yet stays pending (neither eliminated nor confirmed safe).
// This is what lets a user see "you're out" the moment their own team's
// result is known, instead of waiting for every other match in the
// gameweek to finish too — matches how a real LMS actually works.
async function updateLmsPicksForGameweek(masterDb, supabaseAdmin, tournamentId, gameweek) {
  const result = { newly_eliminated: 0 };
  try {
    const { data: finishedMatches, error: finishedErr } = await masterDb
      .from('matches')
      .select('home_team, away_team, home_score, away_score')
      .eq('gameweek', gameweek)
      .eq('status', 'finished');
    console.log(`[LMS_UPDATE] tournament=${tournamentId} gw=${gameweek}: finishedMatches=${finishedMatches ? finishedMatches.length : 'null'}, error=${finishedErr ? finishedErr.message : 'none'}`);
    if (!finishedMatches || finishedMatches.length === 0) return result;

    // A draw eliminates both teams' backers — nobody "won" that pick.
    const decidedTeams = new Map();
    finishedMatches.forEach(m => {
      if (m.home_score > m.away_score) { decidedTeams.set(m.home_team, true); decidedTeams.set(m.away_team, false); }
      else if (m.away_score > m.home_score) { decidedTeams.set(m.away_team, true); decidedTeams.set(m.home_team, false); }
      else { decidedTeams.set(m.home_team, false); decidedTeams.set(m.away_team, false); }
    });

    const { data: entries, error: entriesErr } = await supabaseAdmin
      .schema('lms').from('tournament_entries')
      .select('id, user_id')
      .eq('tournament_id', tournamentId)
      .eq('is_eliminated', false);
    console.log(`[LMS_UPDATE] tournament=${tournamentId} gw=${gameweek}: alive entries=${entries ? entries.length : 'null'}, error=${entriesErr ? entriesErr.message : 'none'}`);
    if (!entries || entries.length === 0) return result;

    const { data: picks, error: picksErr } = await supabaseAdmin
      .schema('lms').from('picks')
      .select('user_id, team')
      .eq('tournament_id', tournamentId)
      .eq('gameweek', gameweek);
    console.log(`[LMS_UPDATE] tournament=${tournamentId} gw=${gameweek}: picks=${picks ? picks.length : 'null'}, error=${picksErr ? picksErr.message : 'none'}`);
    const pickByUser = new Map((picks || []).map(p => [p.user_id, p.team]));

    let checkedCount = 0, skippedNoPick = 0, skippedNotDecided = 0, survivedCount = 0;
    const idsToEliminate = [];
    for (const entry of entries) {
      checkedCount++;
      const pickedTeam = pickByUser.get(entry.user_id);
      if (!pickedTeam) { skippedNoPick++; continue; }
      if (!decidedTeams.has(pickedTeam)) { skippedNotDecided++; continue; }
      if (decidedTeams.get(pickedTeam) === false) {
        idsToEliminate.push(entry.id);
      } else {
        survivedCount++;
      }
    }
    // One batch update instead of one .update() call per eliminated entry.
    if (idsToEliminate.length > 0) {
      const { error } = await supabaseAdmin
        .schema('lms').from('tournament_entries')
        .update({ is_eliminated: true, eliminated_gameweek: gameweek })
        .in('id', idsToEliminate);
      if (!error) result.newly_eliminated = idsToEliminate.length;
      else console.error(`Failed to eliminate entries:`, error);
    }
    console.log(`[LMS_UPDATE] tournament=${tournamentId} gw=${gameweek}: checked=${checkedCount}, skippedNoPick=${skippedNoPick}, skippedNotDecided=${skippedNotDecided}, survived=${survivedCount}, eliminated=${result.newly_eliminated}`);
  } catch (error) {
    console.error('updateLmsPicksForGameweek error:', error);
  }
  return result;
}

// Round completion — genuinely does need the whole gameweek finished,
// unlike individual pick resolution above: declaring a winner (or a
// split pot) prematurely, before every pick's fate is actually known,
// could crown someone before a still-pending match rules them out too.
// Eliminations themselves have already been applied progressively by the
// function above by the time this runs — this only ever checks how many
// survivors are left and finalizes the tournament if appropriate.
async function finalizeLmsRoundIfComplete(supabaseAdmin, tournamentId, gameweek) {
  try {
    // Same atomic-claim pattern as before — only one concurrent request
    // can actually process a given gameweek's round completion.
    const { data: claimed, error: claimError } = await supabaseAdmin
      .schema('lms').from('tournaments')
      .update({ last_processed_gameweek: gameweek })
      .eq('id', tournamentId)
      .neq('status', 'finished')
      .or(`last_processed_gameweek.is.null,last_processed_gameweek.lt.${gameweek}`)
      .select('id, entry_fee')
      .maybeSingle();

    if (claimError) {
      console.error('finalizeLmsRoundIfComplete claim error:', claimError);
      return;
    }
    if (!claimed) return; // already claimed, or tournament already finished

    const { count: entryCount, error: countError } = await supabaseAdmin
      .schema('lms').from('tournament_entries')
      .select('id', { count: 'exact', head: true })
      .eq('tournament_id', tournamentId);
    if (countError) console.error('finalizeLmsRoundIfComplete entry count error:', countError);

    const prizePool = (claimed.entry_fee || 0) * (entryCount || 0);

    const { data: survivors, error: survivorsErr } = await supabaseAdmin
      .schema('lms').from('tournament_entries')
      .select('id')
      .eq('tournament_id', tournamentId)
      .eq('is_eliminated', false);
    if (survivorsErr) { console.error('finalizeLmsRoundIfComplete survivors error:', survivorsErr); return; }

    if (survivors && survivors.length === 1) {
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

    } else if (survivors && survivors.length === 0) {
      // Everyone went out — split the pot among whoever was eliminated
      // specifically THIS gameweek (not everyone ever eliminated), same
      // as the original rule, just identified by eliminated_gameweek
      // instead of a snapshot taken before processing started, since
      // eliminations now happen progressively rather than all at once.
      const { data: eliminatedThisRound } = await supabaseAdmin
        .schema('lms').from('tournament_entries')
        .select('id')
        .eq('tournament_id', tournamentId)
        .eq('eliminated_gameweek', gameweek);

      const pool = eliminatedThisRound || [];
      const share = pool.length > 0 ? Math.floor(prizePool / pool.length) : 0;
      for (const entry of pool) {
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
    console.error('finalizeLmsRoundIfComplete error:', error);
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
  const debug = [];
  try {
    const { data: tournament, error: tErr } = await supabaseAdmin
      .schema('stockmarket').from('tournaments')
      .select('id, status, closes_at, end_gameweek, gameweek, last_processed_gameweek')
      .eq('id', tournamentId)
      .maybeSingle();

    debug.push(`tournament fetch: ${tErr ? 'ERROR ' + tErr.message : JSON.stringify(tournament)}`);

    if (!tournament) {
      debug.push('BLOCKED: tournament not found');
      console.log('[SM DEBUG]', debug.join(' | '));
      return { locked: false, drafting: false, reason: 'Tournament not found.', debug };
    }

    if (tournament.status === 'finished') {
      debug.push('BLOCKED: tournament status is finished');
      console.log('[SM DEBUG]', debug.join(' | '));
      return { locked: true, drafting: false, marketLive: false, finished: true, reason: 'This market has closed.', debug };
    }

    if (tournament.status !== 'live') {
      const deadlinePassed = tournament.closes_at && Date.now() >= new Date(tournament.closes_at).getTime();
      debug.push(`status=${tournament.status}, closes_at=${tournament.closes_at}, now=${new Date().toISOString()}, deadlinePassed=${deadlinePassed}`);
      if (!deadlinePassed) {
        debug.push('BLOCKED: still drafting, deadline not passed');
        console.log('[SM DEBUG]', debug.join(' | '));
        return { locked: false, drafting: true, marketLive: false, closes_at: tournament.closes_at, reason: null, debug };
      }
      debug.push('Deadline passed — initializing market now');
      console.log('[SM DEBUG]', debug.join(' | '));
      await initializeStockMarket(supabaseAdmin, masterDb, tournamentId);
      return { locked: true, drafting: false, marketLive: true, reason: 'Draft closed — the market is now live.', debug };
    }

    // Market is live — check whether this gameweek's matches have all
    // finished, and if so (and not already processed), run price processing.
    const { data: clock, error: clockErr } = await masterDb
      .from('master_clock')
      .select('current_gameweek')
      .eq('id', 'current')
      .maybeSingle();

    debug.push(`clock fetch: ${clockErr ? 'ERROR ' + clockErr.message : JSON.stringify(clock)}`);

    if (!clock || !clock.current_gameweek) {
      debug.push('BLOCKED: master clock not set');
      console.log('[SM DEBUG]', debug.join(' | '));
      return { locked: false, drafting: false, marketLive: true, gameweek: null, reason: 'Master clock not set yet.', debug };
    }

    const currentGW = Number(clock.current_gameweek);
    debug.push(`currentGW=${currentGW} (type ${typeof clock.current_gameweek} raw, coerced to Number), tournament.gameweek=${tournament.gameweek} (type ${typeof tournament.gameweek})`);

    if (tournament.gameweek && currentGW < Number(tournament.gameweek)) {
      debug.push(`BLOCKED: currentGW ${currentGW} < tournament start ${tournament.gameweek}`);
      console.log('[SM DEBUG]', debug.join(' | '));
      return { locked: false, drafting: false, marketLive: true, gameweek: tournament.gameweek, reason: `Market starts processing from Gameweek ${tournament.gameweek}.`, debug };
    }

    // Pair everyone up as soon as the gameweek begins — well before
    // results come in, so a user can see who they're facing this week
    // immediately, not just after the numbers already moved.
    await ensureMatchupsForGameweek(supabaseAdmin, tournamentId, currentGW);

    const { data: gwMatches, error: matchErr } = await masterDb
      .from('matches')
      .select('status, kickoff_time')
      .eq('gameweek', currentGW);

    debug.push(`matches fetch for gameweek=${currentGW}: ${matchErr ? 'ERROR ' + matchErr.message : `${(gwMatches || []).length} rows, statuses: ${(gwMatches || []).map(m => m.status).join(',')}`}`);

    const allFinished = gwMatches && gwMatches.length > 0 && gwMatches.every(m => m.status === 'finished');
    debug.push(`allFinished=${allFinished}`);

    if (allFinished) {
      // Relegation now fires here, gated by the SAME "this gameweek's
      // matches have actually finished" check settlement uses — not on
      // the raw clock number alone. Previously this ran unconditionally
      // the instant the clock reached a stage's trigger_gameweek, which
      // meant advancing the clock could relegate people using the
      // PREVIOUS gameweek's stale values, before anything about the
      // current gameweek had actually happened. Must still run BEFORE
      // settlement so newly-relegated entries never show up in this
      // gameweek's processing.
      await applyDueStages(supabaseAdmin, tournamentId, currentGW);

      debug.push(`last_processed_gameweek BEFORE claim attempt = ${tournament.last_processed_gameweek}`);
      console.log('[SM DEBUG]', debug.join(' | '));
      const processResult = await processHeadToHeadGameweek(supabaseAdmin, masterDb, tournamentId, currentGW);
      debug.push(`processStockMarketGameweek returned: ${JSON.stringify(processResult)}`);
      console.log('[SM DEBUG post-process]', debug.join(' | '));
    } else {
      console.log('[SM DEBUG]', debug.join(' | '));
    }

    return { locked: false, drafting: false, marketLive: true, gameweek: currentGW, processed: allFinished, debug };
  } catch (error) {
    debug.push(`EXCEPTION: ${error.message}`);
    console.error('[SM DEBUG EXCEPTION]', debug.join(' | '), error);
    return { locked: false, drafting: false, marketLive: false, reason: null, debug, error: error.message };
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
    const slotValue = Math.floor((tournament.entry_fee || 0) / 6); // per-player baseline, same for everyone regardless of who else drafted them

    await supabaseAdmin.schema('stockmarket').from('config')
      .upsert({ tournament_id: tournamentId, slot_value: slotValue }, { onConflict: 'tournament_id' });

    const startingValue = 6 * slotValue;
    for (const entry of entries) {
      const stampedSquad = (entry.squad_players || []).map(p => ({
        ...p,
        acquired_gameweek: tournament.gameweek,
        is_sub: p.is_sub || false,
        value: slotValue // each player's own independent value — nothing shared
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

    console.log(`Stock Market ${tournamentId} initialized: ${entries.length} entrants, slot value ${slotValue}p each, head-to-head model`);
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
// Tiers by real FPL valuation (now_cost, tenths of £m) rather than
// season points. Points-based tiers are empty by definition at the start
// of every season — real or test — since nobody has points yet; cost is
// meaningful from day one and doesn't need the season to have progressed.
// Thresholds are per-position because forwards/midfielders start ~£0.5m
// pricier than defenders/keepers in real FPL — one flat range across all
// four positions left Bronze completely empty for FWD and MID, confirmed
// against the real cost distribution rather than assumed.
const RARITY_THRESHOLDS = {
  gk:  { Bronze: { min: 0, max: 44 }, Silver: { min: 45, max: 49 }, Gold: { min: 50, max: 9999 } },
  def: { Bronze: { min: 0, max: 44 }, Silver: { min: 45, max: 49 }, Gold: { min: 50, max: 9999 } },
  mid: { Bronze: { min: 0, max: 49 }, Silver: { min: 50, max: 54 }, Gold: { min: 55, max: 9999 } },
  fwd: { Bronze: { min: 0, max: 49 }, Silver: { min: 50, max: 59 }, Gold: { min: 60, max: 9999 } }
};

// How many of each rarity/position slot a STARTER pack offers, scaled
// down from the original 16-man matrix for a 6-man squad.
const STARTER_PACK_MATRIX = {
  Bronze: { gk: 2, def: 4, mid: 3, fwd: 2 },
  Silver: { gk: 1, def: 2, mid: 2, fwd: 1 },
  Gold: { gk: 0, def: 1, mid: 1, fwd: 1 }
};

// Public-facing pages (leaderboard, opponent view, player history) show
// this instead of raw email addresses — data protection. Admin-only
// exports still use real email, since that's needed to actually pay
// people.
function pickDisplayName(u) {
  if (!u) return 'Player';
  return u.display_name || u.username || 'Player';
}

const POSITION_KEY = { 1: 'gk', 2: 'def', 3: 'mid', 4: 'fwd' };

// ================= HEAD-TO-HEAD MODEL =================
// Every player's own actions affect only that player's own value —
// nothing shared, nothing pooled. The head-to-head layer is a pure
// transfer between two matched squads: whatever one gains, the other
// loses, by construction — guaranteed zero-sum, no rounding-drift
// corrections needed anywhere.
const FLAT_REWARDS = {
  goal: 300, assist: 150, yellow_card: -150, red_card: -300,
  clean_sheet: 125, save: 30, save_cap: 5,
  gk_goal_conceded: -75, gk_goal_conceded_cap: 4,
  outfield_goal_conceded: -75, outfield_goal_conceded_cap: 4
  // No position-based bonus on goals/assists — flat rate for every
  // position. The cost multiplier (climbing 1x -> 2x -> 3x -> 4x across
  // relegation stages) is what's meant to drive bigger swings later in
  // the tournament, not position weighting.
};

// Computes one player's own raw value change for the gameweek, floored
// so a single slot's own actions never push them below zero. Also
// returns whether they had a "negative" week (cards/conceded), needed
// later to decide who pays first when their squad loses.
function computePlayerRawChange(position, stats, currentValue) {
  let delta = 0;
  let hadNegative = false;

  const goals = Math.min(stats.goals_scored || 0, 99);
  const assists = Math.min(stats.assists || 0, 99);
  if (goals > 0) delta += goals * FLAT_REWARDS.goal;
  if (assists > 0) delta += assists * FLAT_REWARDS.assist;
  if ((stats.yellow_cards || 0) > 0) { delta += stats.yellow_cards * FLAT_REWARDS.yellow_card; hadNegative = true; }
  if ((stats.red_cards || 0) > 0) { delta += stats.red_cards * FLAT_REWARDS.red_card; hadNegative = true; }

  if (position === 'gk') {
    if ((stats.clean_sheets || 0) > 0) delta += FLAT_REWARDS.clean_sheet;
    const cappedSaves = Math.min(stats.saves || 0, FLAT_REWARDS.save_cap);
    if (cappedSaves > 0) delta += cappedSaves * FLAT_REWARDS.save;
    const cappedConceded = Math.min(stats.goals_conceded || 0, FLAT_REWARDS.gk_goal_conceded_cap);
    if (cappedConceded > 0) { delta += cappedConceded * FLAT_REWARDS.gk_goal_conceded; hadNegative = true; }
  } else {
    if ((stats.team_goals_conceded || 0) > 0) {
      delta += stats.team_goals_conceded * FLAT_REWARDS.outfield_goal_conceded;
      hadNegative = true;
    }
  }

  const newValue = Math.max(0, currentValue + delta);
  const actualChange = newValue - currentValue;
  return { newValue, rawDelta: delta, actualChange, hadNegative };
}

// Breaks one player's gameweek into separate categorized amounts, so the
// settlement can process them in strict priority order (goals, then
// assists, then saves, then clean sheets) when the funding squad doesn't
// have enough to cover everything.
function computePlayerEventBreakdown(position, stats, costMultiplier, rewardsOverride) {
  const R = rewardsOverride || FLAT_REWARDS;
  const mult = costMultiplier || 1;
  const goals = Math.min(stats.goals_scored || 0, 99);
  const assists = Math.min(stats.assists || 0, 99);
  const goalRate = R.goal;
  const assistRate = R.assist;
  const goalAmt = Math.round(goals * goalRate * mult);
  const assistAmt = Math.round(assists * assistRate * mult);
  const yellowAmt = Math.round((stats.yellow_cards || 0) * R.yellow_card * mult);
  const redAmt = Math.round((stats.red_cards || 0) * R.red_card * mult);
  let cleanSheetAmt = 0, saveAmt = 0, concededAmt = 0;
  if (position === 'gk') {
    if ((stats.clean_sheets || 0) > 0) cleanSheetAmt = Math.round(R.clean_sheet * mult);
    const cappedSaves = Math.min(stats.saves || 0, R.save_cap);
    saveAmt = Math.round(cappedSaves * R.save * mult);
    const cappedConceded = Math.min(stats.goals_conceded || 0, R.gk_goal_conceded_cap);
    concededAmt = Math.round(cappedConceded * R.gk_goal_conceded * mult);
  } else {
    const cappedTeamConceded = Math.min(stats.team_goals_conceded || 0, R.outfield_goal_conceded_cap);
    concededAmt = Math.round(cappedTeamConceded * R.outfield_goal_conceded * mult);
  }
  return { goalAmt, assistAmt, saveAmt, cleanSheetAmt, yellowAmt, redAmt, concededAmt };
}

// The one, unified settlement mechanic — used identically for the live,
// provisional view AND the real, final, persisted result. A player's own
// events apply directly and fund/are funded by the opponent squad,
// evenly, in strict priority order (goals, assists, saves, clean sheets)
// so that if the funding squad runs short, the least important category
// gets shortchanged first, never goals. Negative events (cards, team
// conceded) apply directly too, floored at the player's own value, and
// credit the other squad. Provably zero-sum for the pair, event by
// event, by construction.
function prepSquadForSettlement(squad, statsByPid, concededByTeam, costMultiplier, rewardsOverride) {
  return squad.filter(s => !s.empty).map(s => {
    const stats = statsByPid[s.player_id] || {};
    // Prefer the team snapshotted at the moment these stats were synced
    // (immune to any later transfer) — fall back to the squad's own
    // stored team only for older rows synced before this snapshot existed.
    const effectiveTeam = stats.team || s.team;
    const teamConceded = concededByTeam[effectiveTeam] || 0;
    const events = s.is_sub
      ? { goalAmt: 0, assistAmt: 0, saveAmt: 0, cleanSheetAmt: 0, yellowAmt: 0, redAmt: 0, concededAmt: 0 }
      : computePlayerEventBreakdown(s.position, { ...stats, team_goals_conceded: teamConceded }, costMultiplier, rewardsOverride);
    return {
      ...s, liveValue: Math.round(s.value || 0), events,
      gwStats: {
        goals: stats.goals_scored || 0, assists: stats.assists || 0, yellow_cards: stats.yellow_cards || 0,
        red_cards: stats.red_cards || 0, clean_sheets: stats.clean_sheets || 0,
        goals_conceded: s.position === 'gk' ? (stats.goals_conceded || 0) : teamConceded, saves: stats.saves || 0
      },
      received: 0, paid: 0, shortBy: 0, benched: !!s.is_sub,
      ownEventReceived: 0, ownEventPaid: 0 // this player's OWN events only — not funding credits from the opponent
    };
  });
}

// Settles one matchup pair using already-prepped player objects (mutated
// in place). A player's own event funds directly from the opponent's
// capacity only — if the opponent can't cover it in full, the shortfall
// is real and gets flagged, not covered by anyone else.
function settleUnified(provA, provB) {
  const distributeExact = (funders, amount) => {
    const n = funders.length;
    if (n === 0 || amount === 0) return;
    const base = Math.trunc(amount / n);
    const remainder = amount - base * n;
    const sign = remainder > 0 ? 1 : (remainder < 0 ? -1 : 0);
    funders.forEach((o, i) => {
      const extra = i < Math.abs(remainder) ? sign : 0;
      const debit = base + extra;
      o.liveValue = Math.round(o.liveValue - debit);
      if (debit > 0) o.paid = (o.paid || 0) + debit;
      else o.received = (o.received || 0) + (-debit);
    });
  };

  let capacityA = provA.reduce((s, p) => s + p.liveValue, 0);
  let capacityB = provB.reduce((s, p) => s + p.liveValue, 0);

  const fundEvent = (p, amt, opponentPool, getOppCapacity, setOppCapacity) => {
    const actual = Math.min(amt, Math.max(0, getOppCapacity()));
    if (actual > 0) {
      p.liveValue = Math.round(p.liveValue + actual);
      p.received = (p.received || 0) + actual;
      p.ownEventReceived = (p.ownEventReceived || 0) + actual;
      distributeExact(opponentPool, actual);
      setOppCapacity(getOppCapacity() - actual);
    }
    if (actual < amt) p.shortBy += (amt - actual);
  };

  const priorityKeys = ['goalAmt', 'assistAmt', 'saveAmt', 'cleanSheetAmt'];
  for (const key of priorityKeys) {
    provA.forEach(p => {
      const amt = p.events[key];
      if (!amt || amt <= 0) return;
      fundEvent(p, amt, provB, () => capacityB, (v) => { capacityB = v; });
    });
    provB.forEach(p => {
      const amt = p.events[key];
      if (!amt || amt <= 0) return;
      fundEvent(p, amt, provA, () => capacityA, (v) => { capacityA = v; });
    });
  }

  const applyNegative = (mySide, otherSide) => {
    mySide.forEach(p => {
      const negTotal = (p.events.yellowAmt || 0) + (p.events.redAmt || 0) + (p.events.concededAmt || 0);
      if (negTotal >= 0) return;
      const actualLoss = Math.min(-negTotal, p.liveValue);
      p.liveValue = Math.round(p.liveValue - actualLoss);
      p.paid = (p.paid || 0) + actualLoss;
      p.ownEventPaid = (p.ownEventPaid || 0) + actualLoss; // this IS this player's own event
      distributeExact(otherSide, -actualLoss);
    });
  };
  applyNegative(provA, provB);
  applyNegative(provB, provA);
}

// Convenience wrapper for the LIVE view (just the two matched squads).
function computeUnifiedSettlement(squadA, squadB, statsByPid, concededByTeam, costMultiplier) {
  const provA = prepSquadForSettlement(squadA, statsByPid, concededByTeam, costMultiplier);
  const provB = prepSquadForSettlement(squadB, statsByPid, concededByTeam, costMultiplier);
  settleUnified(provA, provB);
  return { provA, provB };
}
const POSITION_ELEMENT_TYPE = { gk: 1, def: 2, mid: 3, fwd: 4 };

function recomputeEntryValue(supabaseAdmin, tournamentId, squad) {
  return Math.round(squad.reduce((sum, s) => sum + (s.empty ? (s.reserved_value || 0) : (s.value || 0)), 0));
}

async function getTeamGoalsConcededMap(masterDb, gameweek) {
  const { data: matches } = await masterDb.from('matches').select('home_team, away_team, home_score, away_score, status').eq('gameweek', gameweek);
  const map = {};
  (matches || []).forEach(m => {
    // Only count matches that have actually started — staged scores sit
    // on 'upcoming' matches in the test rig, and in production a score
    // only exists once a game is genuinely underway. Final settlement is
    // unaffected: it only ever runs once every match is 'finished'.
    if (m.status !== 'live' && m.status !== 'finished') return;
    map[m.home_team] = m.away_score || 0;
    map[m.away_team] = m.home_score || 0;
  });
  return map;
}

// Pairs everyone up for a gameweek as soon as it begins — before any
// real match has kicked off, let alone finished. This is what lets a
// user see WHO they're facing before any scores come in, same as a
// real head-to-head league. Idempotent: safe to call every reload,
// only actually creates rows the first time for a given gameweek.
async function ensureMatchupsForGameweek(supabaseAdmin, tournamentId, gameweek) {
  const { data: existing } = await supabaseAdmin
    .schema('stockmarket').from('matchups')
    .select('id').eq('tournament_id', tournamentId).eq('gameweek', gameweek).limit(1);
  if (existing && existing.length > 0) return { ok: true, alreadyPaired: true };

  const { data: entries } = await supabaseAdmin
    .schema('stockmarket').from('tournament_entries')
    .select('id').eq('tournament_id', tournamentId).eq('squad_locked', true).eq('relegated', false);
  if (!entries || entries.length === 0) return { ok: false, step: 'no entries' };

  const pool = entries.map(e => e.id);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const rows = [];
  for (let i = 0; i < pool.length - 1; i += 2) {
    rows.push({ tournament_id: tournamentId, gameweek, entry_id_1: pool[i], entry_id_2: pool[i + 1], settled: false });
  }
  // Odd one out gets a bye — still worth a row so it's visible as "no
  // opponent this week" rather than indistinguishable from an error.
  if (pool.length % 2 === 1) {
    rows.push({ tournament_id: tournamentId, gameweek, entry_id_1: pool[pool.length - 1], entry_id_2: null, settled: true });
  }

  if (rows.length > 0) {
    const { error } = await supabaseAdmin.schema('stockmarket').from('matchups').insert(rows);
    if (error) { console.error('ensureMatchupsForGameweek insert failed:', error); return { ok: false, step: 'insert', error: error.message }; }
  }
  return { ok: true, alreadyPaired: false, pairs: rows.length };
}

async function processHeadToHeadGameweek(supabaseAdmin, masterDb, tournamentId, gameweek) {
  const { data: claimed } = await supabaseAdmin
    .schema('stockmarket').from('tournaments')
    .update({ last_processed_gameweek: gameweek })
    .eq('id', tournamentId)
    .neq('status', 'finished')
    .or(`last_processed_gameweek.is.null,last_processed_gameweek.lt.${gameweek}`)
    .select('id, end_gameweek, gameweek')
    .maybeSingle();
  if (!claimed) return { ok: false, step: 'claim' };

  // Pairing should already exist (created as soon as the gameweek began),
  // but ensure it here too as a safety net in case this is the very first
  // time anyone's loaded the page this gameweek.
  await ensureMatchupsForGameweek(supabaseAdmin, tournamentId, gameweek);

  const { data: matchupRowsExisting } = await supabaseAdmin
    .schema('stockmarket').from('matchups')
    .select('*').eq('tournament_id', tournamentId).eq('gameweek', gameweek).eq('settled', false);

  const { data: entries } = await supabaseAdmin
    .schema('stockmarket').from('tournament_entries')
    .select('*').eq('tournament_id', tournamentId).eq('squad_locked', true).eq('relegated', false);
  if (!entries || entries.length === 0) return { ok: false, step: 'no entries' };

  const { data: tRow } = await supabaseAdmin
    .schema('stockmarket').from('tournaments')
    .select('cost_multiplier').eq('id', tournamentId).maybeSingle();
  const costMultiplier = (tRow && tRow.cost_multiplier) || 1;

  // Gather every distinct player_id across every squad, fetch their
  // GW stats once, plus each real team's goals conceded this gameweek.
  const allPlayerIds = [...new Set(entries.flatMap(e => (e.squad_players || []).filter(s => !s.empty).map(s => s.player_id)))];
  const { data: statRows } = allPlayerIds.length > 0
    ? await masterDb.from('player_gameweek_stats').select('*').eq('gameweek', gameweek).in('player_id', allPlayerIds)
    : { data: [] };
  const statsByPid = {};
  (statRows || []).forEach(s => { statsByPid[s.player_id] = s; });
  const concededByTeam = await getTeamGoalsConcededMap(masterDb, gameweek);

  // Prep every entry's squad ONCE into shared, mutable player objects.
  // Sharing these same references across every matchup settled this
  // gameweek is what lets a wider-pool funding effect on a squad persist
  // correctly, even when that same squad is later settled in its own
  // separate matchup against someone else.
  const preppedByEntry = {};
  entries.forEach(e => {
    preppedByEntry[e.id] = prepSquadForSettlement(e.squad_players || [], statsByPid, concededByTeam, costMultiplier);
  });

  // Settle each already-paired, not-yet-settled matchup using the exact
  // same mechanic as the live view — a player's own event keeps its full
  // real value, funded directly from the opponent first, in priority
  // order (goals, then assists, then saves, then clean sheets); if the
  // opponent runs short, the remainder falls back to every OTHER squad
  // in the tournament, spread evenly, before finally giving up.
  const historyRows = [];

  const matchupUpdateRows = [];
  for (const row of (matchupRowsExisting || [])) {
    if (!row.entry_id_2) continue; // bye row, nothing to settle
    const provA = preppedByEntry[row.entry_id_1];
    const provB = preppedByEntry[row.entry_id_2];
    if (!provA || !provB) continue;

    settleUnified(provA, provB);

    const totalA = provA.reduce((s, p) => s + p.liveValue, 0);
    const totalB = provB.reduce((s, p) => s + p.liveValue, 0);
    const startA = provA.reduce((s, p) => s + (p.value || 0), 0);
    const startB = provB.reduce((s, p) => s + (p.value || 0), 0);
    const gapA = totalA - startA, gapB = totalB - startB;

    matchupUpdateRows.push({
      ...row, raw_total_1: gapA, raw_total_2: gapB, gap: Math.abs(gapA - gapB),
      winner_entry_id: gapA === gapB ? null : (gapA > gapB ? row.entry_id_1 : row.entry_id_2),
      settled: true
    });
  }
  // One batch upsert instead of one .update() call per matchup pair.
  // Spreads the full existing row (not just the changed fields) — an
  // upsert's ON CONFLICT DO UPDATE path still gets checked against every
  // NOT NULL constraint as if it might be a fresh insert, confirmed via a
  // real failure on predictions.predictions when only partial rows were
  // sent (tournament_id/gameweek/entry_id_1 are NOT NULL here too).
  if (matchupUpdateRows.length > 0) {
    const { error: matchupUpsertErr } = await supabaseAdmin
      .schema('stockmarket').from('matchups').upsert(matchupUpdateRows, { onConflict: 'id' });
    if (matchupUpsertErr) console.error('Batch matchup settlement upsert failed:', matchupUpsertErr);
  }

  // Save every entry's updated squad + total value, including a full
  // breakdown per player of exactly what happened this gameweek and why.
  // Also permanently log it to player_gw_history — squad_players only
  // ever holds the latest snapshot, this is the full week-by-week record.
  const entryUpdateRows = [];
  for (const entry of entries) {
    const settled = preppedByEntry[entry.id];
    if (!settled) continue;

    const fullSquad = (entry.squad_players || []).map(s => {
      if (s.empty) return s;
      const updated = settled.find(sl => sl.player_id === s.player_id);
      if (!updated) return s;

      const ownEventNet = (updated.ownEventReceived || 0) - (updated.ownEventPaid || 0);
      historyRows.push({
        tournament_id: tournamentId, entry_id: entry.id, gameweek,
        player_id: s.player_id, name: s.name, position: s.position, team: s.team,
        starting_value: s.value || 0, ending_value: Math.round(updated.liveValue),
        raw_change: ownEventNet,
        win_bonus: Math.round(updated.received || 0),
        penalty_paid: Math.round(updated.paid || 0), benched: updated.benched,
        stats: updated.gwStats
      });

      return {
        ...s, value: updated.liveValue,
        last_gw_breakdown: {
          gameweek,
          stats: updated.gwStats,
          benched: updated.benched,
          raw_change: ownEventNet,
          own_event_net: ownEventNet,
          win_bonus: updated.received || 0,
          penalty_paid: updated.paid || 0,
          short_by: updated.shortBy || 0
        }
      };
    });
    const newTotal = Math.round(fullSquad.reduce((sum, s) => sum + (s.empty ? 0 : (s.value || 0)), 0));
    entryUpdateRows.push({
      ...entry, squad_players: fullSquad, last_week_value: entry.current_value, current_value: newTotal
    });
  }
  // One batch upsert instead of one .update() call per entry.
  if (entryUpdateRows.length > 0) {
    const { error: entryUpsertErr } = await supabaseAdmin
      .schema('stockmarket').from('tournament_entries').upsert(entryUpdateRows, { onConflict: 'id' });
    if (entryUpsertErr) console.error('Batch entry settlement upsert failed:', entryUpsertErr);
  }
  if (historyRows.length > 0) {
    const { error: historyError } = await supabaseAdmin.schema('stockmarket').from('player_gw_history').insert(historyRows);
    if (historyError) console.error('player_gw_history insert failed:', historyError);
  }

  if (claimed.end_gameweek && gameweek >= claimed.end_gameweek) {
    await supabaseAdmin.schema('stockmarket').from('tournaments').update({ status: 'finished' }).eq('id', tournamentId);

    // Lock in the result permanently — every entry's current_value at this
    // exact moment becomes their final_value, regardless of what happens
    // to current_value afterward (there shouldn't be anything, since the
    // tournament is now finished, but this makes the final result an
    // explicit, unambiguous fact rather than "whatever current_value
    // happens to still say if anyone looks later").
    const { data: allFinalEntries } = await supabaseAdmin
      .schema('stockmarket').from('tournament_entries')
      .select('*').eq('tournament_id', tournamentId);
    const finalRows = (allFinalEntries || []).map(e => ({ ...e, final_value: e.current_value }));
    if (finalRows.length > 0) {
      const { error: finalErr } = await supabaseAdmin
        .schema('stockmarket').from('tournament_entries').upsert(finalRows, { onConflict: 'id' });
      if (finalErr) console.error('Batch final_value upsert failed:', finalErr);
    }
  }

  return { ok: true, pairs: (matchupRowsExisting || []).filter(r => r.entry_id_2).length };
}

// ================= RELEGATION STAGES =================
// Up to 8 admin-defined checkpoints per tournament. Each stage names a
// trigger gameweek, how many of the currently-active bottom entries get
// cut, and the cost-per-action multiplier that takes effect from that
// point on. Fully admin-controlled, not auto-computed — see
// frontend/admin.html "Stock Market — Relegation Stages" section.
//
// Finds every configured stage whose trigger_gameweek has arrived and
// hasn't been applied yet, and applies them in stage_number order. Safe
// to call on every page load / status check: each stage is claimed
// atomically (applied flips false -> true in the same update that reads
// it) so two overlapping requests can't double-apply the same stage.
async function applyDueStages(supabaseAdmin, tournamentId, currentGW) {
  const { data: dueStages } = await supabaseAdmin
    .schema('stockmarket').from('tournament_stages')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('applied', false)
    .lte('trigger_gameweek', currentGW)
    .order('stage_number', { ascending: true });

  if (!dueStages || dueStages.length === 0) return { ok: true, applied: 0 };

  let appliedCount = 0;
  for (const stage of dueStages) {
    // Atomic claim — only this call proceeds if it's still unapplied.
    const { data: claimed } = await supabaseAdmin
      .schema('stockmarket').from('tournament_stages')
      .update({ applied: true })
      .eq('id', stage.id).eq('applied', false)
      .select('id').maybeSingle();
    if (!claimed) continue;

    await applyRelegationStage(supabaseAdmin, tournamentId, stage, currentGW);
    appliedCount++;
  }
  return { ok: true, applied: appliedCount };
}

// Cuts the bottom `relegate_count` currently-active entries (by current
// portfolio value), pools their total value, and spreads that pot evenly
// across every player slot in every surviving squad — condensing the
// prize pool into fewer players as the tournament progresses. Then bumps
// the tournament's cost_multiplier to this stage's configured value.
async function applyRelegationStage(supabaseAdmin, tournamentId, stage, currentGW) {
  const { data: activeEntries } = await supabaseAdmin
    .schema('stockmarket').from('tournament_entries')
    .select('*')
    .eq('tournament_id', tournamentId).eq('squad_locked', true).eq('relegated', false)
    .order('current_value', { ascending: true });

  if (!activeEntries || activeEntries.length === 0) {
    console.log(`[Relegation] Stage ${stage.stage_number} for ${tournamentId}: no active entries, skipping.`);
    return;
  }

  const cutCount = Math.min(Math.max(stage.relegate_count || 0, 0), activeEntries.length);
  if (cutCount === 0) {
    console.log(`[Relegation] Stage ${stage.stage_number} for ${tournamentId}: relegate_count is 0, nothing cut.`);
  } else {
    const relegatedEntries = activeEntries.slice(0, cutCount);
    const survivors = activeEntries.slice(cutCount);

    if (relegatedEntries.length > 0) {
      const { error: relErr } = await supabaseAdmin
        .schema('stockmarket').from('tournament_entries')
        .update({ relegated: true, relegated_at_gameweek: currentGW })
        .in('id', relegatedEntries.map(e => e.id));
      if (relErr) console.error('Batch relegation update failed:', relErr);
    }

    const pot = relegatedEntries.reduce((s, e) => s + Math.round(e.current_value || 0), 0);

    if (pot > 0 && survivors.length > 0) {
      // Every non-empty player slot across every surviving squad gets an
      // equal share, pence-exact (remainder handed to the first few slots).
      const slotRefs = [];
      const squadCopies = {};
      survivors.forEach(e => {
        squadCopies[e.id] = (e.squad_players || []).map(p => ({ ...p }));
        squadCopies[e.id].forEach((p, idx) => { if (!p.empty) slotRefs.push({ entryId: e.id, idx }); });
      });

      if (slotRefs.length > 0) {
        const base = Math.floor(pot / slotRefs.length);
        const remainder = pot - base * slotRefs.length;
        slotRefs.forEach((ref, i) => {
          const amount = base + (i < remainder ? 1 : 0);
          const slot = squadCopies[ref.entryId][ref.idx];
          slot.value = Math.round((slot.value || 0) + amount);
        });

        const survivorUpdateRows = survivors.map(e => {
          const squad = squadCopies[e.id];
          const newTotal = Math.round(squad.reduce((s, p) => s + (p.empty ? 0 : (p.value || 0)), 0));
          return { ...e, squad_players: squad, current_value: newTotal };
        });
        // One batch upsert instead of one .update() call per survivor.
        const { error: survErr } = await supabaseAdmin
          .schema('stockmarket').from('tournament_entries').upsert(survivorUpdateRows, { onConflict: 'id' });
        if (survErr) console.error('Batch pot-redistribution upsert failed:', survErr);
      }
    }
    console.log(`[Relegation] Stage ${stage.stage_number} for ${tournamentId}: relegated ${relegatedEntries.length}, pot ${pot}p spread across ${survivors.length} survivors.`);
  }

  if (stage.cost_multiplier) {
    await supabaseAdmin.schema('stockmarket').from('tournaments')
      .update({ cost_multiplier: stage.cost_multiplier })
      .eq('id', tournamentId);
  }
}

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

// Shared by both the admin-triggered and poll-triggered sync actions.
// `allowDebounce` is only true for the poll path — if this gameweek was
// already synced in the last 90 seconds, skip re-fetching from FPL
// entirely. Without this, every user with a page open polls independently
// every 2 minutes, so 20 concurrent users could mean 20 near-simultaneous
// FPL fetches for the exact same data. The admin's manual "sync now"
// button always forces a real fetch, since that's a deliberate one-off
// action, not a background tick.
// The real transfer deadline: the first kickoff of the gameweek AFTER
// currentGW. Shared by the popup endpoint and both sell/buy enforcement
// checks below, so there's exactly one source of truth for this time —
// no risk of the displayed deadline and the enforced one ever disagreeing.
// Admin test tool: fabricates a believable result + player stats for a
// real gameweek's real fixtures, all consistent with each other (a
// player's clean sheet / goals conceded always matches their own team's
// fake scoreline for that same match — nothing here is independently
// randomized in a way that could contradict itself).
// Standard FPL scoring rules — used to compute Fantasy's points from the
// same raw player_gameweek_stats every other tournament reads, so Fantasy
// becomes testable through the same mechanism as everything else. This
// doesn't change how Fantasy reads data in real production (still
// players.total_points/event_points) — it's what WRITES into those
// fields when a gameweek is marked finished during testing, standing in
// for what FPL's own live feed would eventually provide for real.
// Deliberately doesn't attempt bonus points (BPS) — those depend on
// FPL's own proprietary in-match algorithm, not reconstructable from
// basic stats, and aren't needed for testing the tournament mechanics.
function computeStandardFplPoints(elementType, stats) {
  const mins = stats.minutes || 0;
  let pts = 0;
  if (mins >= 60) pts += 2;
  else if (mins > 0) pts += 1;

  const goalPts = { 1: 6, 2: 6, 3: 5, 4: 4 }[elementType] || 4;
  pts += (stats.goals_scored || 0) * goalPts;
  pts += (stats.assists || 0) * 3;

  if ((elementType === 1 || elementType === 2) && mins >= 60 && (stats.goals_conceded || 0) === 0) pts += 4;
  else if (elementType === 3 && mins >= 60 && (stats.goals_conceded || 0) === 0) pts += 1;

  if (elementType === 1 || elementType === 2) {
    pts -= Math.floor((stats.goals_conceded || 0) / 2);
  }
  if (elementType === 1) {
    pts += Math.floor((stats.saves || 0) / 3);
  }

  pts -= (stats.yellow_cards || 0) * 1;
  pts -= (stats.red_cards || 0) * 3;

  return pts;
}

// Fires once a gameweek's matches are ALL finished — the actual "week is
// completely done" moment. Runs the real settlement functions for Stock
// Market and LMS (same functions production uses), and writes Fantasy's
// final points from whatever player_gameweek_stats exists for the
// gameweek (see computeStandardFplPoints above). Safe to call repeatedly;
// every step underneath is itself idempotent.
async function finalizeGameweekIfComplete(masterDb, supabaseAdmin, gameweek) {
  const { data: gwMatches } = await masterDb
    .from('matches')
    .select('home_team, away_team, home_score, away_score, status, kickoff_time')
    .eq('gameweek', gameweek);

  const allFinished = gwMatches && gwMatches.length > 0 && gwMatches.every(m => m.status === 'finished');
  if (!allFinished) {
    return { fired: false, reason: 'not all matches in this gameweek are finished yet' };
  }

  const result = { fired: true, stock_market_tournaments_settled: 0, lms_tournaments_settled: 0 };

  // Same reasoning as the Advance Gameweek path — this used to only fire
  // on an incidental Fantasy Manager page visit, easy to miss entirely.
  // Idempotent (checks if already snapshotted), so firing it here too
  // alongside the Advance Gameweek path is safe, not a double-write.
  await snapshotGameweekIfNeeded(masterDb, gameweek);

  const { data: liveStockMarkets } = await supabaseAdmin
    .schema('stockmarket').from('tournaments').select('id').eq('status', 'live');
  for (const t of (liveStockMarkets || [])) {
    await ensureMatchupsForGameweek(supabaseAdmin, t.id, gameweek);
    await applyDueStages(supabaseAdmin, t.id, gameweek);
    await processHeadToHeadGameweek(supabaseAdmin, masterDb, t.id, gameweek);
    result.stock_market_tournaments_settled++;
  }

  const { data: liveLms } = await supabaseAdmin
    .schema('lms').from('tournaments').select('id').eq('status', 'live');
  for (const t of (liveLms || [])) {
    await finalizeLmsRoundIfComplete(supabaseAdmin, t.id, gameweek);
    result.lms_tournaments_settled++;
  }

  return result;
}

// Fantasy — unlike Stock Market/LMS (which genuinely need the whole
// gameweek's result to settle a head-to-head or an elimination), real FPL
// itself shows provisional points updating live as each match happens —
// so this deliberately isn't gated on the whole gameweek being finished.
// It recomputes standard FPL points from whatever player_gameweek_stats
// currently exists (players who haven't played yet just score 0, same as
// real live FPL), and writes into players.event_points/total_points, the
// same fields Fantasy always reads.
//
// Made idempotent so calling it repeatedly through a gameweek (as more
// matches finish) doesn't compound: total_points is adjusted by removing
// whatever this same function last credited for event_points before
// adding the freshly computed value, rather than just adding on top each
// time. This is correct for updates within a single gameweek; carrying
// the right baseline forward across a gameweek transition would need
// bookkeeping this doesn't yet have — fine for now, since it's the same
// gap real production doesn't have to worry about (FPL's own feed just
// tells us the true total_points directly each sync, so nothing here
// mutates incrementally once real polling resumes).
async function updateFantasyPointsForGameweek(masterDb, gameweek) {
  const result = { fantasy_players_updated: 0 };
  const { data: gwStats } = await masterDb
    .from('player_gameweek_stats').select('*').eq('gameweek', gameweek);
  if (!gwStats || gwStats.length === 0) return result;

  // Only count stats for teams whose match has actually started — same
  // filter as the Stock Market live view, for the same reason: the test
  // rig pre-stages a whole gameweek's stats, and without this, marking
  // one match finished would award points for all twenty teams at once.
  const { data: gwMatchStatus } = await masterDb
    .from('matches').select('home_team, away_team, status').eq('gameweek', gameweek);
  const startedTeams = new Set();
  (gwMatchStatus || []).forEach(m => {
    if (m.status === 'live' || m.status === 'finished') { startedTeams.add(m.home_team); startedTeams.add(m.away_team); }
  });
  const countableStats = gwStats.filter(s => startedTeams.has(s.team));
  if (countableStats.length === 0) return result;

  const { data: allPlayers } = await masterDb.from('players').select('id, element_type, total_points, event_points');
  const playerById = {};
  (allPlayers || []).forEach(p => { playerById[p.id] = p; });

  const updateRows = [];
  for (const stat of countableStats) {
    const player = playerById[stat.player_id];
    if (!player) continue;
    const newEventPoints = computeStandardFplPoints(player.element_type, stat);
    const previousEventPoints = player.event_points || 0;
    const newTotal = (player.total_points || 0) - previousEventPoints + newEventPoints;
    updateRows.push({ id: stat.player_id, event_points: newEventPoints, total_points: newTotal });
  }

  // One batch upsert instead of one .update() call per player (was 280
  // sequential round trips for a full gameweek — the single biggest
  // contributor to Advance Gameweek taking so long).
  if (updateRows.length > 0) {
    const { error: upsertErr } = await masterDb.from('players').upsert(updateRows, { onConflict: 'id' });
    if (upsertErr) {
      console.error('updateFantasyPointsForGameweek batch upsert failed:', upsertErr);
    } else {
      result.fantasy_players_updated = updateRows.length;
    }
  }
  return result;
}

// Shared by both the bulk "Generate Test Gameweek Data" tool and the
// single-match "Simulate Match" tool — literally the same function, so a
// simulated match is generated identically regardless of which admin
// button triggered it. Mutates statByPlayerId in place (the caller owns
// the accumulator so bulk-gameweek calls can merge many matches' stats
// together before one upsert); returns the match update row.
function simulateOneMatchIntoAccumulator(m, gameweek, teamIdByName, playersByTeamId, statByPlayerId, markFinished = true) {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randInt = (max) => Math.floor(Math.random() * (max + 1));
  // Weighted toward realistic scorelines: 0,1,2 much more common than 3+
  const randomScore = () => {
    const r = Math.random();
    if (r < 0.28) return 0;
    if (r < 0.60) return 1;
    if (r < 0.85) return 2;
    if (r < 0.96) return 3;
    return 4;
  };

  const ensureStat = (p) => {
    if (!statByPlayerId[p.id]) {
      statByPlayerId[p.id] = {
        gameweek, player_id: p.id, team: null, web_name: p.web_name,
        photo: p.custom_photo_url || (p.photo ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${p.photo.replace('.jpg', '')}.png` : null),
        goals_scored: 0, assists: 0, yellow_cards: 0, red_cards: 0,
        clean_sheets: 0, goals_conceded: 0, saves: 0, minutes: 0,
        synced_at: new Date().toISOString()
      };
    }
    return statByPlayerId[p.id];
  };

  const homeScore = randomScore();
  const awayScore = randomScore();
  const matchUpdate = {
    id: m.id, gameweek, home_team: m.home_team, away_team: m.away_team,
    home_score: homeScore, away_score: awayScore, status: markFinished ? 'finished' : 'upcoming',
    result: homeScore > awayScore ? 'H' : awayScore > homeScore ? 'A' : 'D'
  };

  const homeTeamId = teamIdByName[m.home_team];
  const awayTeamId = teamIdByName[m.away_team];
  const homeSquad = playersByTeamId[homeTeamId] || [];
  const awaySquad = playersByTeamId[awayTeamId] || [];

  const simulateTeam = (squad, teamName, goalsFor, goalsAgainst) => {
    if (squad.length === 0) return;
    const mids = squad.filter(p => p.element_type === 3);
    const fwds = squad.filter(p => p.element_type === 4);

    // ~14 of the squad "play" this match — realistic starters+subs mix
    const shuffled = [...squad].sort(() => Math.random() - 0.5);
    const playing = shuffled.slice(0, Math.min(14, squad.length));
    playing.forEach(p => {
      const s = ensureStat(p);
      s.team = teamName;
      s.minutes = Math.random() < 0.75 ? 90 : (30 + randInt(59));
      s.goals_conceded = goalsAgainst;
      if (goalsAgainst === 0 && (p.element_type === 1 || p.element_type === 2)) s.clean_sheets = 1;
      if (Math.random() < 0.12) s.yellow_cards = 1;
      if (Math.random() < 0.01) s.red_cards = 1;
    });

    const playingGk = playing.find(p => p.element_type === 1);
    if (playingGk) {
      const s = ensureStat(playingGk);
      s.saves = goalsAgainst + randInt(4);
    }

    // Distribute this team's goals among players who actually played,
    // weighted toward attackers — same for assists.
    const attackers = playing.filter(p => fwds.includes(p) || mids.includes(p));
    const scorerPool = attackers.length > 0 ? attackers : playing;
    for (let i = 0; i < goalsFor; i++) {
      const scorer = pick(scorerPool);
      ensureStat(scorer).goals_scored += 1;
      if (Math.random() < 0.65) {
        const assistPool = playing.filter(p => p.id !== scorer.id && (mids.includes(p) || fwds.includes(p)));
        if (assistPool.length > 0) ensureStat(pick(assistPool)).assists += 1;
      }
    }
  };

  simulateTeam(homeSquad, m.home_team, homeScore, awayScore);
  simulateTeam(awaySquad, m.away_team, awayScore, homeScore);

  return matchUpdate;
}

async function generateTestGameweekData(masterDb, gameweek, localDb, markFinished = true) {
  try {
    const { data: matches, error: matchesErr } = await masterDb
      .from('matches').select('id, home_team, away_team, status').eq('gameweek', gameweek);
    if (matchesErr) return { status: 500, body: { error: matchesErr.message } };
    if (!matches || matches.length === 0) {
      return { status: 404, body: { error: `No real fixtures found for GW${gameweek} — run sync-fixtures first` } };
    }

    // Never regenerate a gameweek that's already finished — real results
    // exist that Predictions/Stock Market/LMS have already been scored or
    // settled against. Overwriting them here would silently swap those
    // results out from under everything already computed, without any of
    // it knowing the ground truth had changed. Confirmed as a real
    // corruption path, not a hypothetical: a finished gameweek's genuine
    // winners came back marked as losers after this ran a second time.
    if (matches.every(m => m.status === 'finished')) {
      return { status: 409, body: { error: `GW${gameweek} is already finished — refusing to regenerate and overwrite real results. Use clear_gameweek_stats_cache and reset match status first if you genuinely need to redo it.`, skipped: true } };
    }

    // This fabricates fake results — only ever safe in test mode. Checked
    // here, inside the function itself, so every caller (Advance
    // Gameweek, the direct admin action, Seed Season Data) is protected
    // uniformly, not just whichever one remembered to check first.
    const { data: pollingCheck } = await masterDb
      .from('master_clock').select('polling_paused').eq('id', 'current').maybeSingle();
    if (!pollingCheck || !pollingCheck.polling_paused) {
      return { status: 409, body: { error: `Refusing to generate fake results for GW${gameweek} — real polling is live. This can only ever run in test mode (polling paused).`, skipped: true } };
    }

    const { data: teams } = await masterDb.from('teams').select('id, name');
    const teamIdByName = {};
    (teams || []).forEach(t => { teamIdByName[t.name] = t.id; });

    const { data: allPlayers } = await masterDb
      .from('players').select('id, web_name, team, element_type, photo, custom_photo_url');

    const playersByTeamId = {};
    (allPlayers || []).forEach(p => {
      if (!playersByTeamId[p.team]) playersByTeamId[p.team] = [];
      playersByTeamId[p.team].push(p);
    });

    const statByPlayerId = {};
    const matchUpdates = matches.map(m =>
      simulateOneMatchIntoAccumulator(m, gameweek, teamIdByName, playersByTeamId, statByPlayerId, markFinished)
    );

    let matchesUpdatedOk = 0;
    const matchUpdateErrors = [];
    for (const mu of matchUpdates) {
      const { error: matchUpdateErr } = await masterDb.from('matches').update({
        home_score: mu.home_score, away_score: mu.away_score, status: mu.status, result: mu.result
      }).eq('id', mu.id);
      if (matchUpdateErr) {
        console.error(`generateTestGameweekData: failed to update match ${mu.id}:`, matchUpdateErr.message);
        matchUpdateErrors.push({ match_id: mu.id, error: matchUpdateErr.message });
      } else {
        matchesUpdatedOk++;
      }
    }

    const statRows = Object.values(statByPlayerId);
    const CHUNK = 200;
    for (let i = 0; i < statRows.length; i += CHUNK) {
      await masterDb.from('player_gameweek_stats').upsert(statRows.slice(i, i + CHUNK), { onConflict: 'gameweek,player_id' });
    }

    // Also scores Predictions for this gameweek, using the exact same
    // function live-scores.js will use for real in a few weeks — not a
    // reimplementation, the literal same code, just called directly here
    // since live-scores.js's own trigger (comparing against FPL's real
    // feed) will never fire for admin-generated fake results. Skipped
    // entirely when only seeding data (markFinished=false) — matches are
    // still 'upcoming', so there's nothing to score yet.
    let predictionsScored = false;
    if (markFinished) {
      try {
        const { calculatePointsForGameweek } = require('./live-scores.js');
        await calculatePointsForGameweek(localDb, masterDb, gameweek);
        predictionsScored = true;
      } catch (predErr) {
        console.error('generateTestGameweekData: Predictions scoring step failed (non-fatal):', predErr);
      }
    }

    return {
      status: 200,
      body: {
        success: true, gameweek,
        matches_updated: matchesUpdatedOk,
        matches_attempted: matchUpdates.length,
        match_update_errors: matchUpdateErrors.length > 0 ? matchUpdateErrors : undefined,
        players_with_stats: statRows.length, predictions_scored: predictionsScored
      }
    };
  } catch (err) {
    console.error('generateTestGameweekData error:', err);
    return { status: 500, body: { error: err.message } };
  }
}

// Transfers must lock the moment the CURRENT gameweek's first match
// kicks off — not stay open all the way through live play until the
// NEXT gameweek starts. Letting someone sell/buy mid-gameweek, after
// seeing how matches are actually going, would let them trade on
// information nobody else has yet. The window only reopens once the
// system has actually moved on to the next gameweek (via Advance
// Gameweek), whose own matches are still 'upcoming' at that point.
async function isStockMarketTransferWindowOpen(masterDb, supabaseAdmin, tournamentId, currentGW) {
  if (!currentGW) return { open: true, reason: null };

  const { data: bypassCheck } = await supabaseAdmin
    .schema('stockmarket').from('tournaments')
    .select('test_bypass_deadline').eq('id', tournamentId).maybeSingle();
  if (bypassCheck && bypassCheck.test_bypass_deadline) return { open: true, reason: null };

  const { data: gwMatches } = await masterDb.from('matches').select('status').eq('gameweek', currentGW);
  const anyStarted = (gwMatches || []).some(m => m.status === 'live' || m.status === 'finished');
  if (anyStarted) return { open: false, reason: 'Transfer window closed — this gameweek has started' };

  return { open: true, reason: null };
}

async function getNextGameweekDeadline(masterDb, currentGW) {
  const { data: nextMatches } = await masterDb
    .from('matches')
    .select('kickoff_time')
    .eq('gameweek', currentGW + 1);

  if (!nextMatches || nextMatches.length === 0) {
    return { deadlineMs: null, deadlineEpoch: null };
  }

  const earliestMs = nextMatches.reduce((min, m) => {
    const t = new Date(m.kickoff_time).getTime();
    return (min === null || t < min) ? t : min;
  }, null);

  return { deadlineMs: earliestMs, deadlineEpoch: earliestMs !== null ? Math.floor(earliestMs / 1000) : null };
}

async function syncGameweekStatsFromFPL(masterDb, gameweek, allowDebounce) {
  if (allowDebounce) {
    const { data: recent } = await masterDb
      .from('player_gameweek_stats')
      .select('synced_at')
      .eq('gameweek', gameweek)
      .not('synced_at', 'is', null)
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recent && recent.synced_at) {
      const ageMs = Date.now() - new Date(recent.synced_at).getTime();
      if (ageMs < 90000) {
        return { status: 200, body: { skipped: true, reason: 'synced recently', age_seconds: Math.round(ageMs / 1000) } };
      }
    }
  }

  try {
    const liveRes = await fetch(`https://fantasy.premierleague.com/api/event/${gameweek}/live/`);
    if (!liveRes.ok) {
      return { status: 502, body: { error: `FPL API returned ${liveRes.status} for GW${gameweek}` } };
    }
    const liveData = await liveRes.json();
    const elements = liveData.elements || [];

    if (elements.length === 0) {
      return { status: 404, body: { error: `No data returned for GW${gameweek} — it may not have been played yet` } };
    }

    // Snapshot each player's team, name AND photo RIGHT NOW, at sync
    // time — not just team. This is what makes the row immune to FPL
    // ever reassigning this numeric ID to a different real player later.
    // Without this, every field here always reflects whoever holds this
    // ID *today*, even when displaying a gameweek from months ago — which
    // is exactly how a past gameweek's real stats can end up silently
    // displayed under a completely different, unrelated player's name.
    const { data: playerRows } = await masterDb.from('players').select('id, team, web_name, photo, custom_photo_url');
    const { data: teamRows } = await masterDb.from('teams').select('id, name');
    const teamNameById = {};
    (teamRows || []).forEach(t => { teamNameById[t.id] = t.name; });
    const identityByPlayerId = {};
    (playerRows || []).forEach(p => {
      identityByPlayerId[p.id] = {
        team: teamNameById[p.team] || null,
        web_name: p.web_name || null,
        photo: p.custom_photo_url || (p.photo ? `https://resources.premierleague.com/premierleague/photos/players/250x250/p${p.photo.replace('.jpg', '')}.png` : null)
      };
    });

    const syncedAt = new Date().toISOString();
    const statRows = elements.map(el => {
      const identity = identityByPlayerId[el.id] || {};
      return {
        gameweek, player_id: el.id,
        team: identity.team || null,
        web_name: identity.web_name || null,
        photo: identity.photo || null,
        goals_scored: el.stats?.goals_scored || 0,
        assists: el.stats?.assists || 0,
        yellow_cards: el.stats?.yellow_cards || 0,
        red_cards: el.stats?.red_cards || 0,
        clean_sheets: el.stats?.clean_sheets || 0,
        goals_conceded: el.stats?.goals_conceded || 0,
        saves: el.stats?.saves || 0,
        minutes: el.stats?.minutes || 0,
        synced_at: syncedAt
      };
    });

    const CHUNK = 200;
    for (let i = 0; i < statRows.length; i += CHUNK) {
      await masterDb.from('player_gameweek_stats').upsert(statRows.slice(i, i + CHUNK), { onConflict: 'gameweek,player_id' });
    }

    return { status: 200, body: { success: true, gameweek, players_synced: statRows.length } };
  } catch (err) {
    console.error('syncGameweekStatsFromFPL error:', err);
    return { status: 500, body: { error: err.message } };
  }
}

async function fetchRarityPool(masterDb, rarity, positionKey) {
  const threshold = RARITY_THRESHOLDS[positionKey][rarity];
  const elementType = POSITION_ELEMENT_TYPE[positionKey];
  const { data, error } = await masterDb
    .from('players')
    .select('id, web_name, element_type, team, total_points, now_cost, photo, photo_verified, custom_photo_url')
    .eq('element_type', elementType)
    .gte('now_cost', threshold.min)
    .lte('now_cost', threshold.max)
    // Only exclude players CONFIRMED (by the photo verification tool) to
    // have no real photo on FPL's CDN. Anyone not yet checked (NULL) still
    // shows up as normal — this can never accidentally empty the pool just
    // because verification hasn't been run yet.
    .or('photo_verified.is.null,photo_verified.eq.true')
    .order('now_cost', { ascending: false })
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
    photo: p.custom_photo_url || (p.photo ? `${FPL_PHOTO_URL}${p.photo.replace('.jpg', '')}.png` : null),
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

    if (claimError) { console.error('processStockMarketGameweek claim error:', claimError); return { ok: false, step: 'claim', error: claimError.message }; }
    if (!claimed) return { ok: false, step: 'claim', reason: 'Claim returned no row — already processed this gameweek, tournament finished, or update matched nothing.' };

    const { data: marketRows, error: marketError } = await supabaseAdmin
      .schema('stockmarket').from('player_market')
      .select('*')
      .eq('tournament_id', tournamentId);

    if (marketError) return { ok: false, step: 'marketRows', error: marketError.message };
    if (!marketRows || marketRows.length === 0) return { ok: false, step: 'marketRows', reason: 'No player_market rows found for this tournament.' };

    const { data: config } = await supabaseAdmin
      .schema('stockmarket').from('config')
      .select('*')
      .eq('tournament_id', tournamentId)
      .maybeSingle();

    if (!config) return { ok: false, step: 'config', reason: 'No stockmarket.config row exists for this tournament_id.' };

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
      return { ok: false, step: 'statsFetch', error: fetchErr.message };
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
                const allOtherPlayers = [];
                otherEntries.forEach(other => {
                  (other.squad_players || []).filter(s => !s.empty).forEach(s => allOtherPlayers.push({ entry: other, slot: s }));
                });
                if (allOtherPlayers.length > 0) {
                  const baseShare = Math.floor(bronzeFee / allOtherPlayers.length);
                  const remainder = bronzeFee - (baseShare * allOtherPlayers.length);
                  allOtherPlayers.forEach((item, i) => {
                    const bump = baseShare + (i < remainder ? 1 : 0);
                    item.slot.bonus_value = (item.slot.bonus_value || 0) + bump;
                  });
                  for (const other of otherEntries) {
                    await supabaseAdmin.schema('stockmarket').from('tournament_entries')
                      .update({ squad_players: other.squad_players }).eq('id', other.id);
                  }
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

      const { data: allFinalEntries2 } = await supabaseAdmin
        .schema('stockmarket').from('tournament_entries')
        .select('id, current_value').eq('tournament_id', tournamentId);
      for (const e of (allFinalEntries2 || [])) {
        await supabaseAdmin.schema('stockmarket').from('tournament_entries')
          .update({ final_value: e.current_value }).eq('id', e.id);
      }
    }

    const selectedWithLiveData = liveElements.filter(el => prices[String(el.id)]).length;
    console.log(`Stock Market ${tournamentId} GW${gameweek} processed — ${selectedWithLiveData} selected players had live data, ${redCardPids.length} catastrophic red cards`);
    return { ok: true, step: 'complete', selectedWithLiveData, redCards: redCardPids.length, totalLiveElements: liveElements.length };
  } catch (error) {
    console.error('processStockMarketGameweek error:', error);
    return { ok: false, step: 'exception', error: error.message };
  }
}

// Vercel Function: Sync players from FPL API
// GET /api/sync-players

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // This function only ever touches the shared master PL-facts project
  // (players/teams) — never the app's own users/predictions database.
  const supabase = createClient(
    process.env.MASTER_SUPABASE_URL,
    process.env.MASTER_SUPABASE_SERVICE_KEY,
    { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
  );

  // Read-only mode: GET /api/sync-players?list=true
  // Returns players already stored in the DB — no FPL fetch, no writes.
  // Used by the Fantasy Manager squad builder so browsing players is cheap.
  const params = new URLSearchParams(req.query);
  if (req.method === 'GET' && params.get('list') === 'true') {
    try {
      const { data: players, error } = await supabase
        .from('players')
        .select('id, web_name, first_name, second_name, team, element_type, now_cost, total_points, event_points, form, status, photo, news, chance_of_playing_next_round, chance_of_playing_this_round, points_per_game, minutes, goals_scored, assists, clean_sheets, goals_conceded, own_goals, penalties_saved, penalties_missed, yellow_cards, red_cards, saves, bonus, bps, influence, creativity, threat, ict_index')
        .order('total_points', { ascending: false });

      if (error) {
        return res.status(500).json({ error: 'Failed to fetch players', details: error.message });
      }

      // players.goals_scored/assists/yellow_cards/red_cards are never
      // actually written to by the real scoring pipeline — they sit at 0
      // regardless of what's genuinely happened. player_gameweek_stats
      // does hold real per-gameweek events, so season totals are summed
      // from there and merged in, overriding the always-zero columns.
      // Confirmed as a real bug: every player showed 0 for all four
      // stats despite a full season of real goals/assists/cards.
      const { data: gwStats } = await supabase
        .from('player_gameweek_stats')
        .select('player_id, goals_scored, assists, yellow_cards, red_cards');

      const seasonTotals = {};
      (gwStats || []).forEach(row => {
        if (!seasonTotals[row.player_id]) {
          seasonTotals[row.player_id] = { goals_scored: 0, assists: 0, yellow_cards: 0, red_cards: 0 };
        }
        const t = seasonTotals[row.player_id];
        t.goals_scored += row.goals_scored || 0;
        t.assists += row.assists || 0;
        t.yellow_cards += row.yellow_cards || 0;
        t.red_cards += row.red_cards || 0;
      });

      const playersWithRealSeasonStats = (players || []).map(p => {
        const totals = seasonTotals[p.id];
        return totals ? { ...p, ...totals } : p;
      });

      const { data: teams } = await supabase
        .from('teams')
        .select('id, name, short_name');

      return res.status(200).json({ players: playersWithRealSeasonStats, teams: teams || [] });
    } catch (error) {
      console.error('Players list error:', error);
      return res.status(500).json({ error: 'Failed to fetch players', details: error.message });
    }
  }

  // Read-only mode: GET /api/sync-players?table=true
  // Computes the current Premier League table from our own synced match
  // results — table.html's own endpoint (/api/table) doesn't actually
  // exist, so this fills that gap without needing a new function.
  if (req.method === 'GET' && params.get('table') === 'true') {
    try {
      const [teamsRes, matchesRes, clockRes] = await Promise.all([
        supabase.from('teams').select('id, name, short_name'),
        supabase.from('matches').select('home_team, away_team, home_score, away_score, status, kickoff_time').eq('status', 'finished').order('kickoff_time', { ascending: true }),
        supabase.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle()
      ]);

      const teams = teamsRes.data || [];
      const finishedMatches = matchesRes.data || [];

      const stats = {};
      teams.forEach(t => {
        stats[t.name] = {
          name: t.name, short_name: t.short_name,
          played: 0, won: 0, drawn: 0, lost: 0,
          gf: 0, ga: 0, gd: 0, points: 0, form: []
        };
      });

      let totalGoals = 0;

      finishedMatches.forEach(m => {
        const home = stats[m.home_team];
        const away = stats[m.away_team];
        if (!home || !away || m.home_score === null || m.away_score === null) return;

        home.played++; away.played++;
        home.gf += m.home_score; home.ga += m.away_score;
        away.gf += m.away_score; away.ga += m.home_score;
        totalGoals += m.home_score + m.away_score;

        if (m.home_score > m.away_score) {
          home.won++; home.points += 3; home.form.push('W');
          away.lost++; away.form.push('L');
        } else if (m.home_score < m.away_score) {
          away.won++; away.points += 3; away.form.push('W');
          home.lost++; home.form.push('L');
        } else {
          home.drawn++; home.points += 1; home.form.push('D');
          away.drawn++; away.points += 1; away.form.push('D');
        }
      });

      const table = Object.values(stats).map(t => ({
        ...t, gd: t.gf - t.ga, form: t.form.slice(-5)
      })).sort((a, b) => b.points - a.points || b.gd - a.gd || b.gf - a.gf);

      table.forEach((t, i) => { t.position = i + 1; });

      const totalMatches = finishedMatches.length;

      return res.status(200).json({
        table,
        stats: {
          totalMatches,
          totalGoals,
          avgGoals: totalMatches > 0 ? (totalGoals / totalMatches).toFixed(2) : '0.00',
          currentGameweek: clockRes.data?.current_gameweek ?? null
        },
        lastUpdated: new Date().toISOString()
      });
    } catch (error) {
      console.error('Table computation error:', error);
      return res.status(500).json({ error: 'Failed to compute table', details: error.message });
    }
  }

  // Read-only mode: GET /api/sync-players?records=true
  // Computes "best single gameweek ever" and "longest consecutive scoring
  // streak" from the history table snapshotted after each finished gameweek.
  if (req.method === 'GET' && params.get('records') === 'true') {
    try {
      const [historyRes, playersRes, teamsRes] = await Promise.all([
        supabase.from('player_gameweek_history').select('player_id, gameweek, event_points').order('gameweek', { ascending: true }),
        supabase.from('players').select('id, web_name, team'),
        supabase.from('teams').select('id, name, short_name')
      ]);

      const history = historyRes.data || [];
      const playersById = {};
      (playersRes.data || []).forEach(p => { playersById[p.id] = p; });
      const teamsById = {};
      (teamsRes.data || []).forEach(t => { teamsById[t.id] = t; });

      function playerInfo(id) {
        const p = playersById[id];
        const team = p ? teamsById[p.team] : null;
        return {
          player_id: id,
          web_name: p ? p.web_name : 'Unknown',
          team: team ? (team.short_name || team.name) : ''
        };
      }

      // Best single gameweek: top 5 highest event_points rows ever recorded
      const bestGameweeks = [...history]
        .sort((a, b) => b.event_points - a.event_points)
        .slice(0, 5)
        .map(h => ({ ...playerInfo(h.player_id), gameweek: h.gameweek, points: h.event_points }));

      // Longest consecutive-scoring streaks: group by player, walk gameweeks
      // in order, count consecutive rows with event_points > 0
      const byPlayer = {};
      history.forEach(h => {
        if (!byPlayer[h.player_id]) byPlayer[h.player_id] = [];
        byPlayer[h.player_id].push(h);
      });

      const streaks = Object.keys(byPlayer).map(pid => {
        const rows = byPlayer[pid].sort((a, b) => a.gameweek - b.gameweek);
        let best = 0, current = 0, bestEndGw = null;
        let prevGw = null;
        for (const row of rows) {
          const consecutive = prevGw !== null && row.gameweek === prevGw + 1;
          if (row.event_points > 0) {
            current = consecutive ? current + 1 : 1;
            if (current > best) { best = current; bestEndGw = row.gameweek; }
          } else {
            current = 0;
          }
          prevGw = row.gameweek;
        }
        return { ...playerInfo(parseInt(pid, 10)), streak: best, through_gameweek: bestEndGw };
      })
      .filter(s => s.streak > 0)
      .sort((a, b) => b.streak - a.streak)
      .slice(0, 5);

      return res.status(200).json({ bestGameweeks, streaks, gameweeksRecorded: [...new Set(history.map(h => h.gameweek))].length });
    } catch (error) {
      console.error('Records fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch records', details: error.message });
    }
  }

  // Read-only mode: GET /api/sync-players?id_change_log=true
  // Surfaces the player-ID watchlist this sync already builds every run —
  // previously logged silently with no admin-facing way to actually see
  // it, which defeats the point of having the safeguard at all.
  if (req.method === 'GET' && params.get('id_change_log') === 'true') {
    try {
      const { data: changes, error } = await supabase
        .from('player_id_change_log')
        .select('*')
        .order('detected_at', { ascending: false })
        .limit(100);
      if (error) return res.status(500).json({ error: 'Failed to fetch change log', details: error.message });
      return res.status(200).json({ changes: changes || [] });
    } catch (error) {
      console.error('ID change log fetch error:', error);
      return res.status(500).json({ error: 'Failed to fetch change log', details: error.message });
    }
  }


  // Read-only mode: GET /api/sync-players?summary=123
  // Proxies FPL's per-gameweek history for one player (goals/assists/cards
  // etc *for that specific gameweek*, not season totals) — FPL blocks
  // direct browser calls, so this fetches server-side and returns just the
  // most recent gameweek's row.
  if (req.method === 'GET' && params.get('summary')) {
    try {
      const playerId = params.get('summary');
      const [clockRes, summaryRes] = await Promise.all([
        supabase.from('master_clock').select('current_gameweek').eq('id', 'current').maybeSingle(),
        fetch(`https://fantasy.premierleague.com/api/element-summary/${playerId}/`)
      ]);
      const summaryData = await summaryRes.json();

      // Which gameweek to show "this gameweek" stats for comes from
      // master_clock — the one global pointer every tournament follows —
      // not FPL's live is_current/is_next flags.
      const currentGw = clockRes.data?.current_gameweek;

      const history = summaryData.history || [];
      // Prefer the row matching master_clock's gameweek; fall back to the
      // most recently played one if that gameweek hasn't kicked off yet.
      const gwRow = history.find(h => h.round === currentGw) || history[history.length - 1] || null;

      return res.status(200).json({
        gameweek: gwRow ? gwRow.round : null,
        stats: gwRow ? {
          minutes: gwRow.minutes,
          goals_scored: gwRow.goals_scored,
          assists: gwRow.assists,
          yellow_cards: gwRow.yellow_cards,
          red_cards: gwRow.red_cards,
          clean_sheets: gwRow.clean_sheets,
          bonus: gwRow.bonus,
          total_points: gwRow.total_points
        } : null
      });
    } catch (error) {
      console.error('Player summary error:', error);
      return res.status(500).json({ error: 'Failed to fetch player summary', details: error.message });
    }
  }

  try {
    const forceResult = await syncPlayersFromFPL(supabase, { force: false });
    if (forceResult.skipped) return res.status(200).json(forceResult);
    return res.status(200).json({ message: 'Players synced successfully', total: forceResult.total, results: forceResult.results });
  } catch (error) {
    console.error('Sync players error:', error);
    return res.status(500).json({ error: 'Failed to sync players', details: error.message });
  }
};

// Extracted so the settlement chain can force a genuinely fresh FPL pull
// immediately before Fantasy Manager's one-shot gameweek lock-in, instead
// of trusting whatever's already sitting in players.event_points from an
// earlier point in the same poll cycle. Confirmed as a real risk by
// external audit: the real poll sequence runs live-scores (which can
// trigger Fantasy settlement) BEFORE sync-players refreshes real FPL
// data in that same cycle — settlement's one-shot atomic claim means a
// stale or FPL-provisional (not yet fully confirmed) value locked in
// this way would never be revisited. force:true skips the normal
// 90-second debounce (correctness matters more than rate-limit
// conservatism at this one-time, real-money moment) but still respects
// polling_paused — if the admin is deliberately testing with fake data,
// forcing a real FPL fetch here would be wrong, not just unnecessary.
async function syncPlayersFromFPL(supabase, { force = false } = {}) {
    if (!force) {
      // Debounce: if this ran within the last 90 seconds (from any user's
      // poll), skip straight to a no-op response instead of hitting FPL
      // again. Without this, N concurrent users polling every 2 minutes
      // means N near-simultaneous fetches of the same data.
      const { data: lastSync } = await supabase
        .from('sync_debounce').select('last_synced_at').eq('sync_name', 'sync_players').maybeSingle();
      if (lastSync && lastSync.last_synced_at) {
        const ageMs = Date.now() - new Date(lastSync.last_synced_at).getTime();
        if (ageMs < 90000) {
          return { skipped: true, reason: 'synced recently', age_seconds: Math.round(ageMs / 1000) };
        }
      }
      await supabase.from('sync_debounce').upsert({ sync_name: 'sync_players', last_synced_at: new Date().toISOString() }, { onConflict: 'sync_name' });
    }

    // Testing safety switch — same as live-scores/sync-fixtures. Always
    // respected, force or not — a forced sync during deliberate testing
    // with fake data would fetch irrelevant real-world data and corrupt
    // the test setup, not just be redundant.
    const { data: pauseClock } = await supabase
      .from('master_clock').select('polling_paused').eq('id', 'current').maybeSingle();
    if (pauseClock?.polling_paused) {
      return { skipped: true, reason: 'Live polling is paused for testing — resume it in /admin.' };
    }

    // Fetch from FPL API
    const response = await fetch(FPL_BOOTSTRAP_URL);
    const data = await response.json();

    const results = {
      teams_synced: 0,
      players_synced: 0,
      errors: []
    };

    // --- Teams first: players.team is a foreign key referencing teams(id),
    // so teams must exist before players are written. ---
    const teamRows = (data.teams || []).map(team => ({
      id: team.id,
      name: team.name,
      short_name: team.short_name,
      code: team.code,
      strength: team.strength,
      strength_overall_home: team.strength_overall_home,
      strength_overall_away: team.strength_overall_away,
      strength_attack_home: team.strength_attack_home,
      strength_attack_away: team.strength_attack_away,
      strength_defence_home: team.strength_defence_home,
      strength_defence_away: team.strength_defence_away,
      updated_at: new Date().toISOString()
    }));

    if (teamRows.length > 0) {
      const { error: teamsError } = await supabase
        .from('teams')
        .upsert(teamRows, { onConflict: 'id' });

      if (teamsError) {
        results.errors.push({ stage: 'teams', error: teamsError.message });
      } else {
        results.teams_synced = teamRows.length;
      }
    }

    // --- Players: one bulk upsert instead of one request per player. ---
    const players = data.elements;
    const playerRows = players.map(player => ({
      id: player.id,
      first_name: player.first_name,
      second_name: player.second_name,
      web_name: player.web_name,
      team: player.team,
      element_type: player.element_type,
      now_cost: player.now_cost,
      photo: player.photo,
      news: player.news || null,
      news_added: player.news_added || null,
      chance_of_playing_next_round: player.chance_of_playing_next_round,
      chance_of_playing_this_round: player.chance_of_playing_this_round,
      status: player.status,
      form: parseFloat(player.form) || 0,
      total_points: player.total_points,
      event_points: player.event_points,
      points_per_game: parseFloat(player.points_per_game) || 0,
      minutes: player.minutes,
      goals_scored: player.goals_scored,
      assists: player.assists,
      clean_sheets: player.clean_sheets,
      goals_conceded: player.goals_conceded,
      own_goals: player.own_goals,
      penalties_saved: player.penalties_saved,
      penalties_missed: player.penalties_missed,
      yellow_cards: player.yellow_cards,
      red_cards: player.red_cards,
      saves: player.saves,
      bonus: player.bonus,
      bps: player.bps,
      influence: parseFloat(player.influence) || 0,
      creativity: parseFloat(player.creativity) || 0,
      threat: parseFloat(player.threat) || 0,
      ict_index: parseFloat(player.ict_index) || 0,
      updated_at: new Date().toISOString()
    }));

    // Supabase/Postgres can choke on one gigantic multi-thousand-row upsert
    // over HTTP, so chunk it — still only ~7 requests instead of 700+.
    const CHUNK_SIZE = 100;
    for (let i = 0; i < playerRows.length; i += CHUNK_SIZE) {
      const chunk = playerRows.slice(i, i + CHUNK_SIZE);
      const { error } = await supabase
        .from('players')
        .upsert(chunk, { onConflict: 'id' });

      if (error) {
        results.errors.push({ stage: 'players', chunk_start: i, error: error.message });
      } else {
        results.players_synced += chunk.length;
      }
    }

    // Player ID watchlist: compares each player's current name/team
    // against what we last saw for that same numeric ID. If FPL ever
    // reassigns an ID to a different real player, this catches it the
    // very next sync and logs it — rather than the change happening
    // silently and only being noticed months later by someone spotting
    // an implausible stat line on a card, the way this got found before.
    try {
      const { data: watchRows } = await supabase.from('player_id_watch').select('player_id, last_known_web_name, last_known_team');
      const watchByPid = {};
      (watchRows || []).forEach(w => { watchByPid[w.player_id] = w; });

      const changeLogRows = [];
      const watchUpsertRows = [];
      playerRows.forEach(p => {
        const prev = watchByPid[p.id];
        if (prev) {
          const nameChanged = prev.last_known_web_name !== p.web_name;
          const teamChanged = prev.last_known_team !== p.team;
          if (nameChanged || teamChanged) {
            changeLogRows.push({
              player_id: p.id,
              old_web_name: prev.last_known_web_name, new_web_name: p.web_name,
              old_team: prev.last_known_team, new_team: p.team,
              // The name changing is the actually suspicious case — it
              // means this numeric ID likely belongs to a different real
              // person now. Team changing alone, with the same name, is
              // just a normal transfer — expected, routine, not a bug.
              change_type: nameChanged ? 'possible_id_reassignment' : 'transfer'
            });
          }
        }
        watchUpsertRows.push({ player_id: p.id, last_known_web_name: p.web_name, last_known_team: p.team, last_checked_at: new Date().toISOString() });
      });

      const suspiciousCount = changeLogRows.filter(c => c.change_type === 'possible_id_reassignment').length;
      if (changeLogRows.length > 0) {
        await supabase.from('player_id_change_log').insert(changeLogRows);
        if (suspiciousCount > 0) {
          console.warn(`[sync-players] ${suspiciousCount} possible player ID reassignment(s) detected:`, changeLogRows.filter(c => c.change_type === 'possible_id_reassignment'));
        }
      }

      const WATCH_CHUNK = 200;
      for (let i = 0; i < watchUpsertRows.length; i += WATCH_CHUNK) {
        await supabase.from('player_id_watch').upsert(watchUpsertRows.slice(i, i + WATCH_CHUNK), { onConflict: 'player_id' });
      }

      results.id_changes_detected = changeLogRows.length;
    } catch (watchErr) {
      console.error('[sync-players] watchlist check failed (non-fatal):', watchErr);
    }

    return { total: players.length, results };
}

module.exports.syncPlayersFromFPL = syncPlayersFromFPL;

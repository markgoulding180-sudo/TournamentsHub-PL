// Vercel Function: Champions League sync - fixtures + results from football-data.org
// Two jobs in one pass, same as the World Cup LMS system this was adapted from:
//   1. Sync the real fixture list (teams, matchdays, kickoff times) - safe to run
//      repeatedly, only fills in what's missing/changed.
//   2. Process any newly-finished matches and score every pick against them.
//
// Reuses the same football-data.org token as the (now redundant) World Cup
// tournament, per instruction - both draw from the same 10 req/min free
// tier, but only one of the two tournaments is ever actually running at a
// time in practice.
const { createClient } = require('@supabase/supabase-js');

const FOOTBALL_DATA_TOKEN = process.env.FOOTBALL_DATA_TOKEN || 'aef925b3b2df4c6e922f08a5498bdab0';
const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4/competitions/CL';

// Points structure - league phase matchdays escalate gently, knockout
// rounds escalate more sharply as they get harder to call correctly.
// Same spirit as darts' round-doubling, adapted to this format's shape.
const POINTS_BY_STAGE = { matchday: 3, r16: 6, qf: 8, sf: 10, final: 15 };

// football-data.org's own stage/group labels for the knockout rounds -
// used to map their fixtures to our matchday/round fields.
const STAGE_TO_ROUND = {
  'LAST_16': 'r16',
  'QUARTER_FINALS': 'qf',
  'SEMI_FINALS': 'sf',
  'FINAL': 'final'
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST' && !req.body) {
    await new Promise((resolve) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => { try { req.body = JSON.parse(data); } catch { req.body = {}; } resolve(); });
    });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET);

  try {
    const { data: tournament } = await supabase
      .schema('champions_league').from('tournaments').select('*')
      .order('created_at', { ascending: false }).limit(1).maybeSingle();

    if (!tournament) return res.status(200).json({ success: true, message: 'No champions_league tournament exists yet.' });

    const results = { teamsCreated: 0, matchesCreated: 0, matchesUpdated: 0, picksScored: 0, errors: [] };

    // ── Step 1: Sync teams ────────────────────────────────
    const teamsResponse = await fetch(`${FOOTBALL_DATA_BASE}/teams`, { headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN } });
    if (!teamsResponse.ok) {
      const errorText = await teamsResponse.text();
      return res.status(500).json({ error: `football-data.org teams error: ${teamsResponse.status} — ${errorText}` });
    }
    const teamsData = await teamsResponse.json();
    const realTeams = teamsData.teams || [];

    if (realTeams.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No real teams available yet from football-data.org — league phase draw likely hasn\'t happened.',
        ...results
      });
    }

    const { data: existingTeams } = await supabase.schema('champions_league').from('teams').select('id, name, external_team_id').eq('tournament_id', tournament.id);
    const existingByExternalId = new Map((existingTeams || []).filter(t => t.external_team_id).map(t => [t.external_team_id, t]));
    const placeholderTeams = (existingTeams || []).filter(t => t.name.startsWith('Team ') && !t.external_team_id);

    const teamIdMap = new Map(); // external_team_id -> our team id

    for (let i = 0; i < realTeams.length; i++) {
      const rt = realTeams[i];
      const existing = existingByExternalId.get(rt.id);
      if (existing) {
        teamIdMap.set(rt.id, existing.id);
        continue;
      }
      // Reuse a placeholder row if one's still sitting unused, rather
      // than leaving 36 orphaned placeholders alongside 36 real teams.
      const placeholder = placeholderTeams[i];
      if (placeholder) {
        await supabase.schema('champions_league').from('teams')
          .update({ name: rt.name, short_name: rt.tla || rt.shortName, crest_url: rt.crest, external_team_id: rt.id })
          .eq('id', placeholder.id);
        teamIdMap.set(rt.id, placeholder.id);
      } else {
        const { data: newTeam } = await supabase.schema('champions_league').from('teams')
          .insert({ tournament_id: tournament.id, name: rt.name, short_name: rt.tla || rt.shortName, crest_url: rt.crest, external_team_id: rt.id })
          .select().single();
        if (newTeam) { teamIdMap.set(rt.id, newTeam.id); results.teamsCreated++; }
      }
    }

    // ── Step 2: Sync matches ──────────────────────────────
    const matchesResponse = await fetch(`${FOOTBALL_DATA_BASE}/matches`, { headers: { 'X-Auth-Token': FOOTBALL_DATA_TOKEN } });
    if (!matchesResponse.ok) {
      const errorText = await matchesResponse.text();
      return res.status(500).json({ error: `football-data.org matches error: ${matchesResponse.status} — ${errorText}`, ...results });
    }
    const matchesData = await matchesResponse.json();
    const realMatches = matchesData.matches || [];

    const { data: existingMatches } = await supabase.schema('champions_league').from('matches').select('*').eq('tournament_id', tournament.id);
    const existingByExternalId2 = new Map((existingMatches || []).filter(m => m.external_match_id).map(m => [m.external_match_id, m]));

    for (const fixture of realMatches) {
      const homeTeamId = teamIdMap.get(fixture.homeTeam?.id);
      const awayTeamId = teamIdMap.get(fixture.awayTeam?.id);
      if (!homeTeamId || !awayTeamId) continue; // team not yet mapped (e.g. qualifying-round fixtures before league phase teams are known)

      const matchday = fixture.stage === 'LEAGUE_STAGE' ? fixture.matchday : null;
      const round = STAGE_TO_ROUND[fixture.stage] || null;
      if (!matchday && !round) continue; // playoff round intentionally excluded, per the real design decision

      const existing = existingByExternalId2.get(fixture.id);
      const matchFields = {
        tournament_id: tournament.id, matchday, round,
        home_team_id: homeTeamId, away_team_id: awayTeamId,
        kickoff_time: fixture.utcDate, external_match_id: fixture.id
      };

      if (existing) {
        // Only touch kickoff time / team assignment here - status/scores
        // are handled separately below, only for genuinely finished
        // matches, so an in-progress match's real score (if we ever add
        // live tracking) is never blindly overwritten mid-poll.
        await supabase.schema('champions_league').from('matches').update(matchFields).eq('id', existing.id);
      } else {
        await supabase.schema('champions_league').from('matches').insert(matchFields);
        results.matchesCreated++;
      }
    }

    // ── Step 3: Process finished fixtures - atomic claim per match ──
    const finishedFixtures = realMatches.filter(f => f.status === 'FINISHED' && f.score?.fullTime?.home !== null);

    const { data: currentMatches } = await supabase.schema('champions_league').from('matches').select('*').eq('tournament_id', tournament.id).eq('status', 'upcoming');
    const upcomingByExternalId = new Map((currentMatches || []).filter(m => m.external_match_id).map(m => [m.external_match_id, m]));

    for (const fixture of finishedFixtures) {
      const dbMatch = upcomingByExternalId.get(fixture.id);
      if (!dbMatch) continue; // already finished in our DB, or not tracked

      const homeScore = fixture.score.fullTime.home;
      const awayScore = fixture.score.fullTime.away;
      const winnerTeamId = homeScore > awayScore ? dbMatch.home_team_id : awayScore > homeScore ? dbMatch.away_team_id : null;

      // Same atomic-claim pattern proven in the World Cup system - the
      // WHERE clause includes status='upcoming', so if two polling
      // requests race, only one can actually claim this row. Checking
      // the returned rows tells us definitively whether THIS request
      // won, unlike a plain SELECT beforehand which both requests would
      // see as still-upcoming right up until one of them commits.
      const { data: claimedRows } = await supabase.schema('champions_league').from('matches')
        .update({ status: 'finished', home_score: homeScore, away_score: awayScore, winner_team_id: winnerTeamId })
        .eq('id', dbMatch.id).eq('status', 'upcoming').select('id');

      if (!claimedRows || claimedRows.length === 0) continue; // another request already claimed it
      results.matchesUpdated++;

      // Score every pick made for this exact matchday/round against the
      // two teams that actually played it.
      const stageKey = dbMatch.matchday ? 'matchday' : dbMatch.round;
      const winPoints = POINTS_BY_STAGE[stageKey] || 3;
      const matchFilter = dbMatch.matchday ? { matchday: dbMatch.matchday } : { round: dbMatch.round };

      const { data: relevantPicks } = await supabase.schema('champions_league').from('picks').select('*')
        .match(matchFilter).in('team_id', [dbMatch.home_team_id, dbMatch.away_team_id]);

      for (const pick of (relevantPicks || [])) {
        const pickedWinner = pick.team_id === winnerTeamId;
        let points = pickedWinner ? winPoints : 0;
        if (pickedWinner && ['qf', 'sf', 'final'].includes(dbMatch.round)
            && pick.predicted_home_score === homeScore && pick.predicted_away_score === awayScore) {
          points += Math.round(winPoints / 2);
        }
        await supabase.schema('champions_league').from('picks').update({ result: pickedWinner ? 'win' : 'loss', points_earned: points }).eq('id', pick.id);
        results.picksScored++;

        if (points > 0) {
          const { data: entryRow } = await supabase.schema('champions_league').from('tournament_entries').select('entry_points').eq('id', pick.entry_id).maybeSingle();
          await supabase.schema('champions_league').from('tournament_entries')
            .update({ entry_points: (entryRow?.entry_points || 0) + points }).eq('id', pick.entry_id);
        }
      }
    }

    return res.status(200).json({ success: true, ...results });
  } catch (error) {
    console.error('cl-sync error:', error);
    return res.status(500).json({ error: error.message });
  }
};

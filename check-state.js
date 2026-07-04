const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET
);

async function checkState() {
  console.log('=== CHECKING TOURNAMENT STATE ===\n');
  
  // 1. Check tournaments
  const { data: tournaments, error: tError } = await supabase.from('tournaments').select('*');
  if (tError) console.error('Tournaments error:', tError);
  console.log('TOURNAMENTS:');
  tournaments?.forEach(t => {
    console.log(`  ID: ${t.id}, Name: ${t.name}, GW: ${t.gameweek}-${t.end_gameweek || t.gameweek}, Status: ${t.status}`);
  });
  
  // 2. Check tournament entries
  const { data: entries, error: eError } = await supabase.from('tournament_entries').select('*, users:user_id(username)');
  if (eError) console.error('Entries error:', eError);
  console.log('\nTOURNAMENT ENTRIES:');
  entries?.forEach(e => {
    console.log(`  User: ${e.users?.username || e.user_id}, Tournament: ${e.tournament_id}, Points: ${e.entry_points}, Rank: ${e.rank}`);
  });
  
  // 3. Check predictions for current GW
  const { data: predictions, error: pError } = await supabase.from('predictions').select('*');
  if (pError) console.error('Predictions error:', pError);
  console.log('\nCURRENT PREDICTIONS:');
  console.log(`  Total predictions: ${predictions?.length || 0}`);
  predictions?.forEach(p => {
    console.log(`    User: ${p.user_id.substring(0,8)}..., Match: ${p.match_id.substring(0,8)}..., GW: ${p.gameweek}, Result: ${p.predicted_result}, Points: ${p.points_earned}`);
  });
  
  // 4. Check prediction_history
  const { data: history, error: hError } = await supabase.from('prediction_history').select('*');
  if (hError) console.error('History error:', hError);
  console.log('\nPREDICTION HISTORY:');
  console.log(`  Total history records: ${history?.length || 0}`);
  history?.forEach(h => {
    console.log(`    User: ${h.user_id.substring(0,8)}..., GW${h.gameweek}, ${h.home_team} vs ${h.away_team}, Points: ${h.points_earned}`);
  });
  
  // 5. Check matches
  const { data: matches, error: mError } = await supabase.from('matches').select('*');
  if (mError) console.error('Matches error:', mError);
  console.log('\nMATCHES:');
  matches?.forEach(m => {
    console.log(`  GW${m.gameweek}: ${m.home_team} vs ${m.away_team}, Status: ${m.status}, Score: ${m.home_score ?? '-'}-${m.away_score ?? '-'}`);
  });
  
  // 6. Check settings
  const { data: settings, error: sError } = await supabase.from('settings').select('*');
  if (sError) console.error('Settings error:', sError);
  console.log('\nSETTINGS:');
  settings?.forEach(s => {
    console.log(`  ${s.key}: ${s.value}`);
  });
  
  // 7. Check gameweek_summary
  const { data: summaries, error: sumError } = await supabase.from('gameweek_summary').select('*');
  if (sumError) console.error('Summaries error:', sumError);
  console.log('\nGAMEWEEK SUMMARIES:');
  console.log(`  Total summaries: ${summaries?.length || 0}`);
  summaries?.forEach(s => {
    console.log(`    User: ${s.user_id.substring(0,8)}..., GW${s.gameweek}, Points: ${s.total_points}`);
  });
  
  console.log('\n=== STATE CHECK COMPLETE ===');
}

checkState().catch(console.error);

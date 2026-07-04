// Check all data
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sdevgsxrmontdlysjwuq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qQ94OstBkCkrNrkZskU7MQ_QMkidT6A';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkAllData() {
  console.log('=== Checking All Data ===\n');
  
  // Check all predictions
  const { data: allPreds, error: pErr } = await supabase.from('predictions').select('*');
  console.log(`Total predictions: ${allPreds?.length || 0}`);
  if (allPreds && allPreds.length > 0) {
    console.log('Sample prediction:', allPreds[0]);
  }
  
  // Check all tournament entries
  const { data: allEntries, error: eErr } = await supabase.from('tournament_entries').select('*');
  console.log(`\nTotal tournament entries: ${allEntries?.length || 0}`);
  if (allEntries && allEntries.length > 0) {
    console.log('Sample entry:', allEntries[0]);
  }
  
  // Check all matches for GW35
  const { data: gw35Matches, error: mErr } = await supabase.from('matches').select('*').eq('gameweek', 35);
  console.log(`\nGW35 matches: ${gw35Matches?.length || 0}`);
  
  // Check all tournaments
  const { data: tournaments, error: tErr } = await supabase.from('tournaments').select('*');
  console.log(`\nTournaments: ${tournaments?.length || 0}`);
  if (tournaments) {
    tournaments.forEach(t => console.log(`  - ${t.name} (ID: ${t.id})`));
  }
}

checkAllData().catch(console.error);

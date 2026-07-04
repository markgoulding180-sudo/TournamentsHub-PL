// Check GW35 predictions data
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sdevgsxrmontdlysjwuq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_qQ94OstBkCkrNrkZskU7MQ_QMkidT6A';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function checkData() {
  console.log('=== Checking GW35 Predictions Data ===\n');
  
  // Get all users
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, username, display_name');
  
  if (usersError) {
    console.error('Error fetching users:', usersError);
    return;
  }
  
  console.log(`Found ${users.length} users:\n`);
  
  for (const user of users) {
    console.log(`\n--- User: ${user.display_name || user.username} (${user.username}) ---`);
    
    // Get user's tournament memberships
    const { data: memberships, error: memError } = await supabase
      .from('tournament_entries')
      .select('*')
      .eq('user_id', user.id);
    
    if (memError) {
      console.error('  Error fetching memberships:', memError);
    } else {
      console.log(`  Tournament entries: ${memberships?.length || 0}`);
      if (memberships && memberships.length > 0) {
        // Get tournament names separately
        for (const m of memberships) {
          const { data: t } = await supabase.from('tournaments').select('name').eq('id', m.tournament_id).single();
          console.log(`    - ${t?.name || 'Unknown'} (entry #${m.entry_number})`);
        }
      }
    }
    
    // Get GW35 predictions
    const { data: predictions, error: predError } = await supabase
      .from('predictions')
      .select('*')
      .eq('user_id', user.id)
      .eq('gameweek', 35);
    
    if (predError) {
      console.error('  Error fetching predictions:', predError);
    } else {
      console.log(`  GW35 Predictions: ${predictions?.length || 0}`);
      if (predictions && predictions.length > 0) {
        for (const p of predictions) {
          const { data: match } = await supabase.from('matches').select('home_team, away_team').eq('id', p.match_id).single();
          const home = match?.home_team || '?';
          const away = match?.away_team || '?';
          const joker = p.joker_used ? ' [JOKER]' : '';
          console.log(`    - ${home} vs ${away}: ${p.home_score}-${p.away_score}${joker}`);
        }
      }
    }
  }
  
  // Summary
  console.log('\n=== Summary ===');
  const { data: allPreds, error: countError } = await supabase
    .from('predictions')
    .select('user_id, users(username, display_name)')
    .eq('gameweek', 35);
  
  if (!countError && allPreds) {
    const userPredCounts = {};
    allPreds.forEach(p => {
      const name = p.users?.display_name || p.users?.username || p.user_id;
      userPredCounts[name] = (userPredCounts[name] || 0) + 1;
    });
    
    console.log('Predictions per user for GW35:');
    Object.entries(userPredCounts).forEach(([name, count]) => {
      console.log(`  ${name}: ${count} predictions`);
    });
  }
}

checkData().catch(console.error);

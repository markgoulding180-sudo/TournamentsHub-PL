// Check predictions for a specific match
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sdevgsxrmontdlysjwuq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkZXZnc3hybW50ZGx5c2p3dXEiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NTk1MTQ0MCwiZXhwIjoyMDYxNTI3NDQwfQ.qQ94OstBkCkrNrkZskU7MQ_QMkidT6A';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function checkPredictions() {
  console.log('=== Checking Predictions for GW35 ===\n');
  
  // Get all matches for GW35
  const { data: matches, error: matchError } = await supabase
    .from('matches')
    .select('id, home_team, away_team, status, home_score, away_score')
    .eq('gameweek', 35);
  
  if (matchError) {
    console.error('Error fetching matches:', matchError);
    return;
  }
  
  console.log(`Found ${matches?.length || 0} matches for GW35:\n`);
  
  for (const match of matches || []) {
    // Get predictions for this match
    const { data: predictions, error: predError } = await supabase
      .from('predictions')
      .select('*, users(username, display_name)')
      .eq('match_id', match.id);
    
    const predCount = predictions?.length || 0;
    const status = match.status === 'finished' ? '✓ FINISHED' : match.status === 'live' ? '● LIVE' : '○ UPCOMING';
    const score = match.home_score !== null ? ` (${match.home_score}-${match.away_score})` : '';
    
    console.log(`${status} ${match.home_team} vs ${match.away_team}${score}`);
    console.log(`  Match ID: ${match.id}`);
    console.log(`  Predictions: ${predCount}`);
    
    if (predictions && predictions.length > 0) {
      predictions.forEach(p => {
        const user = p.users?.display_name || p.users?.username || 'Unknown';
        const joker = p.joker_used ? ' [JOKER]' : '';
        const points = p.points_earned !== null ? ` = ${p.points_earned} pts` : '';
        console.log(`    - ${user}: ${p.home_score}-${p.away_score} (${p.predicted_result})${joker}${points}`);
      });
    }
    console.log('');
  }
}

checkPredictions().catch(console.error);

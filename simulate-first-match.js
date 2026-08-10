// Simulate GW35 - First match only (Arsenal vs Bournemouth)
const { createClient } = require('@supabase/supabase-js');

// NOTE: this pointed at a Supabase project that no longer exists (confirmed deleted, Aug 2026).
// Kept as a working template — set these env vars to point it at a real project before running.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function simulateFirstMatch() {
  console.log('=== Simulating GW35 - First Match Only ===\n');
  
  // First match: Arsenal vs Bournemouth
  const firstMatch = {
    home: 'Arsenal',
    away: 'Bournemouth', 
    home_score: 2,
    away_score: 0,
    result: 'H' // Home win
  };
  
  console.log(`Setting result: ${firstMatch.home} ${firstMatch.home_score}-${firstMatch.away_score} ${firstMatch.away}`);
  
  // Find the match
  const { data: match, error: matchError } = await supabase
    .from('matches')
    .select('id, home_team, away_team')
    .eq('gameweek', 35)
    .ilike('home_team', '%Arsenal%')
    .single();
  
  if (matchError) {
    console.error('Error finding match:', matchError);
    // Try without filter to see what's there
    const { data: allMatches } = await supabase.from('matches').select('*').eq('gameweek', 35);
    console.log('All GW35 matches:', allMatches);
    return;
  }
  
  console.log(`Found match: ${match.home_team} vs ${match.away_team} (ID: ${match.id})`);
  
  // Update match with result
  const { error: updateError } = await supabase
    .from('matches')
    .update({
      home_score: firstMatch.home_score,
      away_score: firstMatch.away_score,
      result: firstMatch.result,
      status: 'finished'
    })
    .eq('id', match.id);
  
  if (updateError) {
    console.error('Error updating match:', updateError);
    return;
  }
  
  console.log('✅ Match result saved\n');
  
  // Get all predictions for this match
  const { data: predictions, error: predError } = await supabase
    .from('predictions')
    .select('*, users(username, display_name)')
    .eq('match_id', match.id);
  
  if (predError) {
    console.error('Error fetching predictions:', predError);
    return;
  }
  
  console.log(`Found ${predictions?.length || 0} predictions for this match:\n`);
  
  // Score each prediction
  for (const pred of predictions) {
    const userName = pred.users?.display_name || pred.users?.username || 'Unknown';
    let points = 0;
    let reason = [];
    
    // Check if correct result (H, D, or A)
    if (pred.predicted_result === firstMatch.result) {
      points += 10;
      reason.push('Correct result (+10)');
      
      // Check if exact score
      if (pred.home_score === firstMatch.home_score && pred.away_score === firstMatch.away_score) {
        points += 10;
        reason.push('Exact score (+10)');
      }
    }
    
    // Apply joker multiplier
    let totalPoints = points;
    if (pred.joker_used) {
      totalPoints = points * 2;
      reason.push('JOKER (x2)');
    }
    
    console.log(`${userName}:`);
    console.log(`  Predicted: ${pred.home_score}-${pred.away_score} (${pred.predicted_result})`);
    console.log(`  Points: ${points} → ${totalPoints} [${reason.join(', ')}]`);
    
    // Update prediction
    const { error: updatePredError } = await supabase
      .from('predictions')
      .update({ points_earned: totalPoints })
      .eq('id', pred.id);
    
    if (updatePredError) {
      console.error('  Error updating prediction:', updatePredError);
    } else {
      console.log('  ✅ Saved\n');
    }
  }
  
  console.log('\n=== Simulation Complete ===');
  console.log('Check the leaderboard and predictions pages to verify updates.');
}

simulateFirstMatch().catch(console.error);

// Simulate Leeds vs Burnley match result and test points calculation
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://sdevgsxrmontdlysjwuq.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkZXZnc3hybW50ZGx5c2p3dXEiLCJyb2xlIjoiYW5vbiIsImlhdCI6MTc0NTk1MTQ0MCwiZXhwIjoyMDYxNTI3NDQwfQ.qQ94OstBkCkrNrkZskU7MQ_QMkidT6A';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function simulateMatch() {
  console.log('=== Simulating Leeds vs Burnley ===\n');
  
  // Step 1: Find and update the match
  console.log('Step 1: Updating match result...');
  
  const { data: match, error: findError } = await supabase
    .from('matches')
    .select('*')
    .eq('gameweek', 35)
    .or('home_team.ilike.%Leeds%,away_team.ilike.%Leeds%')
    .single();
  
  if (findError) {
    console.error('Error finding match:', findError);
    // List all GW35 matches
    const { data: allMatches } = await supabase.from('matches').select('*').eq('gameweek', 35);
    console.log('\nAll GW35 matches:');
    allMatches?.forEach(m => console.log(`  - ${m.home_team} vs ${m.away_team}`));
    return;
  }
  
  console.log(`Found: ${match.home_team} vs ${match.away_team}`);
  console.log(`Current status: ${match.status}`);
  
  // Check if it's Leeds vs Burnley
  const isLeedsBurnley = match.home_team.toLowerCase().includes('leeds') && 
                         match.away_team.toLowerCase().includes('burnley');
  const isBurnleyLeeds = match.home_team.toLowerCase().includes('burnley') && 
                         match.away_team.toLowerCase().includes('leeds');
  
  if (!isLeedsBurnley && !isBurnleyLeeds) {
    console.log('\n⚠️  This is not Leeds vs Burnley!');
    console.log('Searching for correct match...');
    
    const { data: allMatches } = await supabase.from('matches').select('*').eq('gameweek', 35);
    const correctMatch = allMatches?.find(m => 
      (m.home_team.toLowerCase().includes('leeds') && m.away_team.toLowerCase().includes('burnley')) ||
      (m.home_team.toLowerCase().includes('burnley') && m.away_team.toLowerCase().includes('leeds'))
    );
    
    if (!correctMatch) {
      console.log('❌ Leeds vs Burnley not found in GW35');
      return;
    }
    
    console.log(`Found correct match: ${correctMatch.home_team} vs ${correctMatch.away_team}`);
  }
  
  // Determine correct scores based on who is home/away
  // User wants: Leeds 0-2 Burnley (Away win)
  let homeScore, awayScore, result;
  
  if (match.home_team.toLowerCase().includes('leeds')) {
    // Leeds at home: Leeds 0-2 Burnley
    homeScore = 0;
    awayScore = 2;
    result = 'A'; // Away win
  } else {
    // Burnley at home: Burnley 2-0 Leeds (but user wants Leeds to lose 0-2)
    // So if Burnley is home, result would be Burnley 2-0 Leeds = Home win
    homeScore = 2;
    awayScore = 0;
    result = 'H'; // Home win (Burnley wins)
  }
  
  console.log(`\nSetting result: ${match.home_team} ${homeScore}-${awayScore} ${match.away_team} (${result})`);
  
  // Update match
  const { error: updateError } = await supabase
    .from('matches')
    .update({
      home_score: homeScore,
      away_score: awayScore,
      result: result,
      status: 'finished'
    })
    .eq('id', match.id);
  
  if (updateError) {
    console.error('❌ Error updating match:', updateError);
    return;
  }
  
  console.log('✅ Match updated to FINISHED\n');
  
  // Step 2: Get predictions for this match
  console.log('Step 2: Checking predictions...');
  
  const { data: predictions, error: predError } = await supabase
    .from('predictions')
    .select('*, users(id, username, display_name)')
    .eq('match_id', match.id);
  
  if (predError) {
    console.error('Error fetching predictions:', predError);
    return;
  }
  
  console.log(`Found ${predictions?.length || 0} predictions\n`);
  
  // Step 3: Calculate points
  console.log('Step 3: Calculating points...\n');
  
  const results = [];
  
  for (const pred of predictions) {
    const userName = pred.users?.display_name || pred.users?.username || 'Unknown';
    let points = 0;
    const reasons = [];
    
    // Check correct result
    if (pred.predicted_result === result) {
      points += 10;
      reasons.push('Correct result (+10)');
      
      // Check exact score
      if (pred.home_score === homeScore && pred.away_score === awayScore) {
        points += 10;
        reasons.push('Exact score (+10)');
      }
    }
    
    // Apply joker
    let finalPoints = points;
    if (pred.joker_used) {
      finalPoints = points * 2;
      reasons.push('JOKER x2');
    }
    
    console.log(`${userName}:`);
    console.log(`  Prediction: ${pred.home_score}-${pred.away_score} (${pred.predicted_result}) ${pred.joker_used ? '[JOKER]' : ''}`);
    console.log(`  Points: ${points} → ${finalPoints}`);
    console.log(`  Reasons: ${reasons.join(', ') || 'None'}`);
    
    // Update prediction with points
    const { error: updatePredError } = await supabase
      .from('predictions')
      .update({ points_earned: finalPoints })
      .eq('id', pred.id);
    
    if (updatePredError) {
      console.error(`  ❌ Error saving: ${updatePredError.message}`);
    } else {
      console.log(`  ✅ Saved\n`);
    }
    
    results.push({
      user: userName,
      userId: pred.users?.id,
      predicted: `${pred.home_score}-${pred.away_score}`,
      predictedResult: pred.predicted_result,
      joker: pred.joker_used,
      basePoints: points,
      finalPoints: finalPoints,
      reasons: reasons
    });
  }
  
  // Step 4: Update user totals
  console.log('Step 4: Updating user totals...\n');
  
  const userIds = [...new Set(predictions?.map(p => p.user_id) || [])];
  
  for (const userId of userIds) {
    // Get all predictions for this user
    const { data: userPreds } = await supabase
      .from('predictions')
      .select('points_earned')
      .eq('user_id', userId);
    
    const totalPoints = (userPreds || []).reduce((sum, p) => sum + (p.points_earned || 0), 0);
    const correctScores = (userPreds || []).filter(p => p.points_earned === 20).length;
    
    // Get user name
    const userResult = results.find(r => r.userId === userId);
    const userName = userResult?.user || userId;
    
    console.log(`${userName}: Total = ${totalPoints} points, ${correctScores} correct scores`);
    
    // Update user
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({ 
        total_points: totalPoints, 
        correct_scores: correctScores 
      })
      .eq('id', userId);
    
    if (userUpdateError) {
      console.error(`  ❌ Error updating user: ${userUpdateError.message}`);
    } else {
      console.log(`  ✅ User updated\n`);
    }
  }
  
  // Summary
  console.log('=== SIMULATION COMPLETE ===\n');
  console.log('Results Summary:');
  console.log(`Match: ${match.home_team} ${homeScore}-${awayScore} ${match.away_team}`);
  console.log(`Predictions processed: ${predictions?.length || 0}`);
  console.log('\nPoints awarded:');
  results.forEach(r => {
    console.log(`  ${r.user}: ${r.finalPoints} points (${r.predicted} ${r.predictedResult})`);
  });
  
  console.log('\n✅ Now check:');
  console.log('  1. Leaderboard page - should show updated points');
  console.log('  2. Profile page - should show updated total points');
  console.log('  3. Predictions page - match should show "Full Time"');
}

simulateMatch().catch(console.error);

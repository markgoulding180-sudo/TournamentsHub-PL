#!/usr/bin/env node
/**
 * Simulate GW35 Match Result - Run locally with service role key
 * Usage: node simulate-match.js <match_id> <home_score> <away_score>
 * Or edit the MATCH_CONFIG below and run: node simulate-match.js
 */

const { createClient } = require('@supabase/supabase-js');

// CONFIGURATION - EDIT THESE VALUES
const MATCH_CONFIG = {
  // Option 1: Set match_id manually, or leave null to auto-find Leeds vs Burnley
  match_id: null,
  
  // Option 2: Specify teams to find the match
  home_team: 'Leeds',      // or 'Burnley' if they're home
  away_team: 'Burnley',    // or 'Leeds' if they're home
  
  // The result you want to set
  home_score: 0,
  away_score: 2,
  status: 'finished'
};

// Get service role key from environment or prompt
const SUPABASE_URL = 'https://sdevgsxrmontdlysjwuq.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_KEY environment variable not set');
  console.error('');
  console.error('To set it temporarily, run:');
  console.error('  Windows PowerShell: $env:SUPABASE_SERVICE_KEY="your_key_here"');
  console.error('  Windows CMD: set SUPABASE_SERVICE_KEY=your_key_here');
  console.error('  Linux/Mac: export SUPABASE_SERVICE_KEY=your_key_here');
  console.error('');
  console.error('Then run this script again.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function simulateMatch() {
  console.log('=== GW35 Match Simulation ===\n');
  
  let matchId = MATCH_CONFIG.match_id;
  
  // If no match_id provided, find by team names
  if (!matchId) {
    console.log(`Looking for match: ${MATCH_CONFIG.home_team} vs ${MATCH_CONFIG.away_team}...`);
    
    const { data: match, error } = await supabase
      .from('matches')
      .select('*')
      .eq('gameweek', 35)
      .ilike('home_team', `%${MATCH_CONFIG.home_team}%`)
      .ilike('away_team', `%${MATCH_CONFIG.away_team}%`)
      .single();
    
    if (error || !match) {
      console.error('❌ Match not found. Listing all GW35 matches:');
      const { data: allMatches } = await supabase
        .from('matches')
        .select('id, home_team, away_team, status')
        .eq('gameweek', 35);
      
      allMatches?.forEach(m => {
        console.log(`  - ${m.home_team} vs ${m.away_team} (ID: ${m.id})`);
      });
      return;
    }
    
    matchId = match.id;
    console.log(`✅ Found: ${match.home_team} vs ${match.away_team} (ID: ${matchId})`);
    console.log(`   Current status: ${match.status}\n`);
  }
  
  // Calculate result
  const result = MATCH_CONFIG.home_score > MATCH_CONFIG.away_score ? 'H' :
                 MATCH_CONFIG.away_score > MATCH_CONFIG.home_score ? 'A' : 'D';
  
  console.log(`Setting result: ${MATCH_CONFIG.home_score}-${MATCH_CONFIG.away_score} (${result})`);
  console.log(`Status: ${MATCH_CONFIG.status}\n`);
  
  // Update match
  const { error: updateError } = await supabase
    .from('matches')
    .update({
      home_score: MATCH_CONFIG.home_score,
      away_score: MATCH_CONFIG.away_score,
      result: result,
      status: MATCH_CONFIG.status
    })
    .eq('id', matchId);
  
  if (updateError) {
    console.error('❌ Failed to update match:', updateError);
    return;
  }
  
  console.log('✅ Match updated\n');
  
  // Get predictions for this match
  console.log('Fetching predictions...');
  const { data: predictions, error: predError } = await supabase
    .from('predictions')
    .select('*, users(username, display_name)')
    .eq('match_id', matchId);
  
  if (predError) {
    console.error('❌ Error fetching predictions:', predError);
    return;
  }
  
  console.log(`Found ${predictions?.length || 0} predictions\n`);
  
  // Calculate and update points
  console.log('=== Points Calculation ===\n');
  
  const results = [];
  
  for (const pred of predictions || []) {
    const userName = pred.users?.display_name || pred.users?.username || 'Unknown';
    let points = 0;
    const reasons = [];
    
    // Correct result = 10 points
    if (pred.predicted_result === result) {
      points += 10;
      reasons.push('Correct result (+10)');
      
      // Exact score = +10 points
      if (pred.home_score === MATCH_CONFIG.home_score && 
          pred.away_score === MATCH_CONFIG.away_score) {
        points += 10;
        reasons.push('Exact score (+10)');
      }
    }
    
    // Apply joker
    let finalPoints = points;
    if (pred.joker_used) {
      finalPoints = points * 2;
      reasons.push('JOKER (x2)');
    }
    
    console.log(`${userName}:`);
    console.log(`  Prediction: ${pred.home_score}-${pred.away_score} (${pred.predicted_result}) ${pred.joker_used ? '[JOKER]' : ''}`);
    console.log(`  Points: ${points} → ${finalPoints}`);
    console.log(`  ${reasons.join(', ') || 'No points'}\n`);
    
    // Update prediction
    const { error: updatePredError } = await supabase
      .from('predictions')
      .update({ points_earned: finalPoints })
      .eq('id', pred.id);
    
    if (updatePredError) {
      console.error(`  ❌ Error saving: ${updatePredError.message}`);
    }
    
    results.push({
      userId: pred.user_id,
      userName,
      finalPoints
    });
  }
  
  // Update user totals
  console.log('=== Updating User Totals ===\n');
  
  const userIds = [...new Set(results.map(r => r.userId))];
  
  for (const userId of userIds) {
    // Get all predictions for this user
    const { data: userPreds } = await supabase
      .from('predictions')
      .select('points_earned')
      .eq('user_id', userId);
    
    const totalPoints = (userPreds || []).reduce((sum, p) => sum + (p.points_earned || 0), 0);
    const correctScores = (userPreds || []).filter(p => p.points_earned === 20).length;
    
    const userName = results.find(r => r.userId === userId)?.userName || userId;
    
    console.log(`${userName}: ${totalPoints} total points, ${correctScores} correct scores`);
    
    // Update user
    const { error: userUpdateError } = await supabase
      .from('users')
      .update({ 
        total_points: totalPoints,
        correct_scores: correctScores,
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
    
    if (userUpdateError) {
      console.error(`  ❌ Error: ${userUpdateError.message}`);
    } else {
      console.log(`  ✅ Updated\n`);
    }
  }
  
  console.log('=== SIMULATION COMPLETE ===');
  console.log('\nNext steps:');
  console.log('1. Check leaderboard page - points should be updated');
  console.log('2. Check profile page - total points should show');
  console.log('3. Check predictions page - match should show "Full Time"');
}

simulateMatch().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

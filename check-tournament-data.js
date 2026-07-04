// Check tournament entries data
const fs = require('fs');

// Read the CSV files
const predictions = fs.readFileSync('predictions_rows (1).csv', 'utf8')
  .split('\n')
  .slice(1)
  .filter(line => line.trim())
  .map(line => {
    const cols = line.split(',');
    return {
      user_id: cols[1],
      match_id: cols[2],
      gameweek: cols[3],
      predicted_result: cols[4],
      home_score: cols[5],
      away_score: cols[6],
      points_earned: cols[7]
    };
  });

const matches = fs.readFileSync('matches_rows.csv', 'utf8')
  .split('\n')
  .slice(1)
  .filter(line => line.trim())
  .map(line => {
    const cols = line.split(',');
    return {
      id: cols[0],
      gameweek: cols[1],
      home_team: cols[2],
      away_team: cols[3],
      home_score: cols[8],
      away_score: cols[9],
      result: cols[10],
      status: cols[11]
    };
  });

// Find Leeds vs Burnley match
const leedsBurnley = matches.find(m => 
  m.gameweek === '35' && 
  m.home_team === 'Leeds' && 
  m.away_team === 'Burnley'
);

console.log('=== Leeds vs Burnley Match ===');
console.log('Match ID:', leedsBurnley?.id);
console.log('Score:', leedsBurnley?.home_score, '-', leedsBurnley?.away_score);
console.log('Status:', leedsBurnley?.status);
console.log('Result:', leedsBurnley?.result);
console.log();

// Find predictions for this match
const matchPredictions = predictions.filter(p => p.match_id === leedsBurnley?.id);
console.log('=== Predictions for Leeds vs Burnley ===');
console.log('Total predictions:', matchPredictions.length);
console.log();

// Group by user
const userPoints = {};
matchPredictions.forEach(p => {
  const points = parseInt(p.points_earned) || 0;
  if (!userPoints[p.user_id]) {
    userPoints[p.user_id] = 0;
  }
  userPoints[p.user_id] += points;
});

console.log('Points by user:');
Object.entries(userPoints).forEach(([userId, points]) => {
  console.log(`  User ${userId.substring(0, 8)}...: ${points} points`);
});

// Calculate what tournament_entries should be for GW35
console.log();
console.log('=== Total GW35 Points by User ===');
const gw35Predictions = predictions.filter(p => p.gameweek === '35');
const userTotals = {};
gw35Predictions.forEach(p => {
  const points = parseInt(p.points_earned) || 0;
  if (!userTotals[p.user_id]) {
    userTotals[p.user_id] = 0;
  }
  userTotals[p.user_id] += points;
});

Object.entries(userTotals).forEach(([userId, points]) => {
  console.log(`  User ${userId.substring(0, 8)}...: ${points} total points (GW35)`);
});

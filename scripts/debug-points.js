// Debug script to check tournament entries and predictions
// Run this in browser console on the site

async function debugJessPoints() {
  const SUPABASE_URL = 'https://wnstucpqkqwuturdnvqj.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Induc3R1Y3Bxa3F3dXR1cmRudnFqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDU2NzE3ODcsImV4cCI6MjA2MTI0Nzc4N30.0QeR5w6z8f5z5z5z5z5z5z5z5z5z5z5z5z5z5z5z5z'; // anon key
  
  const supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  
  // Get Jess's user ID (you'll need to know this)
  const jessUsername = 'jess'; // or whatever her username is
  
  const { data: user } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', jessUsername)
    .single();
  
  console.log('User:', user);
  
  if (!user) {
    console.log('User not found');
    return;
  }
  
  // Get her tournament entries
  const { data: entries } = await supabase
    .from('tournament_entries')
    .select('*, tournaments:tournament_id(*)')
    .eq('user_id', user.id);
  
  console.log('Tournament entries:', entries);
  
  // Get her predictions for GW35
  const { data: predictions } = await supabase
    .from('predictions')
    .select('*, matches:match_id(*)')
    .eq('user_id', user.id)
    .eq('gameweek', 35);
  
  console.log('GW35 Predictions:', predictions);
  
  // Calculate what her points should be
  const totalPoints = predictions?.reduce((sum, p) => sum + (p.points_earned || 0), 0);
  console.log('Calculated GW35 points:', totalPoints);
}

debugJessPoints();

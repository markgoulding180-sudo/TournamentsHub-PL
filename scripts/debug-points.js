// Debug script to check tournament entries and predictions
// Run this in browser console on the site

async function debugJessPoints() {
  // NOTE: this pointed at a Supabase project that no longer exists (confirmed deleted, Aug 2026).
  // This is a browser-console script — paste your current project's URL/anon key here before running,
  // e.g. copy them from Settings > API in the Supabase dashboard for whichever project you're debugging.
  const SUPABASE_URL = 'PASTE_CURRENT_PROJECT_URL_HERE';
  const SUPABASE_KEY = 'PASTE_CURRENT_ANON_KEY_HERE'; // anon key
  
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

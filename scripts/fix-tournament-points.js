// Script to recalculate all tournament entry points
// Run this in the browser console or as a Node.js script

const { createClient } = require('@supabase/supabase-js');

// NOTE: this pointed at a Supabase project that no longer exists (confirmed deleted, Aug 2026).
// This is a service_role key — never hardcode it. Set SUPABASE_URL and SUPABASE_SECRET
// as env vars before running, matching scripts/.env.example.
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET = process.env.SUPABASE_SECRET;

async function recalculateTournamentPoints() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET);
  
  console.log('Starting tournament points recalculation...');
  
  // Get all tournaments
  const { data: tournaments, error: tournamentError } = await supabase
    .from('tournaments')
    .select('id, gameweek');
  
  if (tournamentError) {
    console.error('Error fetching tournaments:', tournamentError);
    return;
  }
  
  console.log(`Found ${tournaments.length} tournaments`);
  
  for (const tournament of tournaments) {
    console.log(`\nProcessing tournament: ${tournament.id} (GW${tournament.gameweek})`);
    
    // Get all entries for this tournament
    const { data: entries, error: entryError } = await supabase
      .from('tournament_entries')
      .select('id, user_id, entry_points')
      .eq('tournament_id', tournament.id);
    
    if (entryError) {
      console.error('Error fetching entries:', entryError);
      continue;
    }
    
    console.log(`  Found ${entries.length} entries`);
    
    for (const entry of entries) {
      // Get all predictions for this user in this gameweek
      const { data: predictions, error: predError } = await supabase
        .from('predictions')
        .select('points_earned')
        .eq('user_id', entry.user_id)
        .eq('gameweek', tournament.gameweek);
      
      if (predError) {
        console.error('Error fetching predictions:', predError);
        continue;
      }
      
      const totalPoints = predictions.reduce((sum, p) => sum + (p.points_earned || 0), 0);
      
      if (totalPoints !== entry.entry_points) {
        console.log(`  User ${entry.user_id}: ${entry.entry_points} -> ${totalPoints} points`);
        
        // Update the entry
        const { error: updateError } = await supabase
          .from('tournament_entries')
          .update({ entry_points: totalPoints })
          .eq('id', entry.id);
        
        if (updateError) {
          console.error('Error updating entry:', updateError);
        }
      }
    }
    
    // Recalculate ranks
    const { data: rankedEntries, error: rankError } = await supabase
      .from('tournament_entries')
      .select('id, entry_points')
      .eq('tournament_id', tournament.id)
      .order('entry_points', { ascending: false });
    
    if (rankError) {
      console.error('Error fetching ranked entries:', rankError);
      continue;
    }
    
    for (let i = 0; i < rankedEntries.length; i++) {
      const { error: rankUpdateError } = await supabase
        .from('tournament_entries')
        .update({ rank: i + 1 })
        .eq('id', rankedEntries[i].id);
      
      if (rankUpdateError) {
        console.error('Error updating rank:', rankUpdateError);
      }
    }
    
    console.log(`  Updated ranks for ${rankedEntries.length} entries`);
  }
  
  console.log('\nDone!');
}

recalculateTournamentPoints().catch(console.error);

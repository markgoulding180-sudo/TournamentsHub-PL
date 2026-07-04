// scripts/seed-test-data.js
// Local script to insert 10 hardcoded GW34 fixtures for immediate testing
// Run: node scripts/seed-test-data.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const GW34_FIXTURES = [
  {
    gameweek: 34,
    home_team: 'Arsenal',
    away_team: 'Brighton',
    home_team_code: 'ARS',
    away_team_code: 'BHA',
    kickoff_time: '2026-04-26T12:30:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Aston Villa',
    away_team: 'Newcastle',
    home_team_code: 'AVL',
    away_team_code: 'NEW',
    kickoff_time: '2026-04-26T15:00:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Bournemouth',
    away_team: 'Man Utd',
    home_team_code: 'BOU',
    away_team_code: 'MUN',
    kickoff_time: '2026-04-26T15:00:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Leeds',
    away_team: 'Everton',
    home_team_code: 'LEE',
    away_team_code: 'EVE',
    kickoff_time: '2026-04-26T15:00:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Sunderland',
    away_team: 'Liverpool',
    home_team_code: 'SUN',
    away_team_code: 'LIV',
    kickoff_time: '2026-04-26T15:00:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Newcastle',
    away_team: 'Brentford',
    home_team_code: 'NEW',
    away_team_code: 'BRE',
    kickoff_time: '2026-04-26T17:30:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Chelsea',
    away_team: 'West Ham',
    home_team_code: 'CHE',
    away_team_code: 'WHU',
    kickoff_time: '2026-04-27T14:00:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Everton',
    away_team: 'Fulham',
    home_team_code: 'EVE',
    away_team_code: 'FUL',
    kickoff_time: '2026-04-27T14:00:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Man City',
    away_team: 'Spurs',
    home_team_code: 'MCI',
    away_team_code: 'TOT',
    kickoff_time: '2026-04-27T16:30:00Z',
    status: 'upcoming'
  },
  {
    gameweek: 34,
    home_team: 'Wolves',
    away_team: 'Crystal Palace',
    home_team_code: 'WOL',
    away_team_code: 'CRY',
    kickoff_time: '2026-04-28T20:00:00Z',
    status: 'upcoming'
  }
];

async function seedTestData() {
  console.log('🚀 Seeding GW34 test fixtures...');
  
  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_SECRET must be set in .env file');
    console.log('\nCreate a .env file in the project root with:');
    console.log('SUPABASE_URL=https://your-project.supabase.co');
    console.log('SUPABASE_SECRET=your-service-role-key');
    process.exit(1);
  }

  // Initialize Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SECRET
  );

  try {
    let created = 0;
    let skipped = 0;

    for (const fixture of GW34_FIXTURES) {
      try {
        // Check if match already exists
        const { data: existingMatch } = await supabase
          .from('matches')
          .select('id')
          .eq('gameweek', fixture.gameweek)
          .eq('home_team', fixture.home_team)
          .eq('away_team', fixture.away_team)
          .single();

        if (existingMatch) {
          console.log(`⏭️  Skipping: ${fixture.home_team} vs ${fixture.away_team} (already exists)`);
          skipped++;
          continue;
        }

        // Insert new match
        const { error } = await supabase
          .from('matches')
          .insert(fixture);

        if (error) throw error;
        
        console.log(`✅ Created: ${fixture.home_team} vs ${fixture.away_team}`);
        created++;

      } catch (error) {
        console.error(`❌ Error inserting ${fixture.home_team} vs ${fixture.away_team}:`, error.message);
      }
    }

    console.log('\n✅ Done!');
    console.log(`   Created: ${created}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`\n📝 GW34 fixtures are now in the database.`);
    console.log('   Users can now make predictions on the predictions page.');

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

// Run the script
seedTestData();

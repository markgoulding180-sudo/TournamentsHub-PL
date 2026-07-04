// scripts/seed-fixtures.js
// Local script to seed all Premier League fixtures from FPL API into Supabase
// Run: node scripts/seed-fixtures.js

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FPL_FIXTURES_URL = 'https://fantasy.premierleague.com/api/fixtures/';

async function seedFixtures() {
  console.log('🚀 Starting fixture seed...');
  
  // Check environment variables
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET) {
    console.error('❌ Error: SUPABASE_URL and SUPABASE_SECRET must be set in .env file');
    console.log('\nCreate a .env file with:');
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
    // Fetch team data
    console.log('📥 Fetching team data from FPL...');
    const teamsResponse = await fetch(FPL_BOOTSTRAP_URL);
    const bootstrapData = await teamsResponse.json();
    
    const teams = {};
    bootstrapData.teams.forEach(team => {
      teams[team.id] = {
        name: team.name,
        short_name: team.short_name
      };
    });
    console.log(`✅ Loaded ${Object.keys(teams).length} teams`);

    // Fetch all fixtures
    console.log('📥 Fetching fixtures from FPL...');
    const fixturesResponse = await fetch(FPL_FIXTURES_URL);
    const fixtures = await fixturesResponse.json();
    console.log(`✅ Loaded ${fixtures.length} fixtures`);

    // Process and insert fixtures
    let created = 0;
    let updated = 0;
    let errors = [];

    for (const fixture of fixtures) {
      // Skip if teams not found
      if (!teams[fixture.team_h] || !teams[fixture.team_a]) {
        console.log(`⚠️  Skipping fixture ${fixture.id}: team not found`);
        continue;
      }

      const matchData = {
        gameweek: fixture.event,
        home_team: teams[fixture.team_h].name,
        away_team: teams[fixture.team_a].name,
        home_team_code: teams[fixture.team_h].short_name,
        away_team_code: teams[fixture.team_a].short_name,
        kickoff_time: fixture.kickoff_time,
        status: mapFPLStatus(fixture.finished, fixture.started)
      };

      // Add scores if match is finished
      if (fixture.finished_provisional || fixture.finished) {
        matchData.home_score = fixture.team_h_score;
        matchData.away_score = fixture.team_a_score;
        matchData.result = calculateResult(fixture.team_h_score, fixture.team_a_score);
      }

      try {
        // Check if match already exists
        const { data: existingMatch } = await supabase
          .from('matches')
          .select('id')
          .eq('gameweek', fixture.event)
          .eq('home_team', teams[fixture.team_h].name)
          .eq('away_team', teams[fixture.team_a].name)
          .single();

        if (existingMatch) {
          // Update existing match
          const { error } = await supabase
            .from('matches')
            .update(matchData)
            .eq('id', existingMatch.id);

          if (error) throw error;
          updated++;
        } else {
          // Create new match
          const { error } = await supabase
            .from('matches')
            .insert(matchData);

          if (error) throw error;
          created++;
        }

        // Progress indicator
        if ((created + updated) % 10 === 0) {
          process.stdout.write(`\r📊 Progress: ${created + updated}/${fixtures.length}`);
        }
      } catch (error) {
        errors.push({ match: `${matchData.home_team} vs ${matchData.away_team}`, error: error.message });
      }
    }

    console.log('\n\n✅ Done!');
    console.log(`   Created: ${created}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors.length}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors:');
      errors.forEach(e => console.log(`   - ${e.match}: ${e.error}`));
    }

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    process.exit(1);
  }
}

function mapFPLStatus(finished, started) {
  if (finished) return 'finished';
  if (started) return 'live';
  return 'upcoming';
}

function calculateResult(homeScore, awayScore) {
  if (homeScore > awayScore) return 'H';
  if (awayScore > homeScore) return 'A';
  return 'D';
}

// Run the script
seedFixtures();

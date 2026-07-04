# GB Fantasy Scripts

Local Node.js scripts for seeding data into Supabase.

## Setup

1. **Install dependencies:**
   ```bash
   cd scripts
   npm install
   ```

2. **Create .env file:**
   ```bash
   copy .env.example .env
   ```
   
   Then edit `.env` and add your Supabase credentials:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SECRET=your-service-role-key
   ```
   
   > ⚠️ Use the **Service Role Key** (not the anon key) - found in Supabase Dashboard > Project Settings > API

## Running the Scripts

### Quick Start - Seed GW34 Test Data
This inserts 10 hardcoded GW34 fixtures so the site works immediately:

```bash
node seed-test-data.js
```

Or using npm:
```bash
npm run seed:test
```

**What it does:**
- Inserts 10 GW34 fixtures (Arsenal vs Brighton, etc.)
- Skips duplicates if already exists
- Ready for predictions immediately

### Full Sync - All 38 Gameweeks
This fetches ALL fixtures from FPL API (GW1 to GW38):

```bash
node seed-fixtures.js
```

Or using npm:
```bash
npm run seed:fixtures
```

**What it does:**
- Fetches all 380 Premier League fixtures
- Maps team IDs to names
- Inserts/updates all matches in Supabase
- Takes ~1-2 minutes to complete

## Troubleshooting

**"SUPABASE_URL is not defined"**
- Make sure you created the `.env` file
- Make sure you're running the script from the `scripts/` folder

**"Invalid API key"**
- Use the Service Role Key, not the anon key
- The service role key bypasses RLS policies

**"relation 'matches' does not exist"**
- Run the `supabase-schema.sql` in Supabase SQL Editor first

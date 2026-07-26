// Vercel Function: Current Gameweek / Master Clock - Single source of truth
// GET /api/current-gameweek - Get current gameweek
// POST /api/current-gameweek - Set/advance current gameweek (admin only)

const { createClient } = require('@supabase/supabase-js');

const FPL_BOOTSTRAP_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // master_clock lives in the shared master PL-facts project now
  const supabase = createClient(
    process.env.MASTER_SUPABASE_URL,
    process.env.MASTER_SUPABASE_SERVICE_KEY
  );

  // GET - Read current gameweek from Master Clock
  if (req.method === 'GET') {
    try {
      // Get master clock
      const { data: masterClock, error: clockError } = await supabase
        .from('master_clock')
        .select('*')
        .eq('id', 'current')
        .single();

      // Get FPL data for deadline info only
      let fplDeadline = null;
      let fplDeadlineEpoch = null;
      let fplCurrentGW = null;
      try {
        const response = await fetch(FPL_BOOTSTRAP_URL);
        const data = await response.json();
        const nextEvent = data.events.find(e => e.is_next);
        const currentEvent = data.events.find(e => e.is_current);
        if (nextEvent) {
          fplDeadline = nextEvent.deadline_time;
          fplDeadlineEpoch = nextEvent.deadline_time_epoch;
        }
        if (currentEvent) {
          fplCurrentGW = currentEvent.id;
        }
      } catch (e) {
        console.log('FPL API fetch failed');
      }

      // If no master clock exists, return error with instructions
      if (!masterClock) {
        return res.status(200).json({
          error: 'Master clock not initialized',
          message: 'Admin must set current gameweek in Master Clock first',
          current_gameweek: null,
          next_gameweek: null,
          fpl_current_gameweek: fplCurrentGW,
          status: 'not_initialized'
        });
      }

      // Match completion count for the current gameweek — lets the admin
      // see at a glance whether it's actually safe to advance yet.
      let matchesFinished = 0;
      let matchesTotal = 0;
      try {
        const { data: gwMatches } = await supabase
          .from('matches')
          .select('status')
          .eq('gameweek', masterClock.current_gameweek);
        matchesTotal = gwMatches ? gwMatches.length : 0;
        matchesFinished = gwMatches ? gwMatches.filter(m => m.status === 'finished').length : 0;
      } catch (e) {
        console.log('Match count fetch failed:', e.message);
      }

      return res.status(200).json({
        // Master Clock values (source of truth)
        current_gameweek: masterClock.current_gameweek,
        next_gameweek: masterClock.current_gameweek + 1,
        last_finalised_gameweek: masterClock.last_finalised_gameweek || 0,
        status: masterClock.status || 'active',
        
        // Deadline (from Master Clock, fallback to FPL)
        deadline: masterClock.deadline || fplDeadline,
        deadline_epoch: masterClock.deadline_epoch || fplDeadlineEpoch,

        // Match completion for the current gameweek
        matches_finished: matchesFinished,
        matches_total: matchesTotal,
        all_matches_finished: matchesTotal > 0 && matchesFinished === matchesTotal,
        
        // FPL reference (for info only)
        fpl_current_gameweek: fplCurrentGW,
        
        // Metadata
        master_clock_updated_at: masterClock.updated_at
      });

    } catch (error) {
      console.error('Master clock GET error:', error);
      return res.status(500).json({ error: 'Failed to read master clock', details: error.message });
    }
  }

  // POST - Set or advance current gameweek
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      // Verify admin (for now, any authenticated user)
      const token = authHeader.replace('Bearer ', '');
      const supabaseAdmin = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_SECRET
      );
      
      const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
      if (authError || !user) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      const { action, gameweek, deadline, deadline_epoch } = req.body;

      // Initialize master clock. Same raised upper bound as 'set' below,
      // for admin-generated test gameweeks.
      if (action === 'init') {
        if (!gameweek || gameweek < 1 || gameweek > 60) {
          return res.status(400).json({ error: 'Valid gameweek (1-60) required' });
        }

        const { data, error } = await supabase
          .from('master_clock')
          .upsert({
            id: 'current',
            current_gameweek: gameweek,
            last_finalised_gameweek: gameweek - 1,
            status: 'active',
            deadline: deadline || null,
            deadline_epoch: deadline_epoch || null,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' })
          .select()
          .single();

        if (error) {
          return res.status(500).json({ error: 'Failed to init master clock', details: error.message });
        }

        return res.status(200).json({
          message: `Master clock initialized to GW${gameweek}`,
          current_gameweek: gameweek,
          next_gameweek: gameweek + 1
        });
      }

      // Advance to next gameweek (called after finalising)
      if (action === 'advance') {
        const { data: current } = await supabase
          .from('master_clock')
          .select('*')
          .eq('id', 'current')
          .single();

        if (!current) {
          return res.status(400).json({ error: 'Master clock not initialized' });
        }

        const newGW = current.current_gameweek + 1;
        if (newGW > 60) {
          return res.status(400).json({ error: 'Cannot advance past GW60' });
        }

        const { data, error } = await supabase
          .from('master_clock')
          .update({
            current_gameweek: newGW,
            last_finalised_gameweek: current.current_gameweek,
            status: 'active',
            deadline: deadline || current.deadline,
            deadline_epoch: deadline_epoch || current.deadline_epoch,
            updated_at: new Date().toISOString()
          })
          .eq('id', 'current')
          .select()
          .single();

        if (error) {
          return res.status(500).json({ error: 'Failed to advance master clock', details: error.message });
        }

        return res.status(200).json({
          message: `Advanced to GW${newGW}`,
          previous_gameweek: current.current_gameweek,
          current_gameweek: newGW,
          next_gameweek: newGW + 1
        });
      }

      // Manual set (for corrections). Real seasons only ever reach 38, but
      // the upper bound is raised to 60 to allow admin-generated test
      // gameweeks (e.g. 49-58, used to test transfer-deadline/settlement
      // behavior against genuinely future-dated fake data) without
      // touching real season numbering at all.
      if (action === 'set') {
        if (!gameweek || gameweek < 1 || gameweek > 60) {
          return res.status(400).json({ error: 'Valid gameweek (1-60) required' });
        }

        const { data, error } = await supabase
          .from('master_clock')
          .upsert({
            id: 'current',
            current_gameweek: gameweek,
            status: 'active',
            deadline: deadline || null,
            deadline_epoch: deadline_epoch || null,
            updated_at: new Date().toISOString()
          }, { onConflict: 'id' })
          .select()
          .single();

        if (error) {
          return res.status(500).json({ error: 'Failed to set master clock', details: error.message });
        }

        return res.status(200).json({
          message: `Master clock set to GW${gameweek}`,
          current_gameweek: gameweek,
          next_gameweek: gameweek + 1
        });
      }

      return res.status(400).json({ error: 'Invalid action. Use: init, advance, or set' });

    } catch (error) {
      console.error('Master clock POST error:', error);
      return res.status(500).json({ error: 'Failed to update master clock', details: error.message });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
};

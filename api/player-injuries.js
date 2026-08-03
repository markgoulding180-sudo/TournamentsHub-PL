// Vercel Function: Get player injuries with photo URLs
// GET /api/player-injuries

const { createClient } = require('@supabase/supabase-js');

// FPL player photo base URL
const FPL_PHOTO_URL = 'https://resources.premierleague.com/premierleague/photos/players/110x140/p';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Pure master PL-facts data — reads from the shared master project
    const supabase = createClient(
      process.env.MASTER_SUPABASE_URL,
      process.env.MASTER_SUPABASE_ANON_KEY,
      { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
    );

    // Get players with injuries/news
    const { data: players, error } = await supabase
      .from('players')
      .select(`
        id,
        first_name,
        second_name,
        web_name,
        photo,
        news,
        news_added,
        chance_of_playing_next_round,
        chance_of_playing_this_round,
        status,
        element_type,
        teams:team (name)
      `)
      .not('news', 'is', null)
      .order('news_added', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch injuries', details: error.message });
    }

    // Format with photo URLs
    const injuries = (players || []).map(p => {
      // Determine injury status
      let injuryStatus = 'available';
      if (p.status === 'i') injuryStatus = 'out';
      else if (p.status === 'd') injuryStatus = 'doubt';
      else if (p.status === 'a' && p.news) injuryStatus = 'return';
      else if (p.status === 's') injuryStatus = 'out';
      else if (p.status === 'n') injuryStatus = 'out';

      // Calculate progress (mock based on status)
      let progress = 100;
      if (injuryStatus === 'out') progress = 25;
      else if (injuryStatus === 'doubt') progress = 65;
      else if (injuryStatus === 'return') progress = 90;

      // Extract return date from news if possible
      let returnDate = 'TBC';
      const gwMatch = p.news?.match(/GW(\d+)/i);
      if (gwMatch) {
        returnDate = 'GW' + gwMatch[1];
      }

      // Build photo URL
      const photoUrl = p.photo 
        ? `${FPL_PHOTO_URL}${p.photo.replace('.jpg', '')}.png`
        : null;

      return {
        id: p.id,
        player: p.web_name,
        fullName: `${p.first_name} ${p.second_name}`,
        team: p.teams?.name || 'Unknown',
        position: { 1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Forward' }[p.element_type] || 'Unknown',
        photo: photoUrl,
        type: p.news?.split(' - ')[0] || 'Injury',
        status: injuryStatus,
        description: p.news,
        returnDate: returnDate,
        progress: progress,
        chanceThisRound: p.chance_of_playing_this_round,
        chanceNextRound: p.chance_of_playing_next_round,
        newsAdded: p.news_added
      };
    });

    return res.status(200).json({
      count: injuries.length,
      injuries: injuries
    });

  } catch (error) {
    console.error('Player injuries error:', error);
    return res.status(500).json({ error: 'Failed to fetch injuries', details: error.message });
  }
};

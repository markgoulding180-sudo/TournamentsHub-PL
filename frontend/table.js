// Premier League Table
const API_BASE = '/api';

document.addEventListener('DOMContentLoaded', function() {
  loadTable();
});

async function loadTable() {
  try {
    // Fetch from our API (no CORS issues)
    const response = await fetch(`${API_BASE}/sync-players?table=true`);
    if (!response.ok) throw new Error('Failed to load table');
    
    const data = await response.json();
    
    // Update stats
    document.getElementById('total-matches').textContent = data.stats.totalMatches;
    document.getElementById('total-goals').textContent = data.stats.totalGoals;
    document.getElementById('avg-goals').textContent = data.stats.avgGoals;
    document.getElementById('current-gameweek').textContent = 'GW' + data.stats.currentGameweek;
    
    // Render table
    renderTable(data.table);
    
    document.getElementById('last-updated').textContent = new Date(data.lastUpdated).toLocaleString();
    
  } catch (error) {
    console.error('Table load error:', error);
    document.getElementById('league-table-body').innerHTML = `
      <tr>
        <td colspan="11" class="text-center" style="padding: 3rem; color: var(--accent-red);">
          <i class="fas fa-exclamation-circle"></i> Error loading table data
        </td>
      </tr>
    `;
  }
}

function renderTable(teams) {
  const tbody = document.getElementById('league-table-body');
  
  tbody.innerHTML = teams.map((team) => {
    const gd = team.gd;
    const position = team.position;
    
    // Determine position class
    let posClass = 'pos-mid';
    if (position <= 4) posClass = 'pos-champions';
    else if (position <= 5) posClass = 'pos-europa';
    else if (position <= 6) posClass = 'pos-conference';
    else if (position >= 18) posClass = 'pos-relegation';
    
    // Get team shirt
    const shirtName = getShirtFileName(team.name);
    
    // Format form
    const form = team.form.map(r => `<span class="form-indicator form-${r.toLowerCase()}">${r}</span>`).join('');
    
    return `
      <tr>
        <td><span class="position ${posClass}">${position}</span></td>
        <td>
          <div class="team-cell">
            <img src="shirts/${shirtName}" alt="${team.name}" class="team-shirt-small" onerror="this.style.display='none'">
            <span style="font-weight: 600;">${team.name}</span>
          </div>
        </td>
        <td>${team.played}</td>
        <td>${team.won}</td>
        <td>${team.drawn}</td>
        <td>${team.lost}</td>
        <td>${team.gf}</td>
        <td>${team.ga}</td>
        <td style="font-weight: 600; ${gd > 0 ? 'color: var(--accent-green);' : gd < 0 ? 'color: var(--accent-red);' : ''}">${gd > 0 ? '+' : ''}${gd}</td>
        <td style="font-weight: 700;">${team.points}</td>
        <td>${form}</td>
      </tr>
    `;
  }).join('');
}

function getShirtFileName(teamName) {
  const mapping = {
    'Arsenal': 'arsenal.webp',
    'Aston Villa': 'aston villa.webp',
    'Bournemouth': 'bournmouth.webp',
    'Brentford': 'brentford.webp',
    'Brighton': 'brighton.webp',
    'Burnley': 'burnley.webp',
    'Chelsea': 'chelsea.webp',
    'Crystal Palace': 'crystal.webp',
    'Everton': 'everton.webp',
    'Fulham': 'fullham.webp',
    'Liverpool': 'liverpool.webp',
    'Man City': 'man city.webp',
    'Man Utd': 'man u.webp',
    'Newcastle': 'new castle.webp',
    "Nott'm Forest": 'nots forest.webp',
    'Spurs': 'spurs.webp',
    'West Ham': 'west ham.webp',
    'Wolves': 'wovles temp.webp',
    'Leeds': 'leeds.webp',
    'Sunderland': 'sunderland.webp'
  };
  
  return mapping[teamName] || 'arsenal.webp';
}
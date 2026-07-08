// Injury Updates - Fetches real data from database with FPL player photos

const API_BASE = '/api';

// Fallback mock data if API fails
const mockInjuries = [
  {
    id: 1,
    player: 'Erling Haaland',
    team: 'Man City',
    photo: 'https://resources.premierleague.com/premierleague/photos/players/110x140/p223094.png',
    type: 'Ankle Injury',
    status: 'doubt',
    description: 'Minor ankle sprain, being assessed daily',
    returnDate: 'GW35',
    progress: 70
  },
  {
    id: 2,
    player: 'Bukayo Saka',
    team: 'Arsenal',
    photo: 'https://resources.premierleague.com/premierleague/photos/players/110x140/p223340.png',
    type: 'Hamstring',
    status: 'out',
    description: 'Grade 2 hamstring strain',
    returnDate: 'GW36',
    progress: 40
  }
];

document.addEventListener('DOMContentLoaded', function() {
  loadInjuries('all');
  setupFilters();
});

async function loadInjuries(filter) {
  const list = document.getElementById('injury-list');
  list.innerHTML = `
    <div class="card" style="padding: 3rem; text-align: center;">
      <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
      <p>Loading injury data...</p>
    </div>
  `;
  
  let injuries = [];
  
  try {
    // Try to fetch from API
    const response = await fetch(`${API_BASE}/player-injuries`);
    if (response.ok) {
      const data = await response.json();
      injuries = data.injuries || [];
    } else {
      throw new Error('API failed');
    }
  } catch (error) {
    console.log('Using mock data:', error);
    injuries = mockInjuries;
  }
  
  // Apply filter
  if (filter !== 'all') {
    injuries = injuries.filter(i => i.status === filter);
  }
  
  // Update counts
  const allInjuries = filter === 'all' ? injuries : mockInjuries;
  document.getElementById('count-out').textContent = allInjuries.filter(i => i.status === 'out').length;
  document.getElementById('count-doubt').textContent = allInjuries.filter(i => i.status === 'doubt').length;
  document.getElementById('count-return').textContent = allInjuries.filter(i => i.status === 'return').length;
  document.getElementById('count-total').textContent = allInjuries.length;
  
  if (injuries.length === 0) {
    list.innerHTML = `
      <div class="card" style="padding: 3rem; text-align: center;">
        <i class="fas fa-check-circle" style="font-size: 3rem; color: var(--accent-green); margin-bottom: 1rem;"></i>
        <p>No injuries in this category</p>
      </div>
    `;
    return;
  }
  
  list.innerHTML = injuries.map(injury => {
    const statusClass = 'injury-' + injury.status;
    const statusText = injury.status === 'out' ? 'Out' : 
                      injury.status === 'doubt' ? 'Doubtful' : 'Returning';
    
    const initials = injury.player.split(' ').map(n => n[0]).join('').substring(0, 2);
    const shirtFile = getTeamShirt(injury.team);
    
    // Use FPL photo if available, otherwise fallback to initials
    const playerImage = injury.photo || `https://ui-avatars.com/api/?name=${encodeURIComponent(injury.player)}&background=random&color=fff&size=128`;
    
    return `
      <div class="injury-card">
        <div class="injury-left">
          <div class="player-image-container">
            <img src="${playerImage}" alt="${injury.player}" class="player-image" onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
            <div class="player-avatar-fallback" style="display: none;">${initials}</div>
            <img src="shirts/${shirtFile}" alt="${injury.team}" class="team-shirt-badge" onerror="this.style.display='none'">
          </div>
          <h4>${injury.player}</h4>
          <div class="player-team">${injury.team}</div>
          <span class="injury-type ${statusClass}">${statusText}</span>
        </div>
        <div class="injury-right">
          <div class="injury-desc">${injury.description}</div>
          <div class="injury-timeline">
            <span>Recovery:</span>
            <div class="timeline-bar">
              <div class="timeline-progress" style="width: ${injury.progress}%"></div>
            </div>
            <span>${injury.progress}%</span>
          </div>
          <div class="injury-return-date">
            <span class="return-label">Expected Return</span>
            <span class="return-date">${injury.returnDate}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function getTeamShirt(teamName) {
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

function setupFilters() {
  const filters = document.querySelectorAll('.injury-filter');
  filters.forEach(filter => {
    filter.addEventListener('click', () => {
      filters.forEach(f => f.classList.remove('active'));
      filter.classList.add('active');
      loadInjuries(filter.dataset.filter);
    });
  });
}

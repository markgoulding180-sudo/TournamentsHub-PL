// Injury Updates - Fetches real data from database with FPL player photos

const API_BASE = '/api';

// Fallback mock data if API fails
const mockInjuries = [
  {
    id: 1,
    player: 'Erling Haaland',
    team: 'Man City',
    position: 'Forward',
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
    position: 'Forward',
    photo: 'https://resources.premierleague.com/premierleague/photos/players/110x140/p223340.png',
    type: 'Hamstring',
    status: 'out',
    description: 'Grade 2 hamstring strain',
    returnDate: 'GW36',
    progress: 40
  }
];

// Cache the full unfiltered list so club/position filters don't need a re-fetch
let allInjuriesCache = [];
let clubListPopulated = false;

document.addEventListener('DOMContentLoaded', function() {
  loadInjuries('all');
  setupFilters();
  document.getElementById('clubFilter').addEventListener('change', () => applyFilters());
  document.getElementById('positionFilter').addEventListener('change', () => applyFilters());
});

function populateClubFilter(injuries) {
  if (clubListPopulated) return;
  const select = document.getElementById('clubFilter');
  const clubs = [...new Set(injuries.map(i => i.team).filter(Boolean))].sort();
  clubs.forEach(club => {
    const opt = document.createElement('option');
    opt.value = club;
    opt.textContent = club;
    select.appendChild(opt);
  });
  clubListPopulated = true;
}

function applyFilters() {
  const activeStatusEl = document.querySelector('.injury-filter.active');
  const statusFilter = activeStatusEl ? activeStatusEl.dataset.filter : 'all';
  renderInjuries(statusFilter);
}

async function loadInjuries(filter) {
  const list = document.getElementById('injury-list');
  list.innerHTML = `
    <div class="card" style="padding: 3rem; text-align: center;">
      <i class="fas fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
      <p>Loading injury data...</p>
    </div>
  `;

  try {
    const response = await fetch(`${API_BASE}/player-injuries`);
    if (response.ok) {
      const data = await response.json();
      allInjuriesCache = data.injuries || [];
    } else {
      throw new Error('API failed');
    }
  } catch (error) {
    console.log('Using mock data:', error);
    allInjuriesCache = mockInjuries;
  }

  populateClubFilter(allInjuriesCache);
  renderInjuries(filter);
}

function renderInjuries(statusFilter) {
  const list = document.getElementById('injury-list');
  const clubFilter = document.getElementById('clubFilter').value;
  const positionFilter = document.getElementById('positionFilter').value;

  let injuries = allInjuriesCache;

  if (statusFilter !== 'all') {
    injuries = injuries.filter(i => i.status === statusFilter);
  }
  if (clubFilter !== 'all') {
    injuries = injuries.filter(i => i.team === clubFilter);
  }
  if (positionFilter !== 'all') {
    injuries = injuries.filter(i => i.position === positionFilter);
  }

  // Players with a real photo first, so the page leads with recognisable faces
  injuries = [...injuries].sort((a, b) => {
    const aHasPhoto = a.photo ? 0 : 1;
    const bHasPhoto = b.photo ? 0 : 1;
    return aHasPhoto - bHasPhoto;
  });

  // Update counts — always reflect the full dataset for this status tab,
  // regardless of club/position filters, so the summary bar stays stable
  document.getElementById('count-out').textContent = allInjuriesCache.filter(i => i.status === 'out').length;
  document.getElementById('count-doubt').textContent = allInjuriesCache.filter(i => i.status === 'doubt').length;
  document.getElementById('count-return').textContent = allInjuriesCache.filter(i => i.status === 'return').length;
  document.getElementById('count-total').textContent = allInjuriesCache.length;

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
          <div class="player-team">${injury.team}${injury.position ? ` · ${injury.position}` : ''}</div>
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
    'Coventry City': 'coventry city.webp',
    'Crystal Palace': 'crystal.webp',
    'Everton': 'everton.webp',
    'Fulham': 'fullham.webp',
    'Hull City': 'hull city.webp',
    'Ipswich Town': 'ipswich town.webp',
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
      renderInjuries(filter.dataset.filter);
    });
  });
}

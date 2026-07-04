// Club Links - Premier League team badges and official website links

const clubs = [
  {
    name: 'Arsenal',
    badge: 'https://resources.premierleague.com/premierleague/badges/t3.png',
    website: 'https://www.arsenal.com',
    twitter: 'Arsenal'
  },
  {
    name: 'Aston Villa',
    badge: 'https://resources.premierleague.com/premierleague/badges/t7.png',
    website: 'https://www.avfc.co.uk',
    twitter: 'AVFCOfficial'
  },
  {
    name: 'Bournemouth',
    badge: 'https://resources.premierleague.com/premierleague/badges/t91.png',
    website: 'https://www.afcb.co.uk',
    twitter: 'afcbournemouth'
  },
  {
    name: 'Brentford',
    badge: 'https://resources.premierleague.com/premierleague/badges/t94.png',
    website: 'https://www.brentfordfc.com',
    twitter: 'BrentfordFC'
  },
  {
    name: 'Brighton and Hove Albion',
    badge: 'https://resources.premierleague.com/premierleague/badges/t36.png',
    website: 'https://www.brightonandhovealbion.com',
    twitter: 'OfficialBHAFC'
  },
  {
    name: 'Burnley',
    badge: 'https://resources.premierleague.com/premierleague/badges/t90.png',
    website: 'https://www.burnleyfootballclub.com',
    twitter: 'BurnleyOfficial'
  },
  {
    name: 'Chelsea',
    badge: 'https://resources.premierleague.com/premierleague/badges/t8.png',
    website: 'https://www.chelseafc.com',
    twitter: 'ChelseaFC'
  },
  {
    name: 'Crystal Palace',
    badge: 'https://resources.premierleague.com/premierleague/badges/t31.png',
    website: 'https://www.cpfc.co.uk',
    twitter: 'CPFC'
  },
  {
    name: 'Everton',
    badge: 'https://resources.premierleague.com/premierleague/badges/t11.png',
    website: 'https://www.evertonfc.com',
    twitter: 'Everton'
  },
  {
    name: 'Fulham',
    badge: 'https://resources.premierleague.com/premierleague/badges/t54.png',
    website: 'https://www.fulhamfc.com',
    twitter: 'FulhamFC'
  },
  {
    name: 'Liverpool',
    badge: 'https://resources.premierleague.com/premierleague/badges/t14.png',
    website: 'https://www.liverpoolfc.com',
    twitter: 'LFC'
  },
  {
    name: 'Manchester City',
    badge: 'https://resources.premierleague.com/premierleague/badges/t43.png',
    website: 'https://www.mancity.com',
    twitter: 'ManCity'
  },
  {
    name: 'Manchester United',
    badge: 'https://resources.premierleague.com/premierleague/badges/t1.png',
    website: 'https://www.manutd.com',
    twitter: 'ManUtd'
  },
  {
    name: 'Newcastle United',
    badge: 'https://resources.premierleague.com/premierleague/badges/t4.png',
    website: 'https://www.nufc.co.uk',
    twitter: 'NUFC'
  },
  {
    name: "Nottingham Forest",
    badge: 'https://resources.premierleague.com/premierleague/badges/t17.png',
    website: 'https://www.nottinghamforest.co.uk',
    twitter: 'NFFC'
  },
  {
    name: 'Tottenham Hotspur',
    badge: 'https://resources.premierleague.com/premierleague/badges/t6.png',
    website: 'https://www.tottenhamhotspur.com',
    twitter: 'SpursOfficial'
  },
  {
    name: 'West Ham United',
    badge: 'https://resources.premierleague.com/premierleague/badges/t21.png',
    website: 'https://www.whufc.com',
    twitter: 'WestHam'
  },
  {
    name: 'Wolverhampton Wanderers',
    badge: 'https://resources.premierleague.com/premierleague/badges/t39.png',
    website: 'https://www.wolves.co.uk',
    twitter: 'Wolves'
  },
  {
    name: 'Leeds United',
    badge: 'https://resources.premierleague.com/premierleague/badges/t2.png',
    website: 'https://www.leedsunited.com',
    twitter: 'LUFC'
  },
  {
    name: 'Sunderland',
    badge: 'https://resources.premierleague.com/premierleague/badges/t56.png',
    website: 'https://www.safc.com',
    twitter: 'SunderlandAFC'
  }
];

document.addEventListener('DOMContentLoaded', function() {
  renderClubs();
});

function renderClubs() {
  const grid = document.getElementById('clubs-grid');
  
  grid.innerHTML = clubs.map(club => `
    <div class="club-card">
      <div class="club-header">
        <img src="${club.badge}" alt="${club.name}" class="club-badge" onerror="this.src='shirts/arsenal.webp'">
        <span class="club-name">${club.name}</span>
        <i class="fas fa-chevron-right club-arrow"></i>
      </div>
      <div class="club-actions">
        <a href="https://twitter.com/${club.twitter}" target="_blank" rel="noopener" class="club-btn club-btn-follow">
          Follow
        </a>
        <a href="${club.website}" target="_blank" rel="noopener" class="club-btn club-btn-website">
          Visit website <i class="fas fa-external-link-alt"></i>
        </a>
      </div>
    </div>
  `).join('');
}

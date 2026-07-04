// Leaderboard page - Load live leaderboard data
document.addEventListener('DOMContentLoaded', async function() {
  await loadTournamentsDropdown();
  await loadLeaderboard();
  
  // Handle tournament filter change
  const tournamentFilter = document.getElementById('tournament-filter');
  if (tournamentFilter) {
    tournamentFilter.addEventListener('change', async function() {
      await loadLeaderboard(this.value);
    });
  }
});

async function loadTournamentsDropdown() {
  const dropdown = document.getElementById('tournament-filter');
  if (!dropdown) return;
  
  try {
    const response = await fetch('/api/tournaments?status=live');
    if (!response.ok) throw new Error('Failed to load tournaments');
    
    const data = await response.json();
    
    // Keep the "All Tournaments" option, add real tournaments
    let options = '<option value="all">All Tournaments</option>';
    
    if (data.tournaments && data.tournaments.length > 0) {
      data.tournaments.forEach(t => {
        options += `<option value="${t.id}">${t.name}</option>`;
      });
    }
    
    dropdown.innerHTML = options;
    
  } catch (error) {
    console.error('Error loading tournaments:', error);
    // Keep default "All Tournaments" only on error
  }
}

async function loadLeaderboard(tournament = 'all') {
  const tbody = document.querySelector('.leaderboard-table tbody');
  const countSpan = document.querySelector('.card-header .text-muted');
  
  if (!tbody) return;
  
  // Show loading state
  tbody.innerHTML = '<tr><td colspan="7" class="text-center p-4"><i class="fas fa-spinner fa-spin"></i> Loading leaderboard...</td></tr>';
  
  try {
    const token = localStorage.getItem('gbf_token');
    const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
    
    const response = await fetch(`/api/leaderboard?tournament=${tournament}&limit=50`, { headers });
    
    if (!response.ok) {
      throw new Error('Failed to load leaderboard');
    }
    
    const data = await response.json();
    
    // Update count text
    if (countSpan) {
      const total = data.pagination?.total || data.leaderboard?.length || 0;
      countSpan.textContent = total > 0 
        ? `Showing 1-${Math.min(data.leaderboard.length, 50)} of ${total} players`
        : 'No players yet';
    }
    
    // Update Top 3 Podium with real data or placeholders
    // Store for re-rendering on resize
    const podium = document.querySelector('.grid.grid-3.mb-3');
    if (podium) {
      podium.dataset.leaderboard = JSON.stringify(data.leaderboard || []);
    }
    updatePodium(data.leaderboard || []);
    
    // Render full leaderboard or empty state
    if (!data.leaderboard || data.leaderboard.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="text-center p-4 text-muted">No leaderboard data available.</td></tr>';
      return;
    }
    
    tbody.innerHTML = data.leaderboard.map((entry, index) => {
      const rank = entry.rank || index + 1;
      const rankClass = rank <= 3 ? `rank-${rank}` : 'rank';
      const initials = entry.user?.avatar_initials || 
                      (entry.user?.display_name || entry.user?.username || '?').substring(0, 2).toUpperCase();
      const streakHtml = entry.streak > 1 
        ? `<span style="color: var(--accent-green);"><i class="fas fa-fire"></i> ${entry.streak}</span>` 
        : '-';
      
      return `
        <tr>
          <td><span class="rank ${rankClass}">${rank}</span></td>
          <td>
            <div class="player-info">
              <div class="player-avatar" style="background-color: ${getAvatarColor(rank)};">${initials}</div>
              <div>
                <div style="font-weight: 600;">${entry.user?.display_name || 'Unknown'}</div>
                <div class="text-muted" style="font-size: 0.875rem;">@${entry.user?.username || 'unknown'}</div>
              </div>
            </div>
          </td>
          <td class="text-right points">${(entry.total_points || 0).toLocaleString()}</td>
          <td class="text-right text-green">${entry.gw_points || '-'}</td>
          <td class="text-right">${entry.gw_points || '-'}</td>
          <td class="text-right">${entry.correct_scores || 0}</td>
          <td class="text-right">${streakHtml}</td>
        </tr>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Error loading leaderboard:', error);
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-red"><i class="fas fa-exclamation-circle"></i> Error loading leaderboard: ${error.message}</td></tr>`;
  }
}

function updatePodium(leaderboard) {
  const podium = document.querySelector('.grid.grid-3.mb-3');
  if (!podium) return;
  
  const medals = ['🥇', '🥈', '🥉'];
  const isMobile = window.innerWidth <= 428;
  
  // Update all 3 podium positions
  for (let i = 0; i < 3; i++) {
    const card = podium.children[i];
    if (!card) continue;
    
    const entry = leaderboard[i];
    
    if (entry) {
      // Real player data
      const initials = entry.user?.avatar_initials || 
                      (entry.user?.display_name || entry.user?.username || '?').substring(0, 2).toUpperCase();
      const displayName = entry.user?.display_name || 'Unknown';
      const username = entry.user?.username || 'unknown';
      const points = entry.total_points || 0;
      
      if (isMobile) {
        // Mobile: horizontal compact layout
        card.innerHTML = `
          <div style="font-size: 1.5rem; flex-shrink: 0; width: 32px; text-align: center;">${medals[i]}</div>
          <div class="player-avatar" style="width: 40px; height: 40px; font-size: 0.875rem; background-color: ${getAvatarColor(i + 1)}; flex-shrink: 0;">${initials}</div>
          <div style="font-size: 0.9rem; font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayName}</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--accent-green); flex-shrink: 0;">${points.toLocaleString()}</div>
        `;
      } else {
        // Desktop: vertical layout
        const sizes = ['64px', '56px', '56px'];
        const fontSizes = ['1.5rem', '1.25rem', '1.25rem'];
        const pointSizes = ['2rem', '1.75rem', '1.75rem'];
        
        card.innerHTML = `
          <div style="font-size: ${i === 0 ? '3rem' : '2.5rem'}; margin-bottom: 0.5rem;">${medals[i]}</div>
          <div class="player-avatar" style="margin: 0 auto 1rem; width: ${sizes[i]}; height: ${sizes[i]}; font-size: ${fontSizes[i]}; background-color: ${getAvatarColor(i + 1)};">${initials}</div>
          <div style="font-size: ${i === 0 ? '1.25rem' : '1.1rem'}; font-weight: ${i === 0 ? '700' : '600'};">${displayName}</div>
          <div class="text-muted mb-2">@${username}</div>
          <div style="font-size: ${pointSizes[i]}; font-weight: 700; color: ${i === 0 ? 'var(--accent-green)' : 'var(--text-primary)'};">${points.toLocaleString()}</div>
          <div class="text-muted">Total Points</div>
        `;
      }
    } else {
      // Empty slot
      if (isMobile) {
        card.innerHTML = `
          <div style="font-size: 1.5rem; flex-shrink: 0; width: 32px; text-align: center;">${medals[i]}</div>
          <div class="player-avatar" style="width: 40px; height: 40px; font-size: 0.875rem; background-color: var(--bg-hover); color: var(--text-secondary); flex-shrink: 0;">—</div>
          <div style="font-size: 0.9rem; font-weight: 600; flex: 1; color: var(--text-secondary);">—</div>
          <div style="font-size: 1rem; font-weight: 700; color: var(--text-secondary); flex-shrink: 0;">—</div>
        `;
      } else {
        const sizes = ['64px', '56px', '56px'];
        const fontSizes = ['1.5rem', '1.25rem', '1.25rem'];
        const pointSizes = ['2rem', '1.75rem', '1.75rem'];
        
        card.innerHTML = `
          <div style="font-size: ${i === 0 ? '3rem' : '2.5rem'}; margin-bottom: 0.5rem;">${medals[i]}</div>
          <div class="player-avatar" style="margin: 0 auto 1rem; width: ${sizes[i]}; height: ${sizes[i]}; font-size: ${fontSizes[i]}; background-color: var(--bg-hover); color: var(--text-secondary);">—</div>
          <div style="font-size: ${i === 0 ? '1.25rem' : '1.1rem'}; font-weight: ${i === 0 ? '700' : '600'}; color: var(--text-secondary);">—</div>
          <div class="text-muted mb-2">—</div>
          <div style="font-size: ${pointSizes[i]}; font-weight: 700; color: var(--text-secondary);">—</div>
          <div class="text-muted">Total Points</div>
        `;
      }
    }
  }
}

// Re-render podium on resize
let resizeTimeout;
window.addEventListener('resize', function() {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(function() {
    const podium = document.querySelector('.grid.grid-3.mb-3');
    if (podium && podium.dataset.leaderboard) {
      updatePodium(JSON.parse(podium.dataset.leaderboard));
    }
  }, 250);
});

function getAvatarColor(rank) {
  const colors = {
    1: 'var(--accent-amber)',
    2: 'var(--accent-red)',
    3: 'var(--accent-amber)'
  };
  return colors[rank] || '#8b5cf6';
}

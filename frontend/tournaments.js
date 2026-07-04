// Tournaments page - Load live tournaments
document.addEventListener('DOMContentLoaded', async function() {
  await loadTournaments();
});

async function loadTournaments() {
  const container = document.getElementById('tournaments-list');
  if (!container) return;
  
  const token = localStorage.getItem('gbf_token');
  const isLoggedIn = !!token;
  
  try {
    // Build fetch array
    const fetchPromises = [
      fetch('/api/tournaments?status=live')
    ];
    
    // If logged in, also fetch user's tournament entries
    if (isLoggedIn) {
      fetchPromises.push(
        fetch('/api/tournaments?my_entries=true', {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      );
    }
    
    const responses = await Promise.all(fetchPromises);
    const data = await responses[0].json();
    
    // Get user's entered tournament IDs
    let userEntries = [];
    if (isLoggedIn && responses[1]) {
      const entriesData = await responses[1].json();
      userEntries = entriesData.tournaments?.map(t => t.id) || [];
    }
    
    if (!data.tournaments || data.tournaments.length === 0) {
      container.innerHTML = '<p class="text-muted">No active tournaments. Check back soon!</p>';
      return;
    }
    
    // Build HTML for all tournaments
    let tournamentsHTML = '';
    
    // Get current user info
    const user = JSON.parse(localStorage.getItem('gbf_user') || '{}');
    
    data.tournaments.forEach(tournament => {
      // Check if user is actually entered in this tournament
      const isEntered = userEntries.includes(tournament.id);
      const hasStarted = tournament.status === 'live' || tournament.status === 'closed' || tournament.status === 'finished';
      
      // Determine button/action HTML
      let actionHtml = '';
      if (!isLoggedIn) {
        actionHtml = `<a href="login.html" class="btn btn-outline" style="width: auto;"><i class="fas fa-sign-in-alt"></i> Login to Enter</a>`;
      } else if (isEntered) {
        actionHtml = `
          <div style="display: flex; align-items: center; gap: 1rem;">
            <div style="color: var(--accent-green); font-weight: 600;"><i class="fas fa-check-circle"></i> Entered</div>
            <a href="predictions.html?tournament=${tournament.id}" class="btn btn-success"><i class="fas fa-eye"></i> View Predictions</a>
          </div>
        `;
      } else if (hasStarted) {
        actionHtml = `<button class="btn btn-disabled" disabled><i class="fas fa-lock"></i> Tournament Started</button>`;
      } else {
        actionHtml = `<button class="btn btn-green" onclick="enterTournamentFromList('${tournament.id}')"><i class="fas fa-ticket-alt"></i> Enter Tournament</button>`;
      }
      
      tournamentsHTML += `
        <div class="tournament-card live" style="padding: 2rem; border: 2px solid var(--accent-green); margin-bottom: 1rem; position: relative;">
          ${isEntered ? `
            <div class="user-badge-container" style="position: absolute; top: 1rem; right: 1rem; text-align: center;">
              <div style="width: 80px; height: 80px; border-radius: 50%; background: var(--accent-green); display: flex; align-items: center; justify-content: center; border: 3px solid var(--accent-green);">
                <i class="fas fa-check" style="font-size: 2rem; color: white;"></i>
              </div>
              <div class="user-badge-name" style="font-weight: 600; color: var(--accent-green); margin-top: 0.5rem; font-size: 0.875rem;">${user.display_name || 'You'}</div>
            </div>
          ` : ''}
          <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1rem; ${isEntered ? 'padding-right: 100px;' : ''}">
            <span class="tournament-status live">Live</span>
            <span class="text-muted"><i class="far fa-clock"></i> ${tournament.time_remaining || 'Open'}</span>
          </div>
          <h2 style="font-size: 1.5rem; margin-bottom: 0.5rem; ${isEntered ? 'padding-right: 100px;' : ''}">${tournament.name}</h2>
          <div style="display: flex; gap: 2rem; margin-top: 1rem;">
            <div>
              <div style="font-size: 1.25rem; font-weight: 700; color: var(--accent-green);">£${(tournament.prize_pool || 0).toLocaleString()}</div>
              <div class="text-muted" style="font-size: 0.75rem;">Prize Pool</div>
            </div>
            <div>
              <div style="font-size: 1.25rem; font-weight: 700;">£${tournament.entry_fee}</div>
              <div class="text-muted" style="font-size: 0.75rem;">Entry Fee</div>
            </div>
            <div>
              <div style="font-size: 1.25rem; font-weight: 700;">${tournament.current_entries || 0}</div>
              <div class="text-muted" style="font-size: 0.75rem;">Entries</div>
            </div>
          </div>
          <div style="margin-top: 1rem;">
            ${actionHtml}
          </div>
        </div>
      `;
    });
    
    container.innerHTML = tournamentsHTML;
    
  } catch (error) {
    console.error('Error loading tournaments:', error);
    container.innerHTML = '<p class="text-muted">Error loading tournaments. Please refresh.</p>';
  }
}

async function enterTournamentFromList(tournamentId) {
  const token = localStorage.getItem('gbf_token');
  
  if (!confirm('Enter this tournament?\n\nYou will use your existing GW35 predictions.')) {
    return;
  }
  
  try {
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ 
        action: 'join',
        tournament_id: tournamentId 
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to enter tournament');
    }
    
    alert('Successfully entered tournament!');
    window.location.reload();
    
  } catch (error) {
    alert('Error: ' + error.message);
  }
}
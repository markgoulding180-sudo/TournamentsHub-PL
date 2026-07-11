// Profile page JavaScript

const API_BASE = '/api';

// Global cache for predictions data
let cachedPredictionsData = null;
let liveRefreshInterval = null;
let carouselInterval = null;
let carouselIndex = 0;

async function loadProfile() {
  const token = localStorage.getItem('gbf_token');
  const userJson = localStorage.getItem('gbf_user');
  
  if (!token || !userJson) {
    window.location.href = '/login?redirect=%2Fpredictions-stats';
    return;
  }
  
  try {
    const user = JSON.parse(userJson);
    
    document.getElementById('profile-name').textContent = user.display_name || user.username;
    document.getElementById('profile-username').textContent = '@' + user.username;
    document.getElementById('profile-avatar').textContent = (user.display_name || user.username).substring(0, 2).toUpperCase();
    
    let joinDate = user.created_at;
    if (!joinDate && typeof supabase !== 'undefined') {
      try {
        const { data: { user: freshUser } } = await supabase.auth.getUser();
        if (freshUser?.created_at) {
          joinDate = freshUser.created_at;
          user.created_at = joinDate;
          localStorage.setItem('gbf_user', JSON.stringify(user));
        }
      } catch (e) {
        console.log('Could not fetch user data from Supabase');
      }
    }
    
    if (joinDate) {
      const date = new Date(joinDate);
      const formatted = date.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
      document.getElementById('join-date').textContent = formatted;
    }
    
  } catch (error) {
    console.error('Error loading profile:', error);
  }
}

async function loadUserTournaments() {
  const token = localStorage.getItem('gbf_token');
  const user = JSON.parse(localStorage.getItem('gbf_user') || '{}');
  const container = document.getElementById('tournament-sections');
  const bannerBar = document.getElementById('profile-tournament-bar');
  
  if (!container) return;
  
  try {
    const response = await fetch('/api/tournaments?status=live', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load tournaments');
    
    const data = await response.json();
    
    if (!data.tournaments || data.tournaments.length === 0) {
      container.innerHTML = '<p class="text-muted">No active tournaments. Join one below!</p>';
      if (bannerBar) bannerBar.innerHTML = '<div class="t-left"><span style="color:rgba(255,255,255,0.5);font-size:0.85rem;">No active tournaments</span></div>';
      return;
    }

    // Update banner bar with first entered tournament
    let bannerSet = false;

    let tournamentsHTML = '';
    
    for (const tournament of data.tournaments) {
      const lbResponse = await fetch(`/api/tournaments?leaderboard=true&tournament_id=${tournament.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      let userEntry = null;
      if (lbResponse.ok) {
        const lbData = await lbResponse.json();
        userEntry = lbData.leaderboard?.find(e => e.user_id === user.id);
      }
      
      const isEntered = !!userEntry;
      
      let predictionsCount = '--';
      let resultPct = '--%';
      let scorePct = '--%';
      let tournamentPoints = '--';
      
      // Calculate points first if entered - fetch across full tournament GW range
      if (isEntered) {
        try {
          const startGW = tournament.gameweek;
          const endGW = tournament.end_gameweek || tournament.gameweek;
          let allPredictions = [];
          let allMatches = [];
          
          // Fetch predictions for each gameweek in the tournament range
          for (let gw = startGW; gw <= endGW; gw++) {
            const predResponse = await fetch(`/api/predictions?gameweek=${gw}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (predResponse.ok) {
              const predData = await predResponse.json();
              allPredictions.push(...(predData.predictions || []));
              allMatches.push(...(predData.matches || []));
            }
          }
          
          // Get unique matches (in case of duplicates across GWs)
          const uniqueMatches = [...new Map(allMatches.map(m => [m.id, m])).values()];
          const tournamentMatchIds = new Set(uniqueMatches.map(m => m.id));
          
          // Filter predictions to only those for matches in this tournament
          const tournamentPreds = allPredictions.filter(p => tournamentMatchIds.has(p.match_id));
          
          predictionsCount = tournamentPreds.length;
          tournamentPoints = tournamentPreds.reduce((sum, p) => sum + (p.points_earned || 0), 0);
        } catch (e) {
          console.log('Error fetching predictions for banner:', e);
        }
      }

      // Set banner bar to first entered tournament (after points are calculated)
      if (isEntered && !bannerSet && bannerBar) {
        bannerSet = true;
        // LIVE badge only shown when matches are actually live - updated after predictions load
        bannerBar.innerHTML = `
          <div class="t-left">
            <span class="t-name">${tournament.name}</span>
            <div class="t-meta">
              <span id="banner-live-badge" style="display:none;" class="live-badge">LIVE</span>
              <span class="entered-badge"><i class="fas fa-check-circle"></i> ENTERED</span>
              <span style="color:rgba(255,255,255,0.7);">GW${tournament.gameweek}</span>
            </div>
          </div>
          <div class="t-right">
            <span style="color:#22c55e;">${tournamentPoints}</span> <span style="font-size:0.7rem;color:rgba(255,255,255,0.6);">PTS</span>
          </div>
        `;
      }
      
      // Calculate result/score percentages if we have prediction data
      if (isEntered && predictionsCount !== '--') {
        try {
          const startGW = tournament.gameweek;
          const endGW = tournament.end_gameweek || tournament.gameweek;
          let allPredictions = [];
          let allMatches = [];
          
          // Fetch predictions for each gameweek in the tournament range
          for (let gw = startGW; gw <= endGW; gw++) {
            const predResponse = await fetch(`/api/predictions?gameweek=${gw}`, {
              headers: { 'Authorization': `Bearer ${token}` }
            });
            if (predResponse.ok) {
              const predData = await predResponse.json();
              allPredictions.push(...(predData.predictions || []));
              allMatches.push(...(predData.matches || []));
            }
          }
          
          // Get unique matches
          const uniqueMatches = [...new Map(allMatches.map(m => [m.id, m])).values()];
          const tournamentMatchIds = new Set(uniqueMatches.map(m => m.id));
          const tournamentPreds = allPredictions.filter(p => tournamentMatchIds.has(p.match_id));
          
          const finishedMatches = uniqueMatches.filter(m => m.status === 'finished');
          const finishedPreds = tournamentPreds.filter(p => 
            finishedMatches.some(m => m.id === p.match_id)
          );
          const correctResults = finishedPreds.filter(p => (p.points_earned || 0) >= 10).length;
          const correctScores = finishedPreds.filter(p => (p.points_earned || 0) === 20).length;
          resultPct = finishedPreds.length > 0 
            ? Math.round((correctResults / finishedPreds.length) * 100) + '%' 
            : '--%';
          scorePct = finishedPreds.length > 0 
            ? Math.round((correctScores / finishedPreds.length) * 100) + '%' 
            : '--%';
        } catch (e) {
          console.log('Could not fetch predictions for tournament', tournament.id);
        }
      }
      
      tournamentsHTML += `
        <div class="tournament-section mb-2">
          <div class="card mb-2" style="background: linear-gradient(135deg, var(--accent-green) 0%, var(--accent-blue) 100%); color: white; padding: 0.5rem 0.75rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div>
                <div style="font-size: 0.95rem; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px;">${tournament.name}</div>
                <div style="margin-top: 0.15rem; font-size: 0.7rem; opacity: 0.9;">
                  <span style="background: rgba(255,255,255,0.2); padding: 0.15rem 0.5rem; border-radius: 3px;">${tournament.status.toUpperCase()}</span>
                  ${isEntered ? '<span style="margin-left: 0.4rem;"><i class="fas fa-check-circle"></i> ENTERED</span>' : ''}
                </div>
              </div>
              <div style="text-align: right;">
                <div style="font-size: 0.9rem; font-weight: 700;">GW${tournament.gameweek}</div>
                <div style="font-size: 0.65rem; opacity: 0.8;">Gameweek</div>
              </div>
            </div>
          </div>
          
          <div class="profile-stats mb-3">
            <div class="profile-stat">
              <div class="profile-stat-value">${tournamentPoints}</div>
              <div class="profile-stat-label">Tournament Points</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${isEntered && userEntry.rank ? '#' + userEntry.rank : '--'}</div>
              <div class="profile-stat-label">Tournament Rank</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${predictionsCount}</div>
              <div class="profile-stat-label">Predictions Made</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${resultPct}</div>
              <div class="profile-stat-label">Result %</div>
            </div>
            <div class="profile-stat">
              <div class="profile-stat-value">${scorePct}</div>
              <div class="profile-stat-label">Score %</div>
            </div>
          </div>
          
          ${!isEntered ? `
            <div style="text-align: center; margin-bottom: 1rem;">
              <button class="btn btn-green btn-lg" onclick="enterTournament('${tournament.id}')">
                <i class="fas fa-ticket-alt"></i> Enter Now - £${tournament.entry_fee}
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }
    
    container.innerHTML = tournamentsHTML;
    
  } catch (error) {
    console.error('Error loading tournaments:', error);
    container.innerHTML = '<p class="text-muted">Error loading tournaments.</p>';
  }
}

async function enterTournament(tournamentId) {
  const token = localStorage.getItem('gbf_token');
  
  if (!confirm('Enter this tournament?')) return;
  
  try {
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ action: 'join', tournament_id: tournamentId })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to enter');
    }
    
    showToast('Successfully entered tournament!', 'success');
    window.location.reload();
    
  } catch (error) {
    showToast('Error: ' + error.message, 'error');
  }
}

// Update match status indicator on profile page
function updateMatchStatusIndicator(liveCount, finishedCount, totalCount) {
  const statusLive = document.getElementById('status-live');
  const statusFinalising = document.getElementById('status-finalising');
  const statusPoints = document.getElementById('status-points');
  const statusCount = document.getElementById('matches-status-count');
  
  if (!statusLive || !statusFinalising || !statusPoints) return;
  
  // Hide all first
  statusLive.style.display = 'none';
  statusFinalising.style.display = 'none';
  statusPoints.style.display = 'none';
  
  // Determine which status to show
  const isMobile = window.innerWidth <= 768;
  
  if (liveCount > 0) {
    // Games are live
    statusLive.style.display = 'inline-flex';
    statusLive.innerHTML = `<i class="fas fa-circle" style="font-size: 0.5rem; animation: pulse-red 1s infinite; margin-right: 0.35rem;"></i> LIVE (${liveCount})`;
    if (statusCount) statusCount.textContent = `${liveCount} of ${totalCount} matches in play`;
  } else if (finishedCount > 0 && finishedCount < totalCount) {
    // Some finished, some upcoming - likely in finalising state
    statusFinalising.style.display = 'inline-flex';
    statusFinalising.innerHTML = `<i class="fas fa-clock" style="margin-right: 0.35rem;"></i> FINALISING (${finishedCount}/${totalCount})`;
    // Shorter message on mobile
    if (statusCount) statusCount.textContent = isMobile ? `Waiting for FPL...` : `Waiting for FPL to confirm final scores...`;
  } else if (finishedCount === totalCount && totalCount > 0) {
    // All matches finished
    statusPoints.style.display = 'inline-flex';
    statusPoints.innerHTML = `<i class="fas fa-check" style="margin-right: 0.35rem;"></i> POINTS AWARDED`;
    if (statusCount) statusCount.textContent = `${finishedCount} matches completed`;
  } else {
    // No matches yet or all upcoming
    statusLive.style.display = 'inline-flex';
    statusLive.innerHTML = `<i class="fas fa-circle" style="font-size: 0.5rem; margin-right: 0.35rem;"></i> UPCOMING`;
    if (statusCount) statusCount.textContent = `${totalCount} matches scheduled`;
  }
}

async function loadUserPredictions() {
  const token = localStorage.getItem('gbf_token');
  const container = document.getElementById('current-predictions');
  const liveBanner = document.getElementById('live-banner');
  const liveBannerText = document.getElementById('live-banner-text');
  
  if (!container) return null;
  
  try {
    const gwResponse = await fetch('/api/current-gameweek');
    const gwData = await gwResponse.json();
    // Show current gameweek if not finished, otherwise next
    const gameweek = gwData.finished ? gwData.next_gameweek : gwData.current_gameweek;
    
    // Fetch predictions (with auth) and all matches (without auth) in parallel
    const [predictionsResponse, matchesResponse] = await Promise.all([
      fetch(`/api/predictions?gameweek=${gameweek}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      }),
      fetch(`/api/predictions?gameweek=${gameweek}`)  // Public endpoint - gets all matches
    ]);
    
    if (!predictionsResponse.ok) throw new Error('Failed to load predictions');
    
    const data = await predictionsResponse.json();
    cachedPredictionsData = data;

    // Get ALL matches for live detection (not just ones with predictions)
    let allMatches = [];
    if (matchesResponse.ok) {
      const matchesData = await matchesResponse.json();
      allMatches = matchesData.matches || [];
    }
    // Fallback to matches from predictions if public endpoint fails
    if (allMatches.length === 0) {
      allMatches = data.matches || [];
    }

    // Check for live matches from ALL matches in the gameweek
    // A match is "live" if: status is 'live', OR (has scores AND not finished AND kickoff time has passed)
    const now = new Date();
    const liveMatches = allMatches.filter(m => {
      if (m.status === 'live') return true;
      // Also consider matches with scores that aren't marked as finished
      if (m.status === 'finished') return false;
      // Check if match has started (has any score) and kickoff time has passed
      const kickoff = new Date(m.kickoff_time);
      const hasStarted = (m.home_score !== null && m.home_score !== undefined) || 
                         (m.away_score !== null && m.away_score !== undefined);
      return hasStarted && kickoff < now;
    });
    const finishedCount = allMatches.filter(m => m.status === 'finished').length;
    const totalCount = allMatches.length;
    
    // Update match status indicator
    updateMatchStatusIndicator(liveMatches.length, finishedCount, totalCount);
    
    // Debug logging - VERBOSE
    console.log('=== LIVE MATCHES DEBUG ===');
    console.log('Live matches found:', liveMatches.length);
    liveMatches.forEach((m, i) => {
      console.log(`  LIVE ${i+1}: ${m.home_team} ${m.home_score}-${m.away_score} ${m.away_team} (${m.minute || 0}') [ID: ${m.id}]`);
    });
    console.log('Total matches in GW:', totalCount);
    console.log('All matches by status:');
    const byStatus = { live: [], finished: [], upcoming: [] };
    allMatches.forEach(m => {
      const status = m.status || 'unknown';
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(`${m.home_team} vs ${m.away_team} (${m.home_score ?? '-'}-${m.away_score ?? '-'})`);
    });
    Object.entries(byStatus).forEach(([status, matches]) => {
      if (matches.length > 0) console.log(`  ${status.toUpperCase()} (${matches.length}):`, matches.join(', '));
    });
    console.log('=== END DEBUG ===');

    // Update banner LIVE badge based on actual live matches
    const bannerLiveBadge = document.getElementById('banner-live-badge');
    if (bannerLiveBadge) {
      bannerLiveBadge.style.display = liveMatches.length > 0 ? 'inline-block' : 'none';
    }

    if (liveBanner && liveBannerText) {
      if (liveMatches.length > 0) {
        liveBanner.style.display = 'flex';
        liveBannerText.textContent = `${liveMatches.length} LIVE`;
        startLiveCarousel(liveMatches);
        startLiveRefresh();
      } else {
        liveBanner.style.display = 'none';
        stopLiveCarousel();
        stopLiveRefresh();
      }
    }
    
    if (!data.predictions || data.predictions.length === 0) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 2rem 1rem;">
          <i class="fas fa-exclamation-circle" style="color: var(--accent-amber); font-size: 2.5rem; margin-bottom: 1rem;"></i>
          <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;">You haven't predicted for GW${gameweek} yet!</p>
          <p class="text-muted" style="margin-bottom: 1.5rem;">Submit your predictions before the deadline to compete.</p>
          <a href="/predict" class="btn btn-primary btn-lg" style="margin-top: 0.5rem;">
            <i class="fas fa-futbol"></i> Predict Now
          </a>
        </div>
      `;
      return data;
    }
    
    let predictionsHTML = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
    data.predictions.forEach((pred, index) => {
      const match = data.matches.find(m => m.id === pred.match_id);
      if (match) {
        const isFinished = match.status === 'finished';
        const isLive = match.status === 'live';
        const points = pred.points_earned || 0;
        const pointsColor = points >= 20 ? '#22c55e' : points >= 10 ? '#f59e0b' : '#ef4444';
        
        // Alternating background shades
        const bgShade = index % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)';
        const borderColor = index % 2 === 0 ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.1)';
        
        // Status icon - green circle with tick for played, yellow circle for not played
        let statusIcon = '';
        if (isFinished || isLive) {
          // Game has started or finished - show green circle with tick
          statusIcon = `
            <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: var(--accent-green); border-radius: 50%; flex-shrink: 0;">
              <i class="fas fa-check" style="color: var(--bg-primary); font-size: 0.75rem;"></i>
            </div>
          `;
        } else {
          // Game not played yet - show yellow circle
          statusIcon = `
            <div style="display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; background: var(--accent-amber); border-radius: 50%; flex-shrink: 0;">
              <div style="width: 8px; height: 8px; background: var(--bg-primary); border-radius: 50%;"></div>
            </div>
          `;
        }
        
        let statusLine = '';
        if (isLive) {
          statusLine = `
            <div style="display:flex; align-items:center; gap:8px; margin-top:4px;">
              <span class="match-status-live">LIVE</span>
              <span class="match-live-score">${match.home_score ?? 0} - ${match.away_score ?? 0}</span>
            </div>
          `;
        } else if (isFinished) {
          const actualResult = match.home_score + '-' + match.away_score;
          // Points: 0 = red, any points = green
          const pointsColor = points === 0 ? 'var(--accent-red)' : 'var(--accent-green)';
          statusLine = `<div style="font-size: 0.8rem; color: ${pointsColor}; margin-top:4px;">Result: ${actualResult} • ${points} pts</div>`;
        } else {
          statusLine = `<div style="font-size: 0.8rem; color: rgba(255,255,255,0.4); margin-top:4px;">Not played yet</div>`;
        }
        
        predictionsHTML += `
          <div style="padding: 0.6rem 0.75rem; background: ${bgShade}; border: 1px solid ${borderColor}; border-radius: 0.5rem; display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;">
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 600; font-size: 0.9rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${match.home_team} vs ${match.away_team}</div>
              <div style="font-size: 0.8rem; color: rgba(255,255,255,0.6);">Your pick: ${pred.predicted_result} (${pred.home_score}-${pred.away_score})</div>
              ${statusLine}
            </div>
            ${statusIcon}
          </div>
        `;
      }
    });
    predictionsHTML += '</div>';
    
    container.innerHTML = predictionsHTML;
    return data;
    
  } catch (error) {
    console.error('Error loading predictions:', error);
    container.innerHTML = `<div class="empty-state"><p>Error: ${error.message}</p></div>`;
    return null;
  }
}

// Auto-refresh for live scores
function startLiveRefresh() {
  if (liveRefreshInterval) return; // already running
  liveRefreshInterval = setInterval(async () => {
    console.log('Auto-refreshing live scores...');
    
    // First, trigger live-scores API to fetch fresh data from FPL
    try {
      const liveResponse = await fetch('/api/live-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (liveResponse.ok) {
        const liveData = await liveResponse.json();
        console.log('Live scores updated:', liveData.message, 'Finished:', liveData.results?.finished || 0);
      }
    } catch (e) {
      console.error('Error in auto-refresh:', e);
    }
    
    // Then reload predictions with updated data
    await loadUserPredictions();
  }, 30000); // every 30 seconds
}

function stopLiveRefresh() {
  if (liveRefreshInterval) {
    clearInterval(liveRefreshInterval);
    liveRefreshInterval = null;
  }
}

async function refreshLiveScores() {
  const btn = document.querySelector('.refresh-btn');
  if (btn) btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
  
  // First, trigger live-scores API to fetch fresh data from FPL
  try {
    console.log('Fetching fresh data from FPL API...');
    const liveResponse = await fetch('/api/live-scores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    if (liveResponse.ok) {
      const liveData = await liveResponse.json();
      console.log('Live scores updated:', liveData.message, 'Finished:', liveData.results?.finished || 0);
    }
  } catch (e) {
    console.error('Error fetching live scores:', e);
  }
  
  // Then reload predictions with updated data
  await loadUserPredictions();
  await loadUserTournaments();
  loadPredictionHistory();
  loadAchievements();
  if (btn) btn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
}

// Performance Graph
let performanceChart = null;
let currentChartMode = 'points';

async function loadPerformanceGraph() {
  const token = localStorage.getItem('gbf_token');
  const container = document.getElementById('performance-chart-container');
  const emptyState = document.getElementById('performance-empty');
  
  if (!container) return;
  
  try {
    const response = await fetch('/api/tournaments?status=live', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load tournaments');
    
    const data = await response.json();
    const tournaments = data.tournaments || [];
    
    if (tournaments.length === 0) {
      container.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }
    
    const tournamentData = [];
    const colors = ['#3b82f6', '#f59e0b', '#22c55e', '#ef4444', '#8b5cf6'];
    
    for (let i = 0; i < tournaments.length; i++) {
      const tournament = tournaments[i];
      const gwData = await fetchGameweekData(tournament.gameweek, token);
      const rankData = await fetchRankData(tournament.id, token);
      
      if (gwData && gwData.predictions) {
        tournamentData.push({
          name: tournament.name,
          gameweek: tournament.gameweek,
          points: gwData.totalPoints || 0,
          rank: rankData || null,
          color: colors[i % colors.length]
        });
      }
    }
    
    const uniqueGWs = [...new Set(tournamentData.map(t => t.gameweek))].sort();

    // Always show chart even with 1 GW - shows current state
    if (tournamentData.length === 0) {
      container.style.display = 'none';
      if (emptyState) {
        emptyState.style.display = 'block';
        emptyState.innerHTML = '<i class="fas fa-chart-bar"></i><p>More data coming as gameweeks complete</p>';
      }
      return;
    }

    container.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
    renderPerformanceChart(tournamentData);
    
  } catch (error) {
    console.error('Error loading performance graph:', error);
    container.style.display = 'none';
    if (emptyState) emptyState.style.display = 'block';
  }
}

async function fetchRankData(tournamentId, token) {
  try {
    const user = JSON.parse(localStorage.getItem('gbf_user') || '{}');
    const response = await fetch(`/api/tournaments?leaderboard=true&tournament_id=${tournamentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const userEntry = data.leaderboard?.find(e => e.user_id === user.id);
    return userEntry?.rank || null;
  } catch (e) {
    return null;
  }
}

async function fetchGameweekData(gameweek, token) {
  try {
    const response = await fetch(`/api/predictions?gameweek=${gameweek}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    const predictions = data.predictions || [];
    const totalPoints = predictions.reduce((sum, p) => sum + (p.points_earned || 0), 0);
    return { ...data, totalPoints };
  } catch (e) {
    return null;
  }
}

function renderPerformanceChart(tournamentData) {
  const ctx = document.getElementById('performanceChart');
  if (!ctx) return;
  
  const gameweeks = [...new Set(tournamentData.map(t => t.gameweek))].sort((a, b) => a - b);
  const labels = gameweeks.map(gw => `GW${gw}`);
  
  let datasets, yAxisConfig;
  
  if (currentChartMode === 'rank') {
    // RANK MODE: Show rank over time (lower is better, so invert Y axis)
    const rankData = gameweeks.map(gw => {
      const tournament = tournamentData.find(t => t.gameweek === gw);
      return tournament?.rank || null;
    });
    
    datasets = [{
      label: 'Rank',
      data: rankData,
      borderColor: '#f59e0b', // Amber for rank
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      tension: 0.3,
      fill: true,
      pointBackgroundColor: '#f59e0b',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      spanGaps: true // Connect lines across null values
    }];
    
    // Inverted Y axis for rank (1 at top)
    const maxRank = Math.max(...rankData.filter(r => r !== null)) || 100;
    yAxisConfig = {
      reverse: true, // 1 at top, higher numbers below
      min: 1,
      max: Math.ceil(maxRank * 1.1), // Add some padding
      grid: { color: 'rgba(255,255,255,0.1)' },
      ticks: { 
        color: '#94a3b8',
        stepSize: 1
      },
      title: {
        display: true,
        text: 'Rank (lower is better)',
        color: '#94a3b8'
      }
    };
  } else {
    // POINTS MODE: Cumulative points starting from 0
    let cumulativePoints = 0;
    const cumulativeData = gameweeks.map(gw => {
      const gwPoints = tournamentData
        .filter(t => t.gameweek === gw)
        .reduce((sum, t) => sum + t.points, 0);
      cumulativePoints += gwPoints;
      return cumulativePoints;
    });
    
    datasets = [{
      label: 'Total Points',
      data: cumulativeData,
      borderColor: '#60a5fa', // Light blue
      backgroundColor: 'rgba(96, 165, 250, 0.1)',
      tension: 0.3,
      fill: true,
      pointBackgroundColor: '#60a5fa',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7
    }];
    
    yAxisConfig = {
      beginAtZero: true,
      grid: { color: 'rgba(255,255,255,0.1)' },
      ticks: { color: '#94a3b8' },
      title: {
        display: true,
        text: 'Points',
        color: '#94a3b8'
      }
    };
  }
  
  if (performanceChart) performanceChart.destroy();
  
  performanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: yAxisConfig,
        x: {
          grid: { color: 'rgba(255,255,255,0.1)' },
          ticks: { color: '#94a3b8' },
          title: {
            display: true,
            text: 'Gameweek',
            color: '#94a3b8'
          }
        }
      },
      plugins: {
        legend: { 
          display: false 
        }
      }
    }
  });
}

function switchChart(mode) {
  currentChartMode = mode;
  document.getElementById('toggle-points').classList.toggle('active', mode === 'points');
  document.getElementById('toggle-rank').classList.toggle('active', mode === 'rank');
  loadPerformanceGraph();
}

// Prediction History Table - Now loads from prediction_history table
async function loadPredictionHistory() {
  const container = document.getElementById('prediction-history-container');
  if (!container) return;
  
  try {
    const token = localStorage.getItem('gbf_token');
    
    // Fetch historical data from API
    let historyData = { history: [], summaries: [] };
    try {
      const historyResponse = await fetch('/api/predictions?action=history', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (historyResponse.ok) {
        historyData = await historyResponse.json();
      } else {
        console.error('History API error:', await historyResponse.text());
      }
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
    
    // Also get current predictions
    const currentData = cachedPredictionsData || { predictions: [], matches: [] };
    
    const history = historyData.history || [];
    const summaries = historyData.summaries || [];
    const currentPredictions = currentData.predictions || [];
    const currentMatches = currentData.matches || [];
    
    // Combine historical and current predictions
    const allPredictions = [...history];
    
    // Add current predictions if they have points
    currentPredictions.forEach(pred => {
      const match = currentMatches.find(m => m.id === pred.match_id);
      if (match && match.status === 'finished') {
        allPredictions.push({
          gameweek: pred.gameweek,
          home_team: match.home_team,
          away_team: match.away_team,
          predicted_home_score: pred.home_score,
          predicted_away_score: pred.away_score,
          predicted_result: pred.predicted_result,
          actual_home_score: match.home_score,
          actual_away_score: match.away_score,
          actual_result: match.result,
          points_earned: pred.points_earned || 0,
          is_current: true
        });
      }
    });
    
    if (allPredictions.length === 0 && currentPredictions.length === 0) {
      container.innerHTML = `<div class="empty-state"><i class="fas fa-futbol"></i><p>No predictions yet</p></div>`;
      return;
    }
    
    // Group predictions by gameweek
    const byGameweek = {};
    allPredictions.forEach(pred => {
      const gw = pred.gameweek;
      if (!byGameweek[gw]) byGameweek[gw] = [];
      byGameweek[gw].push(pred);
    });
    
    // Sort gameweeks descending
    const sortedGWs = Object.keys(byGameweek).sort((a, b) => b - a);
    
    let tableHTML = `
      <div style="overflow-x: auto;">
        <table style="width:100%; border-collapse:collapse; table-layout:fixed;">
          <thead>
            <tr style="border-bottom:1px solid var(--border);">
              <th style="text-align:left; padding:0.75rem; width:10%;">GW</th>
              <th style="text-align:left; padding:0.75rem; width:35%;">Match</th>
              <th style="text-align:center; padding:0.75rem; width:20%;">Your Pick</th>
              <th style="text-align:center; padding:0.75rem; width:20%;">Result</th>
              <th style="text-align:center; padding:0.75rem; width:15%;">Points</th>
            </tr>
          </thead>
          <tbody>
    `;
    
    let totalPoints = 0;
    let totalCorrectResults = 0;
    let totalCorrectScores = 0;
    let totalPredictions = 0;
    
    sortedGWs.forEach(gw => {
      const gwPredictions = byGameweek[gw];
      let gwPoints = 0;
      let gwCorrect = 0;
      
      gwPredictions.forEach((pred, idx) => {
        const points = pred.points_earned || 0;
        gwPoints += points;
        totalPoints += points;
        if (points >= 10) {
          gwCorrect++;
          totalCorrectResults++;
        }
        if (points === 20) totalCorrectScores++;
        totalPredictions++;
        
        const pointsColor = points >= 20 ? '#22c55e' : points >= 10 ? '#f59e0b' : '#64748b';
        const isCurrent = pred.is_current;
        const gwLabel = idx === 0 ? `GW${gw}` : '';
        const gwStyle = idx === 0 ? 'border-top:2px solid var(--border);' : '';
        
        tableHTML += `
          <tr style="border-bottom:1px solid rgba(255,255,255,0.05); ${gwStyle}">
            <td style="padding:0.75rem; font-weight:600; color:var(--accent-blue);">${gwLabel}</td>
            <td style="padding:0.75rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${pred.home_team} vs ${pred.away_team}">${pred.home_team} vs ${pred.away_team}</td>
            <td style="text-align:center; padding:0.75rem; white-space:nowrap;">${pred.predicted_result} (${pred.predicted_home_score}-${pred.predicted_away_score})</td>
            <td style="text-align:center; padding:0.75rem; white-space:nowrap;">${pred.actual_home_score}-${pred.actual_away_score}</td>
            <td style="text-align:center; padding:0.75rem; color:${pointsColor}; font-weight:600; white-space:nowrap;">${points}pts ${isCurrent ? '<span style="font-size:0.7rem; opacity:0.6;">(cur)</span>' : ''}</td>
          </tr>
        `;
      });
      
      // Add gameweek summary row
      tableHTML += `
        <tr style="background:rgba(255,255,255,0.03); border-bottom:1px solid var(--border);">
          <td style="padding:0.5rem 0.75rem;" colspan="2"></td>
          <td style="text-align:center; padding:0.5rem 0.75rem; font-size:0.8rem; color:var(--text-secondary);" colspan="2">
            GW${gw}: ${gwCorrect}/${gwPredictions.length} correct
          </td>
          <td style="text-align:center; padding:0.5rem 0.75rem; color:var(--accent-green); font-weight:600;">${gwPoints}pts</td>
        </tr>
      `;
    });
    
    tableHTML += `
          </tbody>
          <tfoot>
            <tr style="font-weight:600; border-top:2px solid var(--border); background:rgba(34,197,94,0.1);">
              <td style="padding:0.75rem;" colspan="2">TOTAL: ${totalPredictions} predictions</td>
              <td style="text-align:center; padding:0.75rem;">${totalCorrectResults} results<br><span style="font-size:0.75rem; color:var(--text-secondary);">${totalCorrectScores} exact scores</span></td>
              <td style="text-align:center; padding:0.75rem; color:var(--accent-green); font-size:1.1rem;">${totalPoints}pts</td>
            </tr>
          </tfoot>
        </table>
      </div>
    `;
    
    container.innerHTML = tableHTML;
    
  } catch (error) {
    console.error('Error loading prediction history:', error);
    container.innerHTML = `<div class="empty-state"><p>Error loading history</p></div>`;
  }
}

// Recent Activity - shows latest predictions and points earned
async function loadRecentActivity() {
  const container = document.getElementById('recent-activity');
  if (!container) return;
  
  try {
    const data = cachedPredictionsData;
    if (!data || !data.predictions || data.predictions.length === 0) {
      container.innerHTML = '<p class="text-muted">No recent activity</p>';
      return;
    }
    
    const predictions = data.predictions || [];
    const matches = data.matches || [];
    
    // Get finished matches with points
    const finishedWithPoints = predictions
      .map(p => {
        const match = matches.find(m => m.id === p.match_id);
        return { ...p, match };
      })
      .filter(p => p.match && p.match.status === 'finished' && (p.points_earned || 0) > 0)
      .sort((a, b) => (b.points_earned || 0) - (a.points_earned || 0))
      .slice(0, 3);
    
    if (finishedWithPoints.length === 0) {
      container.innerHTML = '<p class="text-muted">No points earned yet this gameweek</p>';
      return;
    }
    
    let html = '<div style="display: flex; flex-direction: column; gap: 0.5rem;">';
    finishedWithPoints.forEach(p => {
      const pointsColor = p.points_earned >= 20 ? '#22c55e' : '#f59e0b';
      html += `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 0.5rem; background: rgba(255,255,255,0.05); border-radius: 0.375rem;">
          <div style="font-size: 0.8rem;">
            <div style="font-weight: 600;">${p.match.home_team} vs ${p.match.away_team}</div>
            <div style="color: rgba(255,255,255,0.5); font-size: 0.7rem;">Predicted: ${p.predicted_result} (${p.home_score}-${p.away_score})</div>
          </div>
          <div style="color: ${pointsColor}; font-weight: 700; font-size: 0.9rem;">+${p.points_earned}pts</div>
        </div>
      `;
    });
    html += '</div>';
    
    container.innerHTML = html;
    
  } catch (error) {
    console.error('Error loading recent activity:', error);
    container.innerHTML = '<p class="text-muted">Could not load activity</p>';
  }
}

// Achievements
async function loadAchievements() {
  const container = document.getElementById('achievements');
  if (!container) return;
  
  try {
    const data = cachedPredictionsData;
    if (!data) {
      container.innerHTML = '<p class="text-muted">Loading...</p>';
      return;
    }
    
    const predictions = data.predictions || [];
    const matches = data.matches || [];
    
    const achievements = [
      { icon: '🎯', name: 'First Prediction', earned: predictions.length > 0 },
      { icon: '💯', name: 'Perfect Score', earned: predictions.some(p => p.points_earned === 20) },
      { icon: '🎩', name: 'Hat-trick', earned: checkConsecutiveCorrect(predictions, matches, 3) },
      { icon: '🔥', name: 'On Fire', earned: checkConsecutiveCorrect(predictions, matches, 5) },
      { icon: '🔫', name: 'Sharp Shooter', earned: predictions.filter(p => p.points_earned === 20).length >= 5 },
      { icon: '⭐', name: 'Top 10 Finish', earned: false },
      { icon: '👑', name: 'Top of the Week', earned: false }
    ];
    
    let html = '';
    achievements.forEach(ach => {
      const opacity = ach.earned ? '1' : '0.4';
      const border = ach.earned ? 'border:1px solid var(--accent-green);' : '';
      html += `
        <div class="achievement-badge" style="opacity:${opacity}; ${border}">
          <div class="achievement-icon">${ach.icon}</div>
          <div class="achievement-name">${ach.name}</div>
        </div>
      `;
    });
    
    container.innerHTML = html;
    
  } catch (error) {
    console.error('Error loading achievements:', error);
    container.innerHTML = '<p class="text-muted">Could not load achievements</p>';
  }
}

function checkConsecutiveCorrect(predictions, matches, count) {
  const sortedPreds = predictions
    .map(p => {
      const match = matches.find(m => m.id === p.match_id);
      return { ...p, kickoff: match?.kickoff_time || '9999' };
    })
    .sort((a, b) => a.kickoff.localeCompare(b.kickoff));
  
  let consecutive = 0;
  for (let i = 0; i < sortedPreds.length; i++) {
    if ((sortedPreds[i].points_earned || 0) >= 10) {
      consecutive++;
      if (consecutive >= count) return true;
    } else {
      consecutive = 0;
    }
  }
  return false;
}

// This Week Stats (Current GW only)
async function loadThisWeekInsights() {
  const container = document.getElementById('this-week-insights');
  if (!container) return;
  
  try {
    const data = cachedPredictionsData;
    if (!data || !data.predictions || data.predictions.length === 0) {
      container.innerHTML = '<p class="text-muted">Make predictions to see this week\'s stats</p>';
      return;
    }
    
    renderInsights(container, data, 'This Week');
  } catch (error) {
    console.error('Error loading this week insights:', error);
    container.innerHTML = '<p class="text-muted">Could not load stats</p>';
  }
}

// Season Stats (All GWs combined)
async function loadSeasonInsights() {
  const container = document.getElementById('season-insights');
  if (!container) return;
  
  try {
    const token = localStorage.getItem('gbf_token');
    
    // Fetch predictions for multiple gameweeks (35-38)
    const allPredictions = [];
    const allMatches = [];
    
    for (let gw = 35; gw <= 38; gw++) {
      try {
        const response = await fetch(`/api/predictions?gameweek=${gw}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.ok) {
          const data = await response.json();
          if (data.predictions) {
            allPredictions.push(...data.predictions);
            allMatches.push(...(data.matches || []));
          }
        }
      } catch (e) {
        console.log(`Could not load GW${gw}`);
      }
    }
    
    if (allPredictions.length === 0) {
      container.innerHTML = '<p class="text-muted">Make predictions to see season stats</p>';
      return;
    }
    
    // Remove duplicates
    const uniquePreds = [...new Map(allPredictions.map(p => [p.id, p])).values()];
    const uniqueMatches = [...new Map(allMatches.map(m => [m.id, m])).values()];
    
    renderInsights(container, { predictions: uniquePreds, matches: uniqueMatches }, 'Season');
  } catch (error) {
    console.error('Error loading season insights:', error);
    container.innerHTML = '<p class="text-muted">Could not load stats</p>';
  }
}

// Shared insights renderer
function renderInsights(container, data, label) {
  const predictions = data.predictions || [];
  const matches = data.matches || [];
  
  const finishedPreds = predictions.filter(p => {
    const match = matches.find(m => m.id === p.match_id);
    return match && match.status === 'finished';
  });
  
  const pointsArray = finishedPreds.map(p => p.points_earned || 0);
  const bestMatch = pointsArray.length > 0 ? Math.max(...pointsArray) : 0;
  const worstMatch = pointsArray.length > 0 ? Math.min(...pointsArray) : 0;
  const avgPoints = pointsArray.length > 0 
    ? Math.round(pointsArray.reduce((a, b) => a + b, 0) / pointsArray.length) 
    : 0;
  
  const resultCounts = { H: 0, X: 0, A: 0 };
  predictions.forEach(p => {
    if (resultCounts[p.predicted_result] !== undefined) {
      resultCounts[p.predicted_result]++;
    }
  });
  const total = predictions.length;
  const favResult = total > 0 ? Object.entries(resultCounts).sort((a, b) => b[1] - a[1])[0][0] : '-';
  
  const accuracyByResult = {};
  ['H', 'X', 'A'].forEach(result => {
    const resultPreds = finishedPreds.filter(p => p.predicted_result === result);
    const correct = resultPreds.filter(p => (p.points_earned || 0) >= 10).length;
    accuracyByResult[result] = resultPreds.length > 0 
      ? Math.round((correct / resultPreds.length) * 100) 
      : 0;
  });
  
  container.innerHTML = `
      <div class="insight-card">
        <div class="insight-label">Best Prediction</div>
        <div class="insight-value" style="color:#22c55e;">${bestMatch}pts</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Worst Prediction</div>
        <div class="insight-value" style="color:#ef4444;">${worstMatch}pts</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Average Points</div>
        <div class="insight-value" style="color:#f59e0b;">${avgPoints}pts</div>
      </div>
      <div class="insight-card">
        <div class="insight-label">Favourite Pick</div>
        <div class="insight-value">${favResult}</div>
        <div class="insight-detail">${Math.round((resultCounts[favResult] / total) * 100)}% of picks</div>
      </div>
      <div class="insight-card" style="grid-column: span 2;">
        <div class="insight-label">Accuracy by Prediction Type</div>
        <div style="display:flex; gap:1rem; margin-top:0.5rem;">
          <div style="flex:1; text-align:center; padding:0.5rem; background:rgba(59,130,246,0.2); border-radius:0.5rem;">
            <div style="font-size:1.25rem; font-weight:700; color:#3b82f6;">${accuracyByResult.H}%</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">Home Wins</div>
          </div>
          <div style="flex:1; text-align:center; padding:0.5rem; background:rgba(245,158,11,0.2); border-radius:0.5rem;">
            <div style="font-size:1.25rem; font-weight:700; color:#f59e0b;">${accuracyByResult.X}%</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">Draws</div>
          </div>
          <div style="flex:1; text-align:center; padding:0.5rem; background:rgba(239,68,68,0.2); border-radius:0.5rem;">
            <div style="font-size:1.25rem; font-weight:700; color:#ef4444;">${accuracyByResult.A}%</div>
            <div style="font-size:0.75rem; color:var(--text-secondary);">Away Wins</div>
          </div>
        </div>
      </div>
    `;
}


// ── LIVE SCORE CAROUSEL ──
function startLiveCarousel(liveMatches) {
  stopLiveCarousel();
  if (!liveMatches || liveMatches.length === 0) return;
  const display = document.getElementById('live-score-display');
  if (!display) return;
  carouselIndex = 0;

  function showMatch() {
    const m = liveMatches[carouselIndex % liveMatches.length];
    if (!m) return;
    const h = m.home_score !== null && m.home_score !== undefined ? m.home_score : 0;
    const a = m.away_score !== null && m.away_score !== undefined ? m.away_score : 0;
    display.style.opacity = '0';
    setTimeout(function() {
      display.innerHTML =
        '<span style="font-weight:600;color:#fff;">' + m.home_team + '</span>' +
        '<span style="background:rgba(239,68,68,0.25);border:1px solid rgba(239,68,68,0.6);color:#ef4444;font-weight:800;padding:0.15rem 0.75rem;border-radius:4px;margin:0 0.5rem;font-size:0.95rem;letter-spacing:0.05em;">' + h + ' - ' + a + '</span>' +
        '<span style="font-weight:600;color:#fff;">' + m.away_team + '</span>';
      display.style.opacity = '1';
    }, 250);
    carouselIndex++;
  }

  showMatch();
  if (liveMatches.length > 1) {
    carouselInterval = setInterval(showMatch, 8000);
  }
}

function stopLiveCarousel() {
  if (carouselInterval) { clearInterval(carouselInterval); carouselInterval = null; }
  carouselIndex = 0;
}

// Manual refresh from FPL API with debug output
async function manualRefreshScores() {
  const btn = document.getElementById('manual-refresh-btn');
  const status = document.getElementById('refresh-status');
  const debugPanel = document.getElementById('debug-panel');
  const debugOutput = document.getElementById('debug-output');
  
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';
  status.textContent = 'Calling FPL API...';
  
  try {
    console.log('=== MANUAL REFRESH START ===');
    
    // Call the live-scores API
    const response = await fetch(`${API_BASE}/live-scores`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' }
    });
    
    const data = await response.json();
    
    console.log('API Response:', data);
    
    // Build debug output
    let debugText = `=== API CALL RESULT ===\n`;
    debugText += `Status: ${response.status}\n`;
    debugText += `Gameweek: ${data.gameweek || 'N/A'}\n`;
    debugText += `Message: ${data.message || 'N/A'}\n\n`;
    
    if (data.results) {
      debugText += `=== UPDATE SUMMARY ===\n`;
      debugText += `Matches Updated: ${data.results.updated || 0}\n`;
      debugText += `Finished: ${data.results.finished || 0}\n`;
      debugText += `Live: ${data.results.live?.length || 0}\n\n`;
      
      if (data.results.live && data.results.live.length > 0) {
        debugText += `=== LIVE MATCHES ===\n`;
        data.results.live.forEach(m => {
          debugText += `${m.home_team} ${m.home}-${m.away} ${m.away_team} (${m.minute}')\n`;
        });
        debugText += `\n`;
      }
      
      if (data.results.errors && data.results.errors.length > 0) {
        debugText += `=== ERRORS ===\n`;
        data.results.errors.forEach(e => debugText += `ERROR: ${e}\n`);
        debugText += `\n`;
      }
      
      if (data.results.debug) {
        debugText += `=== DEBUG INFO ===\n`;
        debugText += JSON.stringify(data.results.debug, null, 2);
      }
    }
    
    if (data.error) {
      debugText += `\n=== ERROR ===\n${data.error}\n`;
      if (data.details) debugText += `Details: ${data.details}\n`;
    }
    
    debugOutput.textContent = debugText;
    debugPanel.style.display = 'block';
    
    status.textContent = `Updated at ${new Date().toLocaleTimeString()}`;
    
    // Reload the page data to show updated scores
    await loadUserPredictions();
    
  } catch (error) {
    console.error('Refresh error:', error);
    debugOutput.textContent = `ERROR: ${error.message}`;
    debugPanel.style.display = 'block';
    status.textContent = 'Update failed';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-sync"></i> Update from FPL API';
  }
}

// User Trends - Load aggregate prediction data
async function loadUserTrends() {
  const container = document.getElementById('user-trends-container');
  if (!container) return;
  
  try {
    // Get current gameweek
    const gwResponse = await fetch('/api/current-gameweek');
    const gwData = await gwResponse.json();
    const gameweek = gwData.current_gameweek || gwData.next_gameweek || 35;
    
    console.log('User Trends - Checking GW:', gameweek);
    console.log('User Trends - GW Data:', gwData);
    
    // Check what gameweek the user's predictions are actually stored under
    const token = localStorage.getItem('gbf_token');
    if (token) {
      const myPredsResponse = await fetch(`/api/predictions?gameweek=${gameweek}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (myPredsResponse.ok) {
        const myPreds = await myPredsResponse.json();
        console.log('User Trends - My predictions for GW' + gameweek + ':', myPreds.predictions?.length || 0);
        if (myPreds.predictions?.length > 0) {
          console.log('User Trends - First prediction gameweek:', myPreds.predictions[0].gameweek);
        }
      }
    }
    
    // Fetch trends data (using predictions API with trends=true)
    const response = await fetch(`/api/predictions?gameweek=${gameweek}&trends=true`);
    if (!response.ok) throw new Error('Failed to load trends');
    
    const data = await response.json();
    console.log('User Trends - Response:', data);
    console.log('User Trends - Matches found:', data.trends?.length || 0);
    console.log('User Trends - Total users:', data.total_users);
    
    const trends = data.trends || [];
    
    // Debug: Show first few matches and their prediction counts
    trends.slice(0, 3).forEach((t, i) => {
      console.log(`Match ${i+1}: ${t.home_team} vs ${t.away_team} - ${t.total_predictions} predictions`);
    });
    
    if (trends.length === 0 || trends.every(t => t.total_predictions === 0)) {
      container.innerHTML = `
        <div class="empty-state" style="padding: 1rem;">
          <i class="fas fa-users" style="opacity: 0.5;"></i>
          <p>No predictions for GW${gameweek} yet</p>
          <p class="text-muted" style="font-size: 0.75rem;">${data.total_users || 0} users have predicted this gameweek</p>
          <a href="/predict?gameweek=${gameweek}" class="btn btn-primary btn-sm" style="margin-top: 0.75rem;">
            <i class="fas fa-futbol"></i> Make Predictions
          </a>
        </div>
      `;
      return;
    }
    
    let trendsHTML = `<div class="trends-grid">`;
    
    trends.forEach(trend => {
      if (trend.total_predictions === 0) return;
      
      const { H, D, A } = trend.result_distribution;
      const mostCommon = trend.most_common_result;
      const mostCommonScore = trend.most_common_score;
      
      // Determine which result is most popular for highlighting
      const maxPct = Math.max(H, D, A);
      
      trendsHTML += `
        <div class="trend-card">
          <div class="trend-match">${trend.home_team} vs ${trend.away_team}</div>
          
          <!-- Result Distribution Bar -->
          <div class="trend-bar-container">
            ${H > 0 ? `<div class="trend-bar trend-bar-home" style="width: ${H}%; ${H === maxPct ? 'box-shadow: 0 0 8px rgba(59,130,246,0.5);' : ''}">${H > 15 ? H + '%' : ''}</div>` : ''}
            ${D > 0 ? `<div class="trend-bar trend-bar-draw" style="width: ${D}%; ${D === maxPct ? 'box-shadow: 0 0 8px rgba(245,158,11,0.5);' : ''}">${D > 15 ? D + '%' : ''}</div>` : ''}
            ${A > 0 ? `<div class="trend-bar trend-bar-away" style="width: ${A}%; ${A === maxPct ? 'box-shadow: 0 0 8px rgba(239,68,68,0.5);' : ''}">${A > 15 ? A + '%' : ''}</div>` : ''}
          </div>
          
          <!-- Legend -->
          <div class="trend-stats">
            <span><i class="fas fa-home" style="color: var(--accent-blue);"></i> ${H}%</span>
            <span><i class="fas fa-equals" style="color: var(--accent-amber);"></i> ${D}%</span>
            <span><i class="fas fa-plane" style="color: var(--accent-red);"></i> ${A}%</span>
            <span style="color: var(--text-muted);">${trend.total_predictions} preds</span>
          </div>
          
          <!-- Most Popular -->
          ${mostCommon ? `
            <div class="trend-most-popular">
              <i class="fas fa-fire" style="color: var(--accent-amber);"></i> 
              Most picked: <strong>${mostCommon.result === 'H' ? 'Home' : mostCommon.result === 'D' ? 'Draw' : 'Away'}</strong> 
              (${mostCommon.percentage}%)
              ${mostCommonScore ? `<span class="trend-score-tag">${mostCommonScore.score}</span>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    });
    
    trendsHTML += `</div>`;
    
    // Add summary stats
    const totalUsers = data.total_users || 0;
    trendsHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; padding: 0.75rem; background: var(--bg-hover); border-radius: 0.5rem;">
        <span style="font-size: 0.85rem; color: var(--text-secondary);">
          <i class="fas fa-users" style="color: var(--accent-green);"></i> 
          ${totalUsers} users predicted this gameweek
        </span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">GW${gameweek}</span>
      </div>
      ${trendsHTML}
    `;
    
    container.innerHTML = trendsHTML;
    
  } catch (error) {
    console.error('Error loading user trends:', error);
    container.innerHTML = `
      <div class="empty-state" style="padding: 1rem;">
        <i class="fas fa-exclamation-circle" style="color: var(--accent-red);"></i>
        <p>Could not load trends</p>
      </div>
    `;
  }
}

// Profile Tab Switching
function switchProfileTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.profile-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === tabName);
  });
  
  // Update tab content
  document.querySelectorAll('.profile-tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`tab-${tabName}`).classList.add('active');
  
  // Save preference
  localStorage.setItem('profileActiveTab', tabName);
}

// Initialize tabs on page load
function initProfileTabs() {
  // Always default to Overview tab on fresh load
  // Remove any saved preference to ensure Overview is default
  localStorage.removeItem('profileActiveTab');
  switchProfileTab('overview');
}

// Single DOMContentLoaded — correct order
document.addEventListener('DOMContentLoaded', async function() {
  await loadProfile();
  await loadUserPredictions();  // fetches and caches data first
  await loadUserTournaments();  // uses cached data for points
  loadPredictionHistory();
  loadRecentActivity();         // load recent points earned
  loadAchievements();
  loadThisWeekInsights();       // This Week stats (Overview tab)
  loadSeasonInsights();         // Season stats (Performance tab)
  loadPerformanceGraph();
  loadUserTrends();             // load aggregate prediction trends
  initProfileTabs();            // initialize tab state
});
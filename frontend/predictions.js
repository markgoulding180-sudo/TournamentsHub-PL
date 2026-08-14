// Predictions page - Auto-detect current gameweek
document.addEventListener('DOMContentLoaded', async function() {
  const fixtureList = document.querySelector('.fixture-list');
  const predictionsForm = document.getElementById('predictions-form');
  const entryGateCard = document.getElementById('entryGateCard');

  // Entry gate — a user must have actually joined the live tournament
  // before they're allowed to submit predictions. Without this, someone
  // could predict without entering and score invisibly, off the
  // leaderboard, since no tournament_entries row would exist for them.
  const token = localStorage.getItem('gbf_token');
  if (token) {
    try {
      const tRes = await fetch('/api/tournaments?status=live');
      const tData = await tRes.json();
      const liveTournament = (tData.tournaments || [])[0];

      if (liveTournament) {
        const entryRes = await fetch(`/api/tournaments?tournament_id=${liveTournament.id}&my_entry=true`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        const entryData = await entryRes.json();

        if (!entryData.entry) {
          // Not entered — hide the form entirely, show the gate instead.
          predictionsForm.style.display = 'none';
          entryGateCard.style.display = 'block';
          return;
        }
      }
    } catch (e) {
      console.error('Failed to check tournament entry status:', e);
      // If the check itself fails, fail open rather than blocking a
      // genuinely-entered user over a network hiccup — the backend
      // ultimately still only scores predictions tied to a real entry.
    }
  }
  
  // Default to next gameweek for predictions (users predict upcoming games)
  let currentGameweek = 36;
  
  // Fetch current gameweek info from FPL
  try {
    const gwResponse = await fetch('/api/current-gameweek');
    if (gwResponse.ok) {
      const gwData = await gwResponse.json();
      // Use current gameweek if not finished, otherwise use next
      currentGameweek = gwData.finished ? gwData.next_gameweek : gwData.current_gameweek;
    }
  } catch (e) {
    console.error('Failed to fetch gameweek:', e);
    // Default to 36 if API fails
    currentGameweek = 36;
  }
  
  // Display current gameweek in header
  const gwDisplay = document.getElementById('current-gw-display');
  if (gwDisplay) {
    gwDisplay.textContent = currentGameweek;
  }
  
  // Load initial fixtures
  await loadFixtures(currentGameweek);
  
  // Handle form submission
  predictionsForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    await submitPredictions(currentGameweek);
  });
  
  async function loadFixtures(gameweek) {
    try {
      fixtureList.innerHTML = '<div class="text-center p-4"><i class="fas fa-spinner fa-spin"></i> Loading fixtures...</div>';
      
      const token = localStorage.getItem('gbf_token');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(`/api/predictions?gameweek=${gameweek}`, { headers });
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load fixtures');
      }
      
      if (!data.matches || data.matches.length === 0) {
        fixtureList.innerHTML = '<div class="text-center p-4 text-muted">No fixtures found for this gameweek.</div>';
        return;
      }
      
      // Build fixtures HTML - STANDARDISED LAYOUT for all matches
      let fixturesHTML = '';
      data.matches.forEach((match, index) => {
        const matchNum = index + 1;
        const kickoffDate = new Date(match.kickoff_time);
        const dateStr = kickoffDate.toLocaleDateString('en-GB', { 
          weekday: 'short', 
          day: 'numeric', 
          month: 'short' 
        });
        
        // Determine match status
        const isFinished = match.status === 'finished';
        const isLive = match.status === 'live';
        const statusText = isFinished ? 'Full Time' : isLive ? 'In Play' : 'Not Played';
        const disabled = isFinished || isLive ? 'disabled' : '';
        const finishedClass = isFinished ? 'fixture-finished' : '';
        
        // Find existing prediction if any
        const existingPred = data.predictions?.find(p => p.match_id === match.id);
        const homeScore = existingPred ? existingPred.home_score : '';
        const awayScore = existingPred ? existingPred.away_score : '';
        const resultH = existingPred && existingPred.predicted_result === 'H' ? 'checked' : '';
        const resultD = existingPred && existingPred.predicted_result === 'D' ? 'checked' : '';
        const resultA = existingPred && existingPred.predicted_result === 'A' ? 'checked' : '';
        
        // Calculate points for finished matches
        let pointsEarned = 0;
        let pointsClass = 'points-0';
        let pointsDisplay = '';
        if (isFinished && existingPred) {
          if (existingPred.predicted_result === match.result) {
            pointsEarned += 10;
            if (existingPred.home_score === match.home_score && existingPred.away_score === match.away_score) {
              pointsEarned += 10;
            }
          }
          pointsClass = pointsEarned === 20 ? 'points-20' : pointsEarned === 10 ? 'points-10' : 'points-0';
          pointsDisplay = `<span class="points-display ${pointsClass}">${pointsEarned}pts</span>`;
        } else if (isFinished && !existingPred) {
          pointsDisplay = '<span class="points-display points-0">-</span>';
        } else {
          pointsDisplay = '<span class="points-display" style="visibility: hidden;">-</span>';
        }
        
        // Determine winner styling and inline score for finished matches
        let homeWinnerClass = '';
        let awayWinnerClass = '';
        let inlineScoreHTML = '';
        if (isFinished) {
          if (match.result === 'H') homeWinnerClass = 'team-winner';
          else if (match.result === 'A') awayWinnerClass = 'team-winner';
          inlineScoreHTML = `<span class="inline-score">${match.home_score}-${match.away_score}</span>`;
        }
        
        // STANDARDISED MATCH CARD LAYOUT - Same structure for all matches
        fixturesHTML += `
          <div class="fixture ${finishedClass}" data-match-id="${match.id}" data-home-team="${match.home_team}" data-away-team="${match.away_team}">
            <!-- Top row: Date | Status | Points -->
            <div class="fixture-header">
              <span><i class="far fa-clock"></i> ${dateStr}</span>
              <span class="match-status">${statusText}</span>
              ${pointsDisplay}
            </div>
            
            <!-- Middle row: 3 cards - Home | VS/Score | Away -->
            <div class="fixture-teams">
              <!-- Card 1: Home team -->
              <div class="team-card">
                <img src="shirts/${getTeamShirtName(match.home_team)}.webp" alt="${match.home_team}" class="team-shirt" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';">
                <div class="team-name ${homeWinnerClass}">${match.home_team}</div>
              </div>
              
              <!-- Card 2: VS or Score -->
              <div class="score-card">
                ${isFinished ? `<div class="match-score">${match.home_score}-${match.away_score}</div>` : '<span class="vs">VS</span>'}
              </div>
              
              <!-- Card 3: Away team -->
              <div class="team-card">
                <img src="shirts/${getTeamShirtName(match.away_team)}.webp" alt="${match.away_team}" class="team-shirt" onerror="this.onerror=null; this.src='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';">
                <div class="team-name ${awayWinnerClass}">${match.away_team}</div>
              </div>
            </div>
            
            <!-- Bottom row: 1/X/2 buttons and score inputs -->
            <div class="prediction-form">
              <div class="prediction-row">
                <div class="prediction-1x2">
                  <div class="prediction-option">
                    <input type="radio" name="match${matchNum}_result" id="match${matchNum}_h" value="H" ${resultH} ${disabled}>
                    <label for="match${matchNum}_h">1<span class="sub-label">${match.home_team}</span></label>
                  </div>
                  <div class="prediction-option">
                    <input type="radio" name="match${matchNum}_result" id="match${matchNum}_d" value="D" ${resultD} ${disabled}>
                    <label for="match${matchNum}_d">X<span class="sub-label">Draw</span></label>
                  </div>
                  <div class="prediction-option">
                    <input type="radio" name="match${matchNum}_result" id="match${matchNum}_a" value="A" ${resultA} ${disabled}>
                    <label for="match${matchNum}_a">2<span class="sub-label">${match.away_team}</span></label>
                  </div>
                </div>
                <div class="score-inputs">
                  <input type="number" class="score-input ${isFinished && existingPred ? 'predicted-score' : ''}" name="match${matchNum}_home_score" min="0" max="20" placeholder="0" value="${homeScore}" ${disabled}>
                  <span class="score-separator">-</span>
                  <input type="number" class="score-input ${isFinished && existingPred ? 'predicted-score' : ''}" name="match${matchNum}_away_score" min="0" max="20" placeholder="0" value="${awayScore}" ${disabled}>
                </div>
              </div>
            </div>
          </div>
        `;
      });
      
      fixtureList.innerHTML = fixturesHTML;
      
    } catch (error) {
      console.error('Error loading fixtures:', error);
      fixtureList.innerHTML = `<div class="text-center p-4 text-red"><i class="fas fa-exclamation-circle"></i> Error loading fixtures: ${error.message}</div>`;
    }
  }
  
  async function submitPredictions(gameweek) {
    try {
      const token = localStorage.getItem('gbf_token');
      if (!token) {
        showToast('Please log in to submit predictions', 'error');
        window.location.href = '/login';
        return;
      }
      
      const fixtures = document.querySelectorAll('.fixture');
      const predictions = [];
      const validationErrors = [];
      
      console.log('Submitting predictions for', fixtures.length, 'fixtures');
      
      fixtures.forEach((fixture, index) => {
        const matchId = fixture.dataset.matchId;
        const matchNum = index + 1;
        const homeTeam = fixture.dataset.homeTeam || 'Home';
        const awayTeam = fixture.dataset.awayTeam || 'Away';
        
        // Get the selected radio button for this match
        const resultRadio = document.querySelector(`input[name="match${matchNum}_result"]:checked`);
        const homeScoreInput = document.querySelector(`input[name="match${matchNum}_home_score"]`);
        const awayScoreInput = document.querySelector(`input[name="match${matchNum}_away_score"]`);
        
        const homeScore = homeScoreInput ? homeScoreInput.value : '';
        const awayScore = awayScoreInput ? awayScoreInput.value : '';
        
        console.log(`Match ${matchNum}:`, { matchId, result: resultRadio?.value, homeScore, awayScore });
        
        if (resultRadio && resultRadio.value) {
          const result = resultRadio.value;
          const hScore = homeScore !== '' ? parseInt(homeScore) : 0;
          const aScore = awayScore !== '' ? parseInt(awayScore) : 0;

          // The result pick (1/X/2) and the exact score must actually
          // agree — a Home win needs a genuine winning home score, a
          // Draw needs equal scores, an Away win needs a genuine winning
          // away score. Left unchecked, tapping a result without also
          // entering a matching score (or entering a score for the wrong
          // team) silently saved something contradictory, like "Home
          // win" alongside a 0-0 or an away-winning scoreline — technically
          // saved correctly, but not what the person actually meant.
          let mismatch = null;
          if (result === 'H' && hScore <= aScore) {
            mismatch = `${homeTeam} vs ${awayTeam}: you picked ${homeTeam} to win, but ${hScore}-${aScore} isn't a ${homeTeam} win.`;
          } else if (result === 'A' && aScore <= hScore) {
            mismatch = `${homeTeam} vs ${awayTeam}: you picked ${awayTeam} to win, but ${hScore}-${aScore} isn't an ${awayTeam} win.`;
          } else if (result === 'D' && hScore !== aScore) {
            mismatch = `${homeTeam} vs ${awayTeam}: you picked a Draw, but ${hScore}-${aScore} isn't an equal score.`;
          }

          if (mismatch) {
            validationErrors.push(mismatch);
          }

          predictions.push({
            match_id: matchId,
            predicted_result: result,
            home_score: hScore,
            away_score: aScore
          });
        }
      });

      if (validationErrors.length > 0) {
        showScoreWarning(validationErrors);
        return;
      }
      
      console.log('Collected predictions:', predictions);
      
      if (predictions.length === 0) {
        showToast('Please select a result (1, X, or 2) for at least one match', 'error');
        return;
      }
      
      const response = await fetch('/api/predictions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          gameweek: gameweek,
          predictions: predictions
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit predictions');
      }
      
      // The backend already tells us exactly which matches were skipped
      // (already kicked off) and how many were actually saved — confirmed
      // as a real gap that this was being computed correctly server-side
      // but never once reached the user, who'd see the exact same
      // generic "saved successfully" message whether everything saved or
      // only some of it did.
      if (data.skipped && data.skipped.length > 0) {
        const savedCount = (data.predictions || []).length;
        showToast(`${savedCount} prediction${savedCount === 1 ? '' : 's'} saved. ${data.skipped.length} match${data.skipped.length === 1 ? '' : 'es'} already kicked off and couldn't be changed.`, 'info');
      } else {
        showToast('Predictions saved successfully!', 'success');
      }

      // Give the toast enough time to actually be read before navigating
      // away — longer for the partial-save case specifically, since it's
      // a longer, more important message than a plain success confirmation.
      const hasSkipped = data.skipped && data.skipped.length > 0;
      setTimeout(() => {
        window.location.href = '/predictions';
      }, hasSkipped ? 3500 : 1200);
      
    } catch (error) {
      console.error('Error submitting predictions:', error);
      showToast('Error submitting predictions: ' + error.message, 'error');
    }
  }
  
  function getTeamShirtName(teamName) {
    // Map team names to actual shirt file names (with spaces as they appear in filesystem)
    const shirtMap = {
      'Arsenal': 'arsenal',
      'Aston Villa': 'aston villa',
      'Bournemouth': 'bournmouth',
      'Brentford': 'brentford',
      'Brighton': 'brighton',
      'Burnley': 'burnley',
      'Chelsea': 'chelsea',
      'Coventry City': 'coventry city',
      'Crystal Palace': 'crystal',
      'Everton': 'everton',
      'Fulham': 'fullham',
      'Hull City': 'hull city',
      'Ipswich Town': 'ipswich town',
      'Leeds': 'leeds',
      'Liverpool': 'liverpool',
      'Man City': 'man city',
      'Man United': 'man u',
      'Man Utd': 'man u',
      'Manchester United': 'man u',
      'Manchester Utd': 'man u',
      'Newcastle': 'new castle',
      'Newcastle United': 'new castle',
      'Newcastle Utd': 'new castle',
      'Nott\'m Forest': 'nots forest',
      'Nottingham Forest': 'nots forest',
      'Notts Forest': 'nots forest',
      'Spurs': 'spurs',
      'Tottenham': 'spurs',
      'Tottenham Hotspur': 'spurs',
      'West Ham': 'west ham',
      'West Ham United': 'west ham',
      'West Ham Utd': 'west ham',
      'Wolves': 'wovles temp',
      'Wolverhampton': 'wovles temp',
      'Wolverhampton Wanderers': 'wovles temp',
      'Sunderland': 'sunderland'
    };
    return shirtMap[teamName] || teamName.toLowerCase();
  }

  window.showScoreWarning = function(errors) {
    const list = document.getElementById('scoreWarningList');
    list.innerHTML = errors.map(e => `<div style="margin-bottom:10px; padding-left:10px; border-left:2px solid var(--accent-red);">${e}</div>`).join('');
    document.getElementById('scoreWarningOverlay').style.display = 'flex';
  };

  window.closeScoreWarning = function() {
    document.getElementById('scoreWarningOverlay').style.display = 'none';
  };
});
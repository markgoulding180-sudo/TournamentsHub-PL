// Fantasy Football Manager - squad builder
// Reuses the existing PL database (players, teams, tournaments, tournament_entries).
// No new Vercel functions: talks to /api/sync-players?list=true and /api/tournaments.

document.addEventListener('DOMContentLoaded', async function () {
  const POSITION_LABELS = { 1: 'GK', 2: 'DEF', 3: 'MID', 4: 'FWD' };
  const POSITION_QUOTA = { 1: 2, 2: 5, 3: 5, 4: 3 };
  const BUDGET_LIMIT = 1000; // now_cost is in tenths of £m, so 1000 = £100.0m

  let allPlayers = [];
  let teamsById = {};
  let squad = []; // array of player objects currently selected
  let captainId = null;
  let activeFilter = 'all';
  let searchTerm = '';
  let tournamentId = null;

  const els = {
    statusBadge: document.getElementById('fmStatusBadge'),
    budgetLeft: document.getElementById('fmBudgetLeft'),
    squadCount: document.getElementById('fmSquadCount'),
    countGK: document.getElementById('fmCountGK'),
    countDEF: document.getElementById('fmCountDEF'),
    countMID: document.getElementById('fmCountMID'),
    countFWD: document.getElementById('fmCountFWD'),
    playerList: document.getElementById('fmPlayerList'),
    squadPanel: document.getElementById('fmSquadPanel'),
    saveBtn: document.getElementById('fmSaveBtn'),
    leaderboard: document.getElementById('fmLeaderboard'),
    search: document.getElementById('fmSearch'),
    filters: document.getElementById('fmFilters'),
    gwPoints: document.getElementById('fmGwPoints'),
    deadlineLabel: document.getElementById('fmDeadlineLabel'),
    deadlineValue: document.getElementById('fmDeadlineValue'),
    enterGate: document.getElementById('fmEnterGate'),
    enterDesc: document.getElementById('fmEnterDesc'),
    enterBtn: document.getElementById('fmEnterBtn'),
    mainContent: document.getElementById('fmMainContent'),
    lockBanner: document.getElementById('fmLockBanner'),
    lockText: document.getElementById('fmLockText')
  };

  let hasEntered = false;
  let lockInfo = { locked: false };
  let tournamentInfo = null;

  function authHeaders() {
    const token = localStorage.getItem('gbf_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  function fmt(n) { return (n / 10).toFixed(1); }

  function squadCost() {
    return squad.reduce((sum, p) => sum + (p.now_cost || 0), 0);
  }

  function countByType(type) {
    return squad.filter(p => p.element_type === type).length;
  }

  // ---------- Load data ----------
  async function loadTournament() {
    try {
      const res = await fetch('/api/tournaments?status=live&tournament_type=fantasy');
      const data = await res.json();
      const t = (data.tournaments || []).find(t => t.format === 'fantasy_squad');
      if (!t) {
        els.statusBadge.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Fantasy Manager tournament not set up yet';
        return;
      }
      tournamentId = t.id;
      tournamentInfo = t;
      if (els.enterDesc) {
        const fee = ((t.entry_fee || 0) / 100).toFixed(2);
        els.enterDesc.textContent = `Entry fee £${fee}. Once you're entered, build your 15-player squad — you can edit it any time until the next gameweek deadline.`;
      }
      await loadLockStatus();
      await loadMyEntry();
      await loadLeaderboard();
    } catch (e) {
      console.error('Failed to load tournament:', e);
      els.statusBadge.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Couldn\'t reach the tournament';
    }
  }

  async function loadLockStatus() {
    if (!tournamentId) return;
    try {
      const res = await fetch(`/api/tournaments?tournament_id=${tournamentId}&lock_status=true&tournament_type=fantasy`);
      lockInfo = await res.json();
      applyLockUI();
    } catch (e) {
      console.error('Failed to load lock status:', e);
    }
  }

  function applyLockUI() {
    if (!els.lockBanner) return;
    if (lockInfo.locked) {
      els.lockBanner.style.display = 'inline-flex';
      els.lockText.textContent = lockInfo.reason || 'Squad is currently locked.';
      els.saveBtn.disabled = true;
      els.playerList.style.pointerEvents = 'none';
      els.playerList.style.opacity = '0.5';
      els.squadPanel.style.pointerEvents = 'none';
      els.squadPanel.style.opacity = '0.7';
    } else {
      els.lockBanner.style.display = 'none';
      els.playerList.style.pointerEvents = '';
      els.playerList.style.opacity = '';
      els.squadPanel.style.pointerEvents = '';
      els.squadPanel.style.opacity = '';
      renderStats(); // re-enables Save Squad if the squad is otherwise complete
    }
    updateDeadlineDisplay();
  }

  // ---------- Deadline countdown ----------
  let deadlineTickInterval = null;

  function updateDeadlineDisplay() {
    if (!els.deadlineValue) return;

    if (lockInfo.locked) {
      els.deadlineLabel.textContent = `Gameweek ${lockInfo.gameweek || ''}`;
      els.deadlineValue.textContent = 'LOCKED';
      els.deadlineValue.style.color = 'var(--red)';
      if (deadlineTickInterval) { clearInterval(deadlineTickInterval); deadlineTickInterval = null; }
      return;
    }

    const deadlineMs = lockInfo.deadline_epoch ? lockInfo.deadline_epoch * 1000 : null;
    const isFutureDeadline = deadlineMs && deadlineMs > Date.now();

    if (!isFutureDeadline) {
      // Gameweek already finished and no next fixture deadline known yet
      // (e.g. next gameweek's fixtures not synced/scheduled yet)
      els.deadlineLabel.textContent = 'Squad';
      els.deadlineValue.textContent = 'Open';
      els.deadlineValue.style.color = 'var(--green)';
      if (deadlineTickInterval) { clearInterval(deadlineTickInterval); deadlineTickInterval = null; }
      return;
    }

    els.deadlineLabel.textContent = `Deadline — GW${lockInfo.gameweek || ''}`;
    els.deadlineValue.style.color = 'var(--accent-2)';

    function tick() {
      const remainingMs = deadlineMs - Date.now();
      if (remainingMs <= 0) {
        els.deadlineValue.textContent = 'Locking…';
        if (deadlineTickInterval) { clearInterval(deadlineTickInterval); deadlineTickInterval = null; }
        return;
      }
      const totalSeconds = Math.floor(remainingMs / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (days > 0) {
        els.deadlineValue.textContent = `${days}d ${hours}h ${minutes}m`;
      } else if (hours > 0) {
        els.deadlineValue.textContent = `${hours}h ${minutes}m ${seconds}s`;
      } else {
        els.deadlineValue.textContent = `${minutes}m ${seconds}s`;
      }
    }

    if (deadlineTickInterval) clearInterval(deadlineTickInterval);
    tick();
    deadlineTickInterval = setInterval(tick, 1000);
  }

  async function loadMyEntry() {
    const token = localStorage.getItem('gbf_token');
    if (!token || !tournamentId) {
      els.statusBadge.innerHTML = '<i class="fas fa-lock"></i> Log in to enter';
      if (els.enterGate) els.enterGate.style.display = 'none';
      if (els.mainContent) els.mainContent.style.display = 'none';
      return;
    }
    try {
      const res = await fetch(`/api/tournaments?tournament_id=${tournamentId}&my_entry=true&tournament_type=fantasy`, {
        headers: authHeaders()
      });
      const data = await res.json();

      hasEntered = !!data.entry;

      if (!hasEntered) {
        // Not entered yet — show the Enter Tournament gate, hide the builder
        els.statusBadge.innerHTML = '<i class="fas fa-circle-info"></i> Not entered yet';
        if (els.enterGate) els.enterGate.style.display = 'block';
        if (els.mainContent) els.mainContent.style.display = 'none';
        return;
      }

      // Entered — show the squad builder
      if (els.enterGate) els.enterGate.style.display = 'none';
      if (els.mainContent) els.mainContent.style.display = 'block';

      if (data.entry.squad_players) {
        squad = data.entry.squad_players
          .map(id => allPlayers.find(p => p.id === id))
          .filter(Boolean);
        captainId = data.entry.captain_id;
        els.statusBadge.className = 'fm-status-badge entered';
        els.statusBadge.innerHTML = '<i class="fas fa-circle-check"></i> Squad saved — edit any time before your next gameweek deadline';
      } else {
        els.statusBadge.innerHTML = '<i class="fas fa-circle-info"></i> Entered — build your squad below';
      }
    } catch (e) {
      console.error('Failed to load entry:', e);
    }
    renderSquad();
    renderPlayerList();
    applyLockUI();
  }

  async function loadPlayers() {
    try {
      const res = await fetch('/api/sync-players?list=true');
      const data = await res.json();
      allPlayers = data.players || [];
      (data.teams || []).forEach(t => { teamsById[t.id] = t; });
      renderPlayerList();
    } catch (e) {
      console.error('Failed to load players:', e);
      els.playerList.innerHTML = '<p class="text-muted">Couldn\'t load players right now.</p>';
    }
  }

  async function loadLeaderboard() {
    if (!tournamentId) return;
    try {
      const res = await fetch(`/api/tournaments?tournament_id=${tournamentId}&leaderboard=true&tournament_type=fantasy`);
      const data = await res.json();
      const rows = (data.leaderboard || []).slice(0, 10);
      if (rows.length === 0) {
        els.leaderboard.innerHTML = '<p class="text-muted">No squads saved yet — be the first!</p>';
        return;
      }
      els.leaderboard.innerHTML = rows.map(r => `
        <div class="fm-lb-row">
          <span class="rank ${r.rank <= 3 ? 'rank-' + r.rank : ''}" style="width:22px;">${r.rank}</span>
          <span style="flex:1;">${escapeHtml(r.users ? (r.users.display_name || r.users.username) : 'Player')}</span>
          <span style="text-align:right;">
            <span class="text-amber" style="font-weight:700; display:block;">${r.entry_points || 0} pts</span>
            <span class="text-muted" style="font-size:.72rem;">${r.gw_points || 0} this GW</span>
          </span>
        </div>`).join('');
    } catch (e) {
      console.error('Failed to load leaderboard:', e);
      els.leaderboard.innerHTML = '<p class="text-muted">Couldn\'t load leaderboard right now.</p>';
    }
  }

  // ---------- Rendering ----------
  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderStats() {
    const cost = squadCost();
    const left = BUDGET_LIMIT - cost;
    els.budgetLeft.textContent = `£${fmt(left)}m`;
    els.budgetLeft.className = 'fm-stat-value' + (left < 0 ? ' over' : '');
    els.squadCount.textContent = `${squad.length} / 15`;
    els.countGK.textContent = `${countByType(1)} / 2`;
    els.countDEF.textContent = `${countByType(2)} / 5`;
    els.countMID.textContent = `${countByType(3)} / 5`;
    els.countFWD.textContent = `${countByType(4)} / 3`;

    // This gameweek's live points for the squad as currently built —
    // uses each player's event_points (this gameweek only), captain doubled.
    if (els.gwPoints) {
      if (squad.length === 0) {
        els.gwPoints.textContent = '-- pts';
      } else {
        const gw = squad.reduce((sum, p) => {
          const pts = p.event_points || 0;
          return sum + (p.id === captainId ? pts * 2 : pts);
        }, 0);
        els.gwPoints.textContent = `${gw} pts`;
      }
    }

    const complete = squad.length === 15 && captainId && squadCost() <= BUDGET_LIMIT;
    els.saveBtn.disabled = !complete;
  }

  function renderPlayerList() {
    let list = allPlayers;
    if (activeFilter !== 'all') {
      list = list.filter(p => String(p.element_type) === activeFilter);
    }
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      list = list.filter(p => (p.web_name || '').toLowerCase().includes(q));
    }
    list = list.slice(0, 120); // keep the DOM light; search narrows it down

    const squadIds = new Set(squad.map(p => p.id));

    els.playerList.innerHTML = list.map(p => {
      const inSquad = squadIds.has(p.id);
      const posLabel = POSITION_LABELS[p.element_type] || '?';
      const posClass = posLabel.toLowerCase();
      const quotaFull = countByType(p.element_type) >= POSITION_QUOTA[p.element_type];
      const overBudget = (squadCost() + p.now_cost) > BUDGET_LIMIT;
      const disabled = inSquad || squad.length >= 15 || quotaFull || overBudget;
      const team = teamsById[p.team];

      return `
        <div class="fm-player-row ${disabled && !inSquad ? 'disabled' : ''}" data-player-id="${p.id}" style="cursor:pointer;">
          <span class="fm-pos-badge ${posClass}">${posLabel}</span>
          <span class="fm-player-name">
            ${escapeHtml(p.web_name)}
            <span class="team">${team ? escapeHtml(team.short_name || team.name) : ''}</span>
          </span>
          <span class="fm-player-meta">
            <span>£${fmt(p.now_cost)}m</span>
            <span>${p.total_points ?? 0} pts</span>
            <span style="color:var(--gold);">${p.event_points ?? 0} GW</span>
          </span>
          <button class="fm-add-btn" data-add="${p.id}" ${inSquad || disabled ? 'disabled' : ''} title="${inSquad ? 'Already in squad' : (quotaFull ? posLabel + ' slots full' : (overBudget ? 'Over budget' : 'Add to squad'))}">
            ${inSquad ? '<i class="fas fa-check"></i>' : '+'}
          </button>
        </div>`;
    }).join('') || '<p class="text-muted">No players match your search.</p>';
  }

  function renderSquad() {
    const groups = [1, 2, 3, 4].map(type => {
      const players = squad.filter(p => p.element_type === type);
      const slots = POSITION_QUOTA[type];
      let html = `<div class="fm-squad-group-title">${POSITION_LABELS[type]} (${players.length}/${slots})</div>`;
      for (let i = 0; i < slots; i++) {
        const p = players[i];
        if (p) {
          const isCaptain = p.id === captainId;
          html += `
            <div class="fm-squad-slot" data-player-id="${p.id}">
              <button class="fm-cap-btn ${isCaptain ? 'active' : ''}" data-captain="${p.id}" title="Set as captain">C</button>
              <span class="fm-player-name">${escapeHtml(p.web_name)}<span class="team">£${fmt(p.now_cost)}m</span></span>
              <span style="color:var(--gold); font-size:.8rem; font-weight:700; flex:none;">${(p.event_points ?? 0) * (isCaptain ? 2 : 1)} GW</span>
              <button class="fm-remove-btn" data-remove="${p.id}" title="Remove"><i class="fas fa-xmark"></i></button>
            </div>`;
        } else {
          html += `<div class="fm-squad-slot empty">Empty ${POSITION_LABELS[type]} slot</div>`;
        }
      }
      return html;
    }).join('');

    els.squadPanel.innerHTML = groups;
    renderStats();
  }

  // ---------- Interactions ----------
  els.playerList.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-add]');
    if (btn) {
      if (btn.disabled) return;
      const id = parseInt(btn.dataset.add, 10);
      const player = allPlayers.find(p => p.id === id);
      if (!player) return;

      if (squad.length >= 15) { alert('Your squad already has 15 players.'); return; }
      if (countByType(player.element_type) >= POSITION_QUOTA[player.element_type]) {
        alert(`You already have the maximum number of ${POSITION_LABELS[player.element_type]}s.`);
        return;
      }
      if (squadCost() + player.now_cost > BUDGET_LIMIT) {
        alert('Adding this player would take you over the £100.0m budget.');
        return;
      }

      squad.push(player);
      if (squad.length === 1) captainId = player.id; // sensible default
      renderSquad();
      renderPlayerList();
      return;
    }

    // Clicked the row itself (not the add button) — open the player's page
    const row = e.target.closest('[data-player-id]');
    if (row) {
      window.location.href = `/player?id=${row.dataset.playerId}`;
    }
  });

  els.squadPanel.addEventListener('click', function (e) {
    const remBtn = e.target.closest('[data-remove]');
    if (remBtn) {
      const id = parseInt(remBtn.dataset.remove, 10);
      squad = squad.filter(p => p.id !== id);
      if (captainId === id) captainId = squad.length ? squad[0].id : null;
      renderSquad();
      renderPlayerList();
      return;
    }
    const capBtn = e.target.closest('[data-captain]');
    if (capBtn) {
      captainId = parseInt(capBtn.dataset.captain, 10);
      renderSquad();
      return;
    }
    const slot = e.target.closest('[data-player-id]');
    if (slot) {
      window.location.href = `/player?id=${slot.dataset.playerId}`;
    }
  });

  els.filters.addEventListener('click', function (e) {
    const btn = e.target.closest('.fm-filter-btn');
    if (!btn) return;
    els.filters.querySelectorAll('.fm-filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.pos;
    renderPlayerList();
  });

  els.search.addEventListener('input', function (e) {
    searchTerm = e.target.value.trim();
    renderPlayerList();
  });

  els.saveBtn.addEventListener('click', async function () {
    const token = localStorage.getItem('gbf_token');
    if (!token) { alert('Please log in to save your squad.'); return; }
    if (!tournamentId) { alert('Fantasy Manager tournament is not available right now.'); return; }
    if (!hasEntered) { alert('Enter the tournament first.'); return; }
    if (lockInfo.locked) { alert(lockInfo.reason || 'Squad is currently locked.'); return; }
    if (squad.length !== 15 || !captainId) { alert('Pick a full 15-player squad and a captain first.'); return; }

    els.saveBtn.disabled = true;
    els.saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving…';

    try {
      const res = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          action: 'join',
          tournament_type: 'fantasy',
          tournament_id: tournamentId,
          squad_players: squad.map(p => p.id),
          captain_id: captainId
        })
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || 'Failed to save squad');
      } else {
        alert('Squad saved! Good luck.');
        els.statusBadge.className = 'fm-status-badge entered';
        els.statusBadge.innerHTML = '<i class="fas fa-circle-check"></i> Squad saved — edit any time before your next gameweek deadline';
        await loadLeaderboard();
      }
    } catch (e) {
      console.error('Save squad failed:', e);
      alert('Error saving squad. Please try again.');
    } finally {
      els.saveBtn.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Squad';
      renderStats();
    }
  });

  if (els.enterBtn) {
    els.enterBtn.addEventListener('click', async function () {
      const token = localStorage.getItem('gbf_token');
      if (!token) { alert('Please log in first.'); return; }
      if (!tournamentId) { alert('Fantasy Manager tournament is not available right now.'); return; }

      els.enterBtn.disabled = true;
      els.enterBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Entering…';

      try {
        const res = await fetch('/api/tournaments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({
            action: 'join',
            tournament_type: 'fantasy',
            tournament_id: tournamentId
            // no squad_players — this just enters the tournament
          })
        });
        const data = await res.json();
        if (!res.ok) {
          alert(data.error || 'Failed to enter tournament');
        } else {
          hasEntered = true;
          await loadMyEntry();
        }
      } catch (e) {
        console.error('Enter tournament failed:', e);
        alert('Error entering tournament. Please try again.');
      } finally {
        els.enterBtn.innerHTML = '<i class="fas fa-right-to-bracket"></i> Enter Now';
        els.enterBtn.disabled = false;
      }
    });
  }

  // ---------- Init ----------
  await loadPlayers();
  await loadTournament();
  renderStats();

  // Live data refresh is handled by the shared live-poll.js script (see
  // fantasy-manager.html) — re-render this page's own view whenever it runs.
  window.addEventListener('gbf-data-refreshed', async () => {
    await loadPlayers();
    squad = squad.map(p => allPlayers.find(ap => ap.id === p.id) || p);
    renderSquad();
    renderPlayerList();
    await loadLeaderboard();
    await loadLockStatus();
  });
});

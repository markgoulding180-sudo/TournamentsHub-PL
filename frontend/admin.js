// Admin panel JavaScript
// Admin PIN - Change this to your desired PIN
const ADMIN_PIN = '1234';

document.addEventListener('DOMContentLoaded', function() {
  // Check admin access with PIN
  checkAdminAccess();
});

async function checkAdminAccess() {
  const token = localStorage.getItem('gbf_token');
  if (!token) {
    window.location.href = '/login.html';
    return;
  }
  
  // Check if PIN was already verified this session
  const pinVerified = sessionStorage.getItem('admin_pin_verified');
  if (pinVerified === 'true') {
    // PIN already verified, load admin panel
    refreshStatus();
    loadStockMarketTournamentList();
    return;
  }
  
  // Show PIN modal
  showPinModal();
}

function showPinModal() {
  // Create PIN modal if it doesn't exist
  let modal = document.getElementById('pin-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pin-modal';
    modal.innerHTML = `
      <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); z-index: 9999; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 1rem; padding: 2rem; max-width: 400px; width: 90%; text-align: center;">
          <div style="font-size: 3rem; color: var(--accent-amber); margin-bottom: 1rem;">
            <i class="fas fa-lock"></i>
          </div>
          <h2 style="margin-bottom: 0.5rem;">Admin Access</h2>
          <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Enter PIN to access admin panel</p>
          <div style="display: flex; gap: 0.5rem; justify-content: center; margin-bottom: 1rem;">
            <input type="password" id="pin-input-1" maxlength="1" style="width: 50px; height: 60px; text-align: center; font-size: 1.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);" autocomplete="off">
            <input type="password" id="pin-input-2" maxlength="1" style="width: 50px; height: 60px; text-align: center; font-size: 1.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);" autocomplete="off">
            <input type="password" id="pin-input-3" maxlength="1" style="width: 50px; height: 60px; text-align: center; font-size: 1.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);" autocomplete="off">
            <input type="password" id="pin-input-4" maxlength="1" style="width: 50px; height: 60px; text-align: center; font-size: 1.5rem; border-radius: 0.5rem; border: 1px solid var(--border-color); background: var(--bg-secondary); color: var(--text-primary);" autocomplete="off">
          </div>
          <div id="pin-error" style="color: var(--accent-red); font-size: 0.875rem; margin-bottom: 1rem; display: none;">Incorrect PIN</div>
          <button id="pin-submit" class="btn btn-green" style="width: 100%;">Unlock</button>
          <button id="pin-cancel" class="btn btn-outline" style="width: 100%; margin-top: 0.5rem;">Cancel</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    
    // Add event listeners
    setupPinInputs();
  }
  
  modal.style.display = 'block';
  document.getElementById('pin-input-1').focus();
}

function setupPinInputs() {
  const inputs = [
    document.getElementById('pin-input-1'),
    document.getElementById('pin-input-2'),
    document.getElementById('pin-input-3'),
    document.getElementById('pin-input-4')
  ];
  
  // Auto-focus next input
  inputs.forEach((input, index) => {
    input.addEventListener('input', function(e) {
      if (this.value.length === 1 && index < 3) {
        inputs[index + 1].focus();
      }
      if (this.value.length === 1 && index === 3) {
        // Last digit entered, auto-submit
        verifyPin();
      }
    });
    
    // Handle backspace
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Backspace' && this.value === '' && index > 0) {
        inputs[index - 1].focus();
      }
    });
    
    // Only allow numbers
    input.addEventListener('keypress', function(e) {
      if (!/[0-9]/.test(e.key)) {
        e.preventDefault();
      }
    });
  });
  
  // Submit button
  document.getElementById('pin-submit').addEventListener('click', verifyPin);
  
  // Cancel button
  document.getElementById('pin-cancel').addEventListener('click', function() {
    window.location.href = '/index.html';
  });
}

function verifyPin() {
  const inputs = [
    document.getElementById('pin-input-1'),
    document.getElementById('pin-input-2'),
    document.getElementById('pin-input-3'),
    document.getElementById('pin-input-4')
  ];
  
  const enteredPin = inputs.map(input => input.value).join('');
  
  if (enteredPin === ADMIN_PIN) {
    // PIN correct
    sessionStorage.setItem('admin_pin_verified', 'true');
    document.getElementById('pin-modal').style.display = 'none';
    refreshStatus();
    loadStockMarketTournamentList();
  } else {
    // PIN incorrect
    document.getElementById('pin-error').style.display = 'block';
    inputs.forEach(input => input.value = '');
    inputs[0].focus();
    
    // Shake animation
    const modal = document.querySelector('#pin-modal > div > div');
    modal.style.animation = 'shake 0.5s';
    setTimeout(() => {
      modal.style.animation = '';
    }, 500);
  }
}

async function refreshStatus() {
  try {
    loadBroadcastMessages();
    const response = await fetch('/api/admin-stats');
    const data = await response.json();
    
    document.getElementById('total-matches').textContent = data.total_matches || 0;
    document.getElementById('total-predictions').textContent = data.total_predictions || 0;
    
    // Get Master Clock
    const gwResponse = await fetch('/api/current-gameweek');
    const gwData = await gwResponse.json();
    
    if (gwData.error) {
      // Master clock not initialized
      document.getElementById('api-gw').textContent = 'Not Set';
      document.getElementById('next-gw').textContent = '⚠️ Initialize Master Clock';
      document.getElementById('next-gw').style.color = 'var(--accent-amber)';
      document.getElementById('deadline').textContent = 'N/A';
      updateGameweekPanel(null);
      return;
    }
    
    document.getElementById('api-gw').textContent = gwData.last_finalised_gameweek || 'None';
    document.getElementById('next-gw').textContent = `GW${gwData.current_gameweek}`;
    document.getElementById('next-gw').style.color = '';
    document.getElementById('deadline').textContent = gwData.deadline ? new Date(gwData.deadline).toLocaleString() : 'N/A';
    
    // Update labels
    const lastCompletedLabel = document.querySelector('#status-panel .admin-status-item:nth-child(1) span');
    const nextGWLabel = document.querySelector('#status-panel .admin-status-item:nth-child(2) span');
    if (lastCompletedLabel) lastCompletedLabel.textContent = 'Last Finalised:';
    if (nextGWLabel) nextGWLabel.textContent = 'Current GW (Master Clock):';

    updateGameweekPanel(gwData);
    
  } catch (error) {
    console.error('Error refreshing status:', error);
  }
}

function updateGameweekPanel(gwData) {
  const currentDisplay = document.getElementById('gw-current-display');
  const matchCount = document.getElementById('gw-match-count');
  const hint = document.getElementById('gw-advance-hint');
  const advanceBtn = document.getElementById('gw-advance-btn');
  if (!currentDisplay) return;

  if (!gwData) {
    currentDisplay.textContent = '--';
    matchCount.textContent = '--';
    hint.innerHTML = '<span class="text-muted">Set a gameweek below to get started.</span>';
    advanceBtn.disabled = true;
    return;
  }

  currentDisplay.textContent = `GW${gwData.current_gameweek}`;
  matchCount.textContent = `${gwData.matches_finished ?? 0} / ${gwData.matches_total ?? 0}`;

  if (!gwData.matches_total) {
    hint.innerHTML = '<span class="text-muted"><i class="fas fa-circle-info"></i> No fixtures synced for this gameweek yet.</span>';
    advanceBtn.disabled = false;
  } else if (gwData.all_matches_finished) {
    matchCount.style.color = 'var(--accent-green)';
    hint.innerHTML = '<span style="color:var(--accent-green);"><i class="fas fa-circle-check"></i> All matches finished — safe to advance.</span>';
    advanceBtn.disabled = false;
  } else {
    matchCount.style.color = 'var(--accent-amber)';
    hint.innerHTML = '<span style="color:var(--accent-amber);"><i class="fas fa-triangle-exclamation"></i> Some matches still in progress — you can still advance manually if you want to, but double check first.</span>';
    advanceBtn.disabled = false;
  }
}

async function advanceGameweek() {
  const currentText = document.getElementById('gw-current-display').textContent;
  if (!confirm(`Finalise ${currentText} (archives Predictions' results, calculates rankings/prizes) and advance to the next gameweek?`)) return;

  log(`Finalising and advancing gameweek...`);
  try {
    const token = localStorage.getItem('gbf_token');
    // This is the ONE action that does the complete job: archives
    // Predictions' prediction_history, computes gameweek_summary, ranks
    // tournament_entries with prizes, AND advances master_clock — all in
    // one step, so there's only ever one button to click, not two that
    // silently do different amounts of work.
    const response = await fetch('/api/gameweek-transition?manual=true', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      log(`Failed to advance: ${data.error}`, 'error');
      return;
    }
    log(`${data.message || 'Advanced'} — actions: ${(data.actions || []).join(', ')}`, 'success');
    refreshStatus();
  } catch (error) {
    log(`Error advancing gameweek: ${error.message}`, 'error');
  }
}

// ================= MESSAGE CENTER =================
function escapeHtmlBroadcast(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function loadBroadcastMessages() {
  const list = document.getElementById('broadcastMessagesList');
  if (!list) return;
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments?notifications=true', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    const messages = data.admin_messages || [];

    if (messages.length === 0) {
      list.innerHTML = '<div class="text-muted">No active broadcast messages.</div>';
      return;
    }

    list.innerHTML = messages.map(m => `
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:10px; padding:0.6rem 0; border-bottom:1px solid var(--border-color);">
        <div>
          <span style="text-transform:uppercase; font-size:0.7rem; font-weight:700; color:${m.severity === 'urgent' ? '#ef4444' : m.severity === 'warning' ? '#f2b93d' : 'var(--accent-blue)'};">${escapeHtmlBroadcast(m.severity || 'info')}</span>
          <div>${escapeHtmlBroadcast(m.message)}</div>
        </div>
        <button class="btn btn-sm" onclick="deactivateBroadcastMessage('${m.id}')" title="Deactivate" style="flex:none;"><i class="fas fa-xmark"></i></button>
      </div>`).join('');
  } catch (error) {
    list.innerHTML = '<div class="text-muted">Failed to load messages.</div>';
    console.error('loadBroadcastMessages error:', error);
  }
}

async function sendBroadcastMessage() {
  const input = document.getElementById('broadcastMessageInput');
  const severity = document.getElementById('broadcastSeveritySelect').value;
  const message = input.value.trim();
  if (!message) {
    log('Broadcast message cannot be empty', 'error');
    return;
  }

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'admin_broadcast', message, severity })
    });
    const data = await response.json();
    if (!response.ok) {
      log(`Failed to broadcast: ${data.error}`, 'error');
      return;
    }
    log('Broadcast sent to all users', 'success');
    input.value = '';
    loadBroadcastMessages();
  } catch (error) {
    log(`Error broadcasting message: ${error.message}`, 'error');
  }
}

async function deactivateBroadcastMessage(messageId) {
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'admin_broadcast_deactivate', message_id: messageId })
    });
    if (!response.ok) {
      const data = await response.json();
      log(`Failed to deactivate: ${data.error}`, 'error');
      return;
    }
    log('Message deactivated', 'success');
    loadBroadcastMessages();
  } catch (error) {
    log(`Error deactivating message: ${error.message}`, 'error');
  }
}

// ================= HISTORICAL GAMEWEEK SYNC =================
async function syncHistoricalGameweek() {
  const gw = parseInt(document.getElementById('syncGwInput').value, 10);
  if (!gw || gw < 1) { log('Enter a valid gameweek number', 'error'); return; }

  log(`Syncing real GW${gw} stats from FPL…`, 'info');
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'sync_historical_gameweek_stats', gameweek: gw })
    });
    const data = await response.json();
    if (!response.ok) {
      log(`Failed to sync GW${gw}: ${data.error}`, 'error');
      return;
    }
    log(`GW${gw} synced: ${data.players_synced} real player stat rows cached locally.`, 'success');
  } catch (error) {
    log(`Error syncing GW${gw}: ${error.message}`, 'error');
  }
}

async function syncAllHistoricalGameweeks() {
  log('Finding current gameweek…', 'info');
  let currentGw = 38;
  try {
    const gwResponse = await fetch('/api/current-gameweek');
    const gwData = await gwResponse.json();
    currentGw = gwData.current_gameweek || gwData.gameweek || 38;
  } catch (e) {
    log('Could not detect current gameweek, defaulting to 38', 'info');
  }

  if (!confirm(`Sync GW1 through GW${currentGw}? This makes ${currentGw} separate real API calls, one per gameweek.`)) return;

  for (let gw = 1; gw <= currentGw; gw++) {
    log(`Syncing GW${gw}…`, 'info');
    try {
      const token = localStorage.getItem('gbf_token');
      const response = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'sync_historical_gameweek_stats', gameweek: gw })
      });
      const data = await response.json();
      if (!response.ok) {
        log(`GW${gw} failed: ${data.error}`, 'error');
        continue;
      }
      log(`GW${gw}: ${data.players_synced} rows cached.`, 'success');
    } catch (error) {
      log(`GW${gw} error: ${error.message}`, 'error');
    }
  }
  log('Historical sync complete.', 'success');
}

async function clearGameweekStatsCache() {
  const gw = document.getElementById('syncGwInput').value;
  const scope = gw ? `GW${gw} only` : 'ALL gameweeks';
  if (!confirm(`Clear cached stats for ${scope}? Next time it's processed, it'll be re-fetched from the real FPL feed.`)) return;

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'clear_gameweek_stats_cache', gameweek: gw ? parseInt(gw, 10) : null })
    });
    const data = await response.json();
    if (!response.ok) {
      log(`Failed to clear cache: ${data.error}`, 'error');
      return;
    }
    log(`Cache cleared for ${scope}.`, 'success');
  } catch (error) {
    log(`Error clearing cache: ${error.message}`, 'error');
  }
}

// ================= ZERO-SUM AUDIT =================
async function loadAuditHistory() {
  const tournamentId = document.getElementById('auditTournamentId').value.trim();
  const results = document.getElementById('auditResults');
  if (!tournamentId) { results.innerHTML = 'Enter a tournament ID.'; return; }

  results.innerHTML = 'Loading…';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/tournaments?stockmarket_audit=true&tournament_id=${tournamentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) { results.innerHTML = `Failed: ${data.error}`; return; }

    const rows = data.audit;
    if (!rows) { results.innerHTML = 'No data returned.'; return; }

    const money = p => `£${((p || 0) / 100).toFixed(2)}`;
    const statusColor = rows.ok ? 'var(--accent-green)' : 'var(--accent-red)';
    results.innerHTML = `
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:0.75rem;">
        <div>Total entries (ever locked): <strong>${rows.total_entries}</strong></div>
        <div>Active now: <strong>${rows.active_entries}</strong></div>
        <div>Relegated: <strong>${rows.relegated_entries}</strong></div>
        <div>Cost multiplier: <strong>${rows.cost_multiplier}x</strong></div>
        <div>Expected pot: <strong>${money(rows.expected_pot)}</strong></div>
        <div>Actual active total: <strong>${money(rows.actual_active_total)}</strong></div>
      </div>
      <div style="padding:0.6rem; border-radius:0.5rem; background:rgba(0,0,0,0.2); color:${statusColor}; font-weight:700;">
        ${rows.ok ? '✓ Zero-sum holds' : '⚠ DRIFT DETECTED'} — drift ${money(rows.drift)}
      </div>
      <p class="text-muted" style="font-size:0.75rem; margin-top:0.6rem;">
        Relegated players' frozen historical total (not part of the live pot): ${money(rows.relegated_frozen_total_informational)}
      </p>`;
  } catch (error) {
    results.innerHTML = `Error: ${error.message}`;
  }
}

// ================= RELEGATION STAGES =================
let currentStagesData = [];

async function loadStockMarketTournamentList() {
  const select = document.getElementById('stagesTournamentSelect');
  const auditSelect = document.getElementById('auditTournamentSelect');
  try {
    const response = await fetch('/api/tournaments?tournament_type=stockmarket');
    const data = await response.json();
    const tournaments = data.tournaments || [];
    const optionsHtml = tournaments.length === 0
      ? '<option value="">No Stock Market tournaments found</option>'
      : '<option value="">-- choose a tournament --</option>' +
        tournaments.map(t => `<option value="${t.id}">${escapeHtmlAdmin(t.name || 'Untitled')} — ${t.status} (GW${t.gameweek ?? '?'})</option>`).join('');
    if (select) select.innerHTML = optionsHtml;
    if (auditSelect) auditSelect.innerHTML = optionsHtml;
  } catch (error) {
    if (select) select.innerHTML = '<option value="">Failed to load tournament list</option>';
    if (auditSelect) auditSelect.innerHTML = '<option value="">Failed to load tournament list</option>';
  }
}

function onAuditTournamentSelected() {
  const select = document.getElementById('auditTournamentSelect');
  if (!select.value) return;
  document.getElementById('auditTournamentId').value = select.value;
  loadAuditHistory();
}

function escapeHtmlAdmin(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function onStagesTournamentSelected() {
  const select = document.getElementById('stagesTournamentSelect');
  if (!select.value) return;
  document.getElementById('stagesTournamentId').value = select.value;
  loadRelegationStages();
}

async function loadRelegationStages() {
  const tournamentId = document.getElementById('stagesTournamentId').value.trim();
  const wrap = document.getElementById('stagesTableWrap');
  if (!tournamentId) { wrap.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">Enter a tournament ID.</p>'; return; }

  wrap.innerHTML = '<p class="text-muted" style="font-size:0.85rem;">Loading…</p>';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/tournaments?stockmarket_stages=true&tournament_id=${tournamentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) { wrap.innerHTML = `Failed: ${data.error}`; return; }
    currentStagesData = data.stages || [];
    renderRelegationStages();
    document.getElementById('saveStagesBtn').disabled = false;
  } catch (error) {
    wrap.innerHTML = `Error: ${error.message}`;
  }
}

function renderRelegationStages() {
  const wrap = document.getElementById('stagesTableWrap');
  wrap.innerHTML = `
    <table style="width:100%; border-collapse:collapse; font-size:0.85rem; min-width:560px;">
      <tr style="text-align:left; border-bottom:1px solid var(--border-color);">
        <th style="padding:6px 4px;">Stage</th>
        <th style="padding:6px 4px;">Trigger GW</th>
        <th style="padding:6px 4px;">Relegate Count</th>
        <th style="padding:6px 4px;">Cost Multiplier</th>
        <th style="padding:6px 4px;">Status</th>
      </tr>
      ${currentStagesData.map(s => `
        <tr style="border-bottom:1px solid var(--border-color); ${s.applied ? 'opacity:0.55;' : ''}">
          <td style="padding:6px 4px; font-weight:700;">${s.stage_number}</td>
          <td style="padding:6px 4px;">
            <input type="number" min="1" max="38" data-stage="${s.stage_number}" data-field="trigger_gameweek"
              value="${s.trigger_gameweek ?? ''}" ${s.applied ? 'disabled' : ''}
              style="width:80px; padding:0.4rem; border-radius:0.4rem; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-primary);">
          </td>
          <td style="padding:6px 4px;">
            <input type="number" min="0" data-stage="${s.stage_number}" data-field="relegate_count"
              value="${s.relegate_count ?? 0}" ${s.applied ? 'disabled' : ''}
              style="width:90px; padding:0.4rem; border-radius:0.4rem; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-primary);">
          </td>
          <td style="padding:6px 4px;">
            <input type="number" min="0.01" step="0.01" data-stage="${s.stage_number}" data-field="cost_multiplier"
              value="${s.cost_multiplier ?? 1}" ${s.applied ? 'disabled' : ''}
              style="width:90px; padding:0.4rem; border-radius:0.4rem; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-primary);">
          </td>
          <td style="padding:6px 4px;">
            ${s.applied ? '<span style="color:var(--accent-red);">Applied</span>' : (s.trigger_gameweek ? '<span style="color:var(--accent-green);">Scheduled</span>' : '<span class="text-muted">Unused</span>')}
          </td>
        </tr>`).join('')}
    </table>`;
}

async function saveRelegationStages() {
  const tournamentId = document.getElementById('stagesTournamentId').value.trim();
  const resultEl = document.getElementById('stagesSaveResult');
  if (!tournamentId) return;

  const stages = currentStagesData
    .filter(s => !s.applied)
    .map(s => {
      const row = document.querySelector(`input[data-stage="${s.stage_number}"][data-field="trigger_gameweek"]`).closest('tr');
      const get = (field) => row.querySelector(`input[data-field="${field}"]`).value;
      return {
        stage_number: s.stage_number,
        trigger_gameweek: get('trigger_gameweek'),
        relegate_count: get('relegate_count'),
        cost_multiplier: get('cost_multiplier')
      };
    });

  resultEl.textContent = 'Saving…';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'stockmarket_save_stages', tournament_id: tournamentId, stages })
    });
    const data = await response.json();
    if (!response.ok) { resultEl.innerHTML = `<span style="color:var(--accent-red);">Failed: ${data.error}</span>`; return; }
    resultEl.innerHTML = '<span style="color:var(--accent-green);">Saved.</span>';
    await loadRelegationStages();
  } catch (error) {
    resultEl.innerHTML = `<span style="color:var(--accent-red);">Error: ${error.message}</span>`;
  }
}

async function launchTournament() {
  if (!confirm('Launch new tournament? This will:\n1. Sync current GW fixtures from FPL\n2. Create £20 entry tournament\n3. Open for user registrations')) {
    return;
  }
  
  log('Launching tournament...', 'info');
  
  try {
    const token = localStorage.getItem('gbf_token');
    
    // Get current gameweek first
    log('Getting current gameweek...');
    const gwResponse = await fetch('/api/current-gameweek');
    const gwData = await gwResponse.json();
    const currentGameweek = gwData.current_gameweek || 35;
    log(`Current gameweek: ${currentGameweek}`);
    
    // Step 1: Sync fixtures
    log('Syncing fixtures from FPL API...');
    const syncResponse = await fetch('/api/sync-fixtures', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    log(`Sync response status: ${syncResponse.status}`);
    
    if (!syncResponse.ok) {
      const errorText = await syncResponse.text();
      log(`Sync error: ${errorText}`, 'error');
      throw new Error('Failed to sync fixtures: ' + syncResponse.status);
    }
    
    const syncData = await syncResponse.json();
    log(`Synced ${syncData.matches?.length || 0} matches`, 'success');
    
    // Step 2: Create tournament
    log('Creating tournament...');
    const tournamentName = document.getElementById('tournament-name-input')?.value || `GW${currentGameweek} Tournament`;
    const entryFee = parseInt(document.getElementById('tournament-fee-input')?.value) || 20;
    const startGameweek = parseInt(document.getElementById('tournament-start-gw')?.value) || currentGameweek;
    const endGameweek = parseInt(document.getElementById('tournament-end-gw')?.value) || currentGameweek;
    
    const tournamentResponse = await fetch('/api/tournaments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'create',
        name: tournamentName,
        entry_fee: entryFee,
        prize_pool: 0,
        gameweek: startGameweek,
        end_gameweek: endGameweek,
        max_entries: 100,
        closes_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
      })
    });
    
    if (!tournamentResponse.ok) {
      const errorData = await tournamentResponse.json();
      log(`Tournament error: ${JSON.stringify(errorData)}`, 'error');
      throw new Error(errorData.details || errorData.error || 'Failed to create tournament');
    }
    
    const tournamentData = await tournamentResponse.json();
    log(`Tournament created: ${tournamentData.tournament?.name}`, 'success');
    
    log('Tournament launched successfully!', 'success');
    alert('Tournament launched! Users can now register and enter.');
    
    refreshStatus();
    
  } catch (error) {
    console.error('Launch tournament error:', error);
    log(`Error: ${error.message}`, 'error');
    alert('Failed to launch tournament: ' + error.message);
  }
}

async function syncEverything() {
  log('=== Sync Everything: starting ===');
  const token = localStorage.getItem('gbf_token');

  // 1. Players (teams + players, full FPL bulk sync)
  try {
    log('Syncing players and teams…');
    const res = await fetch('/api/sync-players');
    const data = await res.json();
    log(`Players: ${data.results?.teams_synced || 0} teams, ${data.results?.players_synced || 0} players synced`, 'success');
    if (data.results?.errors?.length > 0) {
      log(`Players sync had ${data.results.errors.length} errors`, 'error');
    }
  } catch (error) {
    log(`Players sync failed: ${error.message}`, 'error');
  }

  // 2. Fixtures (all gameweeks)
  try {
    log('Syncing fixtures…');
    const res = await fetch('/api/sync-fixtures', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    const total = (data.created || 0) + (data.updated || 0);
    log(`Fixtures: ${total} matches synced (${data.created || 0} new, ${data.updated || 0} updated)`, 'success');
  } catch (error) {
    log(`Fixtures sync failed: ${error.message}`, 'error');
  }

  // 3. Live scores (updates match status/results, triggers points calc)
  try {
    log('Updating live scores…');
    const res = await fetch('/api/live-scores', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    log(`Live scores: ${data.message || 'updated'}`, 'success');
  } catch (error) {
    log(`Live scores update failed: ${error.message}`, 'error');
  }

  log('=== Sync Everything: complete ===', 'success');
  refreshStatus();
}

async function syncFixtures() {
  const gwSelect = document.getElementById('sync-gw-select');
  const gameweek = gwSelect ? gwSelect.value : '';
  
  log(`Syncing fixtures${gameweek ? ` for GW ${gameweek}` : ''}...`);
  
  try {
    const token = localStorage.getItem('gbf_token');
    const url = gameweek ? `/api/sync-fixtures?gameweek=${gameweek}` : '/api/sync-fixtures';
    
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      throw new Error('Sync failed');
    }
    
    const data = await response.json();
    const total = (data.created || 0) + (data.updated || 0);
    log(`Synced ${total} matches (${data.created || 0} new, ${data.updated || 0} updated)`, 'success');
    if (data.errors && data.errors.length > 0) {
      log(`${data.errors.length} fixtures had errors — check server logs`, 'error');
    }
    refreshStatus();
    
  } catch (error) {
    log(`Sync error: ${error.message}`, 'error');
  }
}

async function refreshLiveMatches() {
  const container = document.getElementById('live-matches');
  container.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading...';

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/live-scores', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();

    if (!response.ok) {
      container.innerHTML = `<span style="color:var(--accent-red);">Error: ${data.error || 'Failed to load'}</span>`;
      return;
    }

    const results = data.results;
    if (!results) {
      container.innerHTML = `<span class="text-muted">${data.message || 'No data returned'}</span>`;
      return;
    }

    const liveMatches = results.live || [];
    let html = `<p class="text-muted mb-2">GW${data.gameweek} — ${results.finished || 0} finished, ${liveMatches.length} live, ${results.updated || 0} updated</p>`;

    if (liveMatches.length > 0) {
      html += liveMatches.map(m => `
        <div style="display:flex; justify-content:space-between; padding:0.5rem 0; border-bottom:1px solid var(--border-color);">
          <span>${m.home_team} vs ${m.away_team}</span>
          <span><strong>${m.home} - ${m.away}</strong> (${m.minute}')</span>
        </div>
      `).join('');
    } else {
      html += '<p class="text-muted">No matches currently live.</p>';
    }

    if (results.errors && results.errors.length > 0) {
      html += `<p style="color:var(--accent-amber); font-size:0.8rem; margin-top:0.5rem;">${results.errors.length} warning(s) — check activity log for sync issues.</p>`;
    }

    container.innerHTML = html;
    log(`Live matches refreshed: ${results.finished || 0} finished, ${liveMatches.length} live`, 'success');
  } catch (error) {
    container.innerHTML = `<span style="color:var(--accent-red);">Error: ${error.message}</span>`;
    log(`Live matches refresh error: ${error.message}`, 'error');
  }
}

async function syncLiveScores() {
  log('Updating live scores...');
  
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/live-scores', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      throw new Error('Failed to update scores');
    }
    
    const data = await response.json();
    log(`Updated ${data.updated?.length || 0} matches`, 'success');
    
  } catch (error) {
    log(`Live scores error: ${error.message}`, 'error');
  }
}

async function finalisePoints() {
  if (!confirm('Finalise all points for current gameweek and advance to next?')) return;
  
  log('Finalising points...');
  
  try {
    const token = localStorage.getItem('gbf_token');
    
    // Call the finalise endpoint with manual=true to force advancement
    const response = await fetch('/api/gameweek-transition?manual=true', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to finalise points');
    }
    
    const data = await response.json();
    log(`Points finalised for GW${data.finalised_gameweek}: ${data.actions?.join(', ')}`, 'success');
    log(`System advanced to GW${data.new_current_gameweek}`, 'success');
    
    // Refresh the status display
    await refreshStatus();
    
  } catch (error) {
    log(`Finalise error: ${error.message}`, 'error');
  }
}

// Master Clock Functions
async function initMasterClock() {
  const select = document.getElementById('master-gw-select');
  const gameweek = select.value;
  
  if (!gameweek) {
    log('Please select a gameweek', 'warn');
    return;
  }
  
  if (!confirm(`Initialize Master Clock to GW${gameweek}?\n\nThis sets the current gameweek for the entire system.`)) return;
  
  log(`Initializing Master Clock to GW${gameweek}...`);
  
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/current-gameweek', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'init',
        gameweek: parseInt(gameweek)
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to init Master Clock');
    }
    
    const data = await response.json();
    log(`Master Clock initialized: ${data.message}`, 'success');
    
    await refreshStatus();
    
  } catch (error) {
    log(`Error initializing Master Clock: ${error.message}`, 'error');
  }
}

// Manual Gameweek Override Functions (deprecated - use Master Clock)
async function setManualGW() {
  log('Use "Initialize Master Clock" instead', 'warn');
}

async function clearManualGW() {
  log('Use "Initialize Master Clock" instead', 'warn');
}

function log(message, type = 'info') {
  const logOutput = document.getElementById('log-output');
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logOutput.appendChild(entry);
  logOutput.scrollTop = logOutput.scrollHeight;
}

function clearLog() {
  document.getElementById('log-output').innerHTML = '<div class="log-entry">Log cleared.</div>';
}

// Manual Score Entry Functions
async function loadMatchesForScoreEntry() {
  const gwSelect = document.getElementById('manual-score-gw');
  const matchSelect = document.getElementById('manual-score-match');
  const gameweek = gwSelect.value;
  
  if (!gameweek) {
    matchSelect.innerHTML = '<option value="">Select gameweek first...</option>';
    return;
  }
  
  matchSelect.innerHTML = '<option value="">Loading matches...</option>';
  
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/admin-stats?action=matches&gameweek=${gameweek}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    
    if (!response.ok) throw new Error('Failed to load matches');
    
    const data = await response.json();
    const matches = data.matches || [];
    
    if (matches.length === 0) {
      matchSelect.innerHTML = '<option value="">No matches found for this GW</option>';
      return;
    }
    
    matchSelect.innerHTML = matches.map(m => {
      const statusIcon = m.status === 'finished' ? '✓' : m.status === 'live' ? '●' : '○';
      const score = m.home_score !== null ? ` (${m.home_score}-${m.away_score})` : '';
      return `<option value="${m.id}" data-home="${m.home_team}" data-away="${m.away_team}">${statusIcon} ${m.home_team} vs ${m.away_team}${score}</option>`;
    }).join('');
    
    log(`Loaded ${matches.length} matches for GW ${gameweek}`);
    
  } catch (error) {
    matchSelect.innerHTML = '<option value="">Error loading matches</option>';
    log(`Error loading matches: ${error.message}`, 'error');
  }
}

async function submitManualScore() {
  const matchSelect = document.getElementById('manual-score-match');
  const homeScore = document.getElementById('manual-score-home').value;
  const awayScore = document.getElementById('manual-score-away').value;
  const status = document.getElementById('manual-score-status').value;
  const resultDiv = document.getElementById('manual-score-result');
  
  const matchId = matchSelect.value;
  
  if (!matchId) {
    resultDiv.innerHTML = '<span class="text-red">Please select a match</span>';
    return;
  }
  
  const selectedOption = matchSelect.options[matchSelect.selectedIndex];
  const homeTeam = selectedOption.dataset.home;
  const awayTeam = selectedOption.dataset.away;
  
  // Calculate result
  const result = parseInt(homeScore) > parseInt(awayScore) ? 'H' :
                 parseInt(awayScore) > parseInt(homeScore) ? 'A' : 'D';
  
  resultDiv.innerHTML = '<span class="text-amber">Saving...</span>';
  
  try {
    const token = localStorage.getItem('gbf_token');
    
    log(`Setting score: ${homeTeam} ${homeScore}-${awayScore} ${awayTeam} (${status})`);
    
    // Call admin-stats API with set-score action
    const response = await fetch('/api/admin-stats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'set-score',
        match_id: matchId,
        home_score: parseInt(homeScore),
        away_score: parseInt(awayScore),
        result: result,
        status: status
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to save score');
    }
    
    const data = await response.json();
    
    resultDiv.innerHTML = `<span class="text-green">✅ Score saved! ${data.predictions_updated || 0} predictions updated, ${data.users_updated || 0} users updated</span>`;
    log(`Score saved successfully. ${data.predictions_updated} predictions scored.`, 'success');
    
    // Refresh the match list to show updated score
    loadMatchesForScoreEntry();
    
  } catch (error) {
    resultDiv.innerHTML = `<span class="text-red">❌ Error: ${error.message}</span>`;
    log(`Score save error: ${error.message}`, 'error');
  }
}

async function recalculateTournamentPoints() {
  const resultDiv = document.getElementById('recalc-result');
  resultDiv.innerHTML = '<span class="text-amber"><i class="fas fa-spinner fa-spin"></i> Recalculating tournament points... This may take a moment.</span>';
  log('Starting tournament points recalculation...', 'info');
  
  try {
    const token = localStorage.getItem('gbf_token');
    
    const response = await fetch('/api/admin-stats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        action: 'recalculate-tournament-points'
      })
    });
    
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to recalculate');
    }
    
    const data = await response.json();
    
    resultDiv.innerHTML = `<span class="text-green">✅ Recalculation complete! ${data.results.tournaments_processed} tournaments processed, ${data.results.entries_updated} entries updated</span>`;
    log(`Tournament points recalculated. ${data.results.entries_updated} entries updated.`, 'success');
    
  } catch (error) {
    resultDiv.innerHTML = `<span class="text-red">❌ Error: ${error.message}</span>`;
    log(`Recalculation error: ${error.message}`, 'error');
  }
}
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
    loadMissingPhotoPlayers();
    populateGenTestGwDropdown();
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
    loadMissingPhotoPlayers();
    populateGenTestGwDropdown();
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
    loadWalletList();
    loadPollingStatus();
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
  if (!confirm(`Advance from ${currentText}? This settles Predictions, Stock Market, LMS, and Fantasy for the current gameweek (if all its matches are finished) and moves the clock forward.`)) return;

  log(`Advancing gameweek...`);
  try {
    const token = localStorage.getItem('gbf_token');
    // Calls the same real action Stock Market's own "Advance Gameweek"
    // button uses — the old /api/gameweek-transition endpoint this used
    // to call only ever handled Predictions (and deleted its rows after
    // archiving them), silently skipping Stock Market, LMS, and Fantasy
    // entirely. Two different buttons with two different real behaviors
    // is exactly the kind of trap that caused real confusion, so this is
    // intentionally now just calling the one true version instead of a
    // second, incomplete one living beside it.
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'stockmarket_advance_gameweek' })
    });
    const data = await response.json();
    if (!response.ok) {
      log(`Failed to advance: ${data.error}`, 'error');
      return;
    }
    const settledMsg = `Stock Market settled: ${data.stock_market_tournaments_settled || 0}, LMS settled: ${data.lms_tournaments_settled || 0}, Fantasy players updated: ${data.fantasy_players_updated || 0}.`;
    log(`Advanced to GW${data.new_gameweek}. ${settledMsg}`, 'success');
    refreshStatus();
  } catch (error) {
    log(`Error advancing gameweek: ${error.message}`, 'error');
  }
}

// ================= PAYMENTS & BOOKKEEPING (WALLET) =================
const PAYMENT_AMOUNTS = [1000, 2000, 3000, 4000, 5000, 6000]; // pence: £10..£60
let walletListCache = [];

function escapeHtmlWallet(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function moneyWallet(pence) {
  const pounds = Math.abs(pence || 0) / 100;
  return `£${pounds.toFixed(2)}`;
}

async function loadWalletList() {
  const body = document.getElementById('walletListBody');
  if (!body) return; // panel not on this page
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments?admin_wallet_list=true', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      body.innerHTML = `<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">Failed to load: ${escapeHtmlWallet(data.error)}</td></tr>`;
      return;
    }
    walletListCache = data.users || [];
    renderWalletList();
  } catch (error) {
    console.error('loadWalletList error:', error);
    body.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">Failed to load wallet list.</td></tr>';
  }
}

function renderWalletList() {
  const body = document.getElementById('walletListBody');
  if (!body) return;
  const searchInput = document.getElementById('walletSearchInput');
  const search = (searchInput ? searchInput.value : '').trim().toLowerCase();

  let list = walletListCache;
  if (search) {
    list = list.filter(u =>
      (u.username || '').toLowerCase().includes(search) ||
      (u.display_name || '').toLowerCase().includes(search)
    );
  }
  // Owing users first, highest owed at the top — the people you're
  // actually waiting to hear from, not buried alphabetically.
  list = [...list].sort((a, b) => (b.owed || 0) - (a.owed || 0));

  if (list.length === 0) {
    body.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">No users found.</td></tr>';
    return;
  }

  body.innerHTML = list.map(u => {
    const owed = u.owed || 0;
    const selectId = `walletAmount_${u.id}`;
    const detailRowId = `walletDetail_${u.id}`;
    const isExpanded = walletExpandedUserId === u.id;
    const optionsHtml = PAYMENT_AMOUNTS.map(p => `<option value="${p}">£${(p / 100).toFixed(0)}</option>`).join('');
    const detailRowHtml = isExpanded ? `
      <tr id="${detailRowId}" style="border-bottom:1px solid var(--border-color); background:var(--bg-hover);">
        <td colspan="4" style="padding:0.75rem 0.5rem;">
          <div id="walletDetailBody_${u.id}" style="font-size:0.85rem;">Loading…</div>
        </td>
      </tr>` : '';
    return `
      <tr style="border-bottom:1px solid var(--border-color);">
        <td style="padding:0.5rem;">
          <button onclick="toggleWalletDetail('${u.id}')" style="background:none; border:none; cursor:pointer; color:inherit; font:inherit; text-align:left; display:flex; align-items:center; gap:0.4rem;">
            <i class="fas fa-chevron-${isExpanded ? 'down' : 'right'}" style="font-size:0.7rem; color:var(--text-muted, #8a97b0);"></i>
            ${escapeHtmlWallet(u.display_name || u.username || u.email || u.id)}
          </button>
        </td>
        <td style="padding:0.5rem; font-weight:700; color:${owed > 0 ? 'var(--red)' : owed < 0 ? 'var(--green)' : 'var(--text-muted, #8a97b0)'};">
          ${owed > 0 ? moneyWallet(owed) : owed < 0 ? `${moneyWallet(owed)} in credit` : '£0.00'}
        </td>
        <td style="padding:0.5rem;">
          <select id="${selectId}" style="padding:0.4rem; border-radius:0.4rem; border:1px solid var(--border-color); background:var(--bg-hover); color:var(--text-primary);">
            ${optionsHtml}
          </select>
        </td>
        <td style="padding:0.5rem;">
          <button class="btn btn-sm btn-green" onclick="recordWalletPayment('${u.id}', '${selectId}')">
            <i class="fas fa-check"></i> Paid
          </button>
        </td>
      </tr>${detailRowHtml}`;
  }).join('');

  if (walletExpandedUserId) loadWalletDetail(walletExpandedUserId);
}

let walletExpandedUserId = null;
const walletDetailCache = {};

function toggleWalletDetail(userId) {
  walletExpandedUserId = walletExpandedUserId === userId ? null : userId;
  renderWalletList();
}

async function loadWalletDetail(userId) {
  const el = document.getElementById(`walletDetailBody_${userId}`);
  if (!el) return;

  if (walletDetailCache[userId]) {
    renderWalletDetail(userId, walletDetailCache[userId]);
    return;
  }

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/tournaments?admin_wallet_detail=true&user_id=${userId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      el.innerHTML = `<span class="text-muted">Failed to load: ${escapeHtmlWallet(data.error)}</span>`;
      return;
    }
    walletDetailCache[userId] = data.transactions || [];
    renderWalletDetail(userId, walletDetailCache[userId]);
  } catch (error) {
    console.error('loadWalletDetail error:', error);
    el.innerHTML = '<span class="text-muted">Failed to load transaction history.</span>';
  }
}

function renderWalletDetail(userId, transactions) {
  const el = document.getElementById(`walletDetailBody_${userId}`);
  if (!el) return;

  if (transactions.length === 0) {
    el.innerHTML = '<span class="text-muted">No transactions yet.</span>';
    return;
  }

  el.innerHTML = `
    <table style="width:100%; border-collapse:collapse;">
      <thead>
        <tr style="text-align:left; color:var(--text-muted, #8a97b0); font-size:0.75rem; text-transform:uppercase; letter-spacing:0.03em;">
          <th style="padding:0.3rem 0.5rem;">Date</th>
          <th style="padding:0.3rem 0.5rem;">Type</th>
          <th style="padding:0.3rem 0.5rem;">Description</th>
          <th style="padding:0.3rem 0.5rem;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${transactions.map(t => {
          const isDebit = t.amount > 0;
          const dateStr = new Date(t.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
          return `
            <tr style="border-top:1px solid var(--border-color);">
              <td style="padding:0.4rem 0.5rem; white-space:nowrap;">${dateStr}</td>
              <td style="padding:0.4rem 0.5rem; text-transform:capitalize;">${escapeHtmlWallet(t.type)}</td>
              <td style="padding:0.4rem 0.5rem;">${escapeHtmlWallet(t.description || '')}</td>
              <td style="padding:0.4rem 0.5rem; font-weight:700; color:${isDebit ? 'var(--red)' : 'var(--green)'}; white-space:nowrap;">
                ${isDebit ? '+' : '−'}${moneyWallet(t.amount)}
              </td>
            </tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

async function recordWalletPayment(userId, selectId) {
  const select = document.getElementById(selectId);
  const amount = parseInt(select.value, 10);
  if (!confirm(`Record a payment of £${(amount / 100).toFixed(2)} for this user? This reduces what they owe — only do this after you've actually received the money.`)) return;

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'admin_record_payment', user_id: userId, amount })
    });
    const data = await response.json();
    if (!response.ok) {
      log(`Failed to record payment: ${data.error}`, 'error');
      return;
    }
    log(`Payment of £${(amount / 100).toFixed(2)} recorded`, 'success');
    delete walletDetailCache[userId];
    loadWalletList();
  } catch (error) {
    log(`Error recording payment: ${error.message}`, 'error');
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

// ================= PLAYER PHOTO VERIFICATION =================
let lastPhotoVerifyMissing = [];

function buildMissingByTeamHtml(missing) {
  const byTeam = {};
  missing.forEach(m => {
    if (!byTeam[m.team]) byTeam[m.team] = [];
    byTeam[m.team].push(m.web_name);
  });
  const teams = Object.keys(byTeam).sort();
  if (teams.length === 0) return '';
  return `<div style="margin-top:0.5rem; max-height:260px; overflow-y:auto; font-size:0.8rem;">
    ${teams.map(t => `<div style="margin-bottom:0.4rem;"><strong>${t}</strong> (${byTeam[t].length}): ${byTeam[t].join(', ')}</div>`).join('')}
  </div>`;
}

function missingToCsv(missing) {
  const rows = [['Team', 'Player'], ...missing.map(m => [m.team, m.web_name])];
  return rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

function downloadPhotoVerifyCsv() {
  if (!lastPhotoVerifyMissing.length) return;
  const csv = missingToCsv(lastPhotoVerifyMissing);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'missing-player-photos.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function copyPhotoVerifyCsv() {
  if (!lastPhotoVerifyMissing.length) return;
  const csv = missingToCsv(lastPhotoVerifyMissing);
  try {
    await navigator.clipboard.writeText(csv);
    const btn = document.getElementById('photoVerifyCopyBtn');
    if (btn) { const old = btn.innerHTML; btn.innerHTML = '<i class="fas fa-check"></i> Copied!'; setTimeout(() => btn.innerHTML = old, 1500); }
  } catch (e) {
    alert('Could not copy — your browser may be blocking clipboard access. Use Download CSV instead.');
  }
}

async function runPhotoVerification() {
  const btn = document.getElementById('photoVerifyBtn');
  const resultsEl = document.getElementById('photoVerifyResults');
  const token = localStorage.getItem('gbf_token');
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Running…';

  let offset = 0;
  let total = null;
  const allMissing = [];

  try {
    while (true) {
      const response = await fetch(`/api/tournaments?verify_player_photos=true&offset=${offset}&batch_size=25`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      if (!response.ok) {
        resultsEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Failed: ${data.error || 'unknown error'}</span>`;
        break;
      }

      total = data.total;
      allMissing.push(...(data.missing_this_batch || []));
      lastPhotoVerifyMissing = allMissing;
      resultsEl.innerHTML = `
        Checked ${Math.min(data.next_offset, total)} of ${total}…<br>
        <span style="color:var(--accent-red,#ef4444);">${allMissing.length} confirmed missing so far</span>
        ${buildMissingByTeamHtml(allMissing)}`;

      if (data.done) {
        resultsEl.innerHTML = `
          <strong>✓ Done — checked ${total} players.</strong><br>
          <span style="color:var(--accent-red,#ef4444);">${allMissing.length} confirmed missing a real photo (now excluded from packs going forward).</span>
          ${buildMissingByTeamHtml(allMissing)}
          ${allMissing.length ? `<div style="margin-top:0.75rem; display:flex; gap:0.5rem;">
            <button class="btn btn-primary" onclick="downloadPhotoVerifyCsv()"><i class="fas fa-download"></i> Download CSV</button>
            <button class="btn btn-primary" id="photoVerifyCopyBtn" onclick="copyPhotoVerifyCsv()"><i class="fas fa-copy"></i> Copy CSV</button>
          </div>` : ''}`;
        break;
      }
      offset = data.next_offset;
    }
  } catch (e) {
    resultsEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Error: ${e.message}</span>`;
  }

  btn.disabled = false;
  btn.innerHTML = '<i class="fas fa-play"></i> Run Verification';
}

let missingPhotoPlayersList = [];

function populateGenTestGwDropdown() {
  const select = document.getElementById('genTestGwSelect');
  if (!select || select.options.length > 1) return;
  for (let gw = 1; gw <= 38; gw++) {
    const opt = document.createElement('option');
    opt.value = gw;
    opt.textContent = `Gameweek ${gw}`;
    select.appendChild(opt);
  }
}

// ================= PAUSE LIVE POLLING =================
async function loadPollingStatus() {
  const label = document.getElementById('pollingStatusLabel');
  const btn = document.getElementById('pollingToggleBtn');
  if (!label || !btn) return;
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments?admin_polling_status=true', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) return;
    pollingPausedState = !!data.polling_paused;
    updatePollingStatusUI(pollingPausedState);
  } catch (error) {
    console.error('loadPollingStatus error:', error);
  }
}

function updatePollingStatusUI(paused) {
  const label = document.getElementById('pollingStatusLabel');
  const btn = document.getElementById('pollingToggleBtn');
  if (!label || !btn) return;
  if (paused) {
    label.textContent = 'PAUSED — real FPL data is not being fetched';
    label.style.color = 'var(--red)';
    btn.textContent = 'Resume Live Polling';
    btn.className = 'btn btn-green';
  } else {
    label.textContent = 'LIVE — real FPL data is being fetched normally';
    label.style.color = 'var(--green)';
    btn.textContent = 'Pause Live Polling';
    btn.className = 'btn';
    btn.style.background = 'var(--accent-red, #ef4444)';
    btn.style.color = '#fff';
  }
}

let pollingPausedState = false;
async function togglePollingPaused() {
  const newState = !pollingPausedState;
  if (newState && !confirm('Pause live polling? Real FPL data will stop syncing for everyone until you resume it here.')) return;
  if (!newState && !confirm('Resume live polling? Any simulated test data will start getting overwritten by real FPL data once matches are live.')) return;

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'admin_set_polling_paused', paused: newState })
    });
    const data = await response.json();
    if (!response.ok) { log(`Failed to toggle polling: ${data.error}`, 'error'); return; }
    pollingPausedState = data.polling_paused;
    updatePollingStatusUI(pollingPausedState);
    log(pollingPausedState ? 'Live polling paused' : 'Live polling resumed', 'success');
  } catch (error) {
    log(`Error toggling polling: ${error.message}`, 'error');
  }
}

// ================= SIMULATE MATCH =================
async function loadTournamentDataCounts() {
  const type = document.getElementById('tournamentTypeSelect').value;
  const body = document.getElementById('tournamentDataCountsBody');
  body.innerHTML = '<tr><td colspan="2" class="text-muted" style="padding:0.75rem;">Loading…</td></tr>';

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/tournaments?admin_tournament_data_counts=${type}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      body.innerHTML = `<tr><td colspan="2" class="text-muted" style="padding:0.75rem;">Failed: ${data.error}</td></tr>`;
      return;
    }

    const rows = Object.entries(data.counts || {});
    body.innerHTML = rows.map(([table, count]) => {
      const isEmpty = count === 0;
      const color = typeof count === 'string' ? 'var(--red)' : (isEmpty ? 'var(--text-muted, #8a97b0)' : 'var(--gold)');
      return `
        <tr style="border-bottom:1px solid var(--border-color);">
          <td style="padding:0.5rem;">${type}.${table}</td>
          <td style="padding:0.5rem; color:${color}; font-weight:700;">${count}</td>
        </tr>`;
    }).join('');
  } catch (error) {
    body.innerHTML = `<tr><td colspan="2" class="text-muted" style="padding:0.75rem;">Error: ${error.message}</td></tr>`;
  }
}

async function deleteTournamentData() {
  const type = document.getElementById('tournamentTypeSelect').value;
  const typeLabels = { predictions: 'Predictions', lms: 'Last Man Standing', stockmarket: 'Stock Market', fantasy: 'Fantasy Manager' };
  const typed = prompt(`This permanently deletes ALL ${typeLabels[type]} data — every entry, pick/squad, and history row. This cannot be undone.\n\nType DELETE to confirm:`);
  if (typed !== 'DELETE') { if (typed !== null) alert('Typed text did not match — nothing was deleted.'); return; }

  const body = document.getElementById('tournamentDataCountsBody');
  body.innerHTML = '<tr><td colspan="2" class="text-muted" style="padding:0.75rem;">Deleting…</td></tr>';

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'admin_wipe_tournament_schema', tournament_type: type })
    });
    const data = await response.json();
    if (!response.ok) { log(`Failed to delete: ${data.error}`, 'error'); return; }

    // Show exactly what the delete call itself reported per table, right
    // here — don't make it wait on a second Show Data click to find out
    // if something actually failed.
    const rows = Object.entries(data.deleted || {});
    body.innerHTML = rows.map(([table, result]) => {
      const isError = typeof result === 'string';
      return `
        <tr style="border-bottom:1px solid var(--border-color);">
          <td style="padding:0.5rem;">${type}.${table}</td>
          <td style="padding:0.5rem; color:${isError ? 'var(--red)' : 'var(--green)'}; font-weight:700;">${isError ? result : `${result} deleted`}</td>
        </tr>`;
    }).join('');

    log(`${typeLabels[type]} delete finished — check the table above for any per-table errors`, 'success');
  } catch (error) {
    log(`Error deleting data: ${error.message}`, 'error');
  }
}

let adminTestUserIds = [];

async function adminCreateTestAccounts() {
  const msgEl = document.getElementById('seedEntriesResultMsg');
  msgEl.textContent = 'Creating 30 test accounts…';
  try {
    adminTestUserIds = await adminEnsureTestUsers();
    msgEl.textContent = `${adminTestUserIds.length} test accounts ready. Now pick a gameweek and seed Predictions/LMS/Fantasy.`;
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  }
}

// stockmarket_create_test_users is idempotent — it returns the existing
// 30 accounts' ids if they're already there, rather than duplicating
// them. Calling it silently whenever the seed buttons need the list
// (instead of only relying on the in-memory adminTestUserIds array)
// means a page reload between "Create" and "Seed" doesn't silently block
// with an easy-to-miss alert() — it just quietly re-fetches instead.
async function adminEnsureTestUsers() {
  if (adminTestUserIds.length > 0) return adminTestUserIds;
  const token = localStorage.getItem('gbf_token');
  const response = await fetch('/api/tournaments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ action: 'stockmarket_create_test_users', count: 30 })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Failed to fetch test accounts');
  adminTestUserIds = data.user_ids || [];
  return adminTestUserIds;
}

async function adminGetLiveTournamentId(tournamentType) {
  const token = localStorage.getItem('gbf_token');
  const response = await fetch(`/api/tournaments?status=live&tournament_type=${tournamentType}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await response.json();
  const list = data.tournaments || data || [];
  return Array.isArray(list) && list.length > 0 ? list[0].id : null;
}

async function adminSeedPredictionsEntries() {
  const msgEl = document.getElementById('seedEntriesResultMsg');
  await adminEnsureTestUsers();
  const gw = parseInt(document.getElementById('seedEntriesGw').value);
  msgEl.textContent = 'Finding live Predictions tournament…';

  try {
    const tournamentId = await adminGetLiveTournamentId('predictions');
    if (!tournamentId) { msgEl.textContent = 'No live Predictions tournament found — launch one first.'; return; }

    msgEl.textContent = `Seeding GW${gw} predictions for ${adminTestUserIds.length} test accounts…`;
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'predictions_seed_entries', tournament_id: tournamentId, user_ids: adminTestUserIds, gameweek: gw })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }
    msgEl.textContent = `Seeded ${data.seeded} accounts with predictions across ${data.matches} GW${gw} matches.`;
    log('Predictions entries seeded', 'success');
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  }
}

async function adminSeedLmsEntries() {
  const msgEl = document.getElementById('seedEntriesResultMsg');
  await adminEnsureTestUsers();
  const gw = parseInt(document.getElementById('seedEntriesGw').value);
  msgEl.textContent = 'Finding live LMS tournament…';

  try {
    const tournamentId = await adminGetLiveTournamentId('lms');
    if (!tournamentId) { msgEl.textContent = 'No live LMS tournament found — launch one first.'; return; }

    msgEl.textContent = `Seeding GW${gw} picks for ${adminTestUserIds.length} test accounts…`;
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'lms_seed_entries', tournament_id: tournamentId, user_ids: adminTestUserIds, gameweek: gw })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }
    msgEl.textContent = `Seeded ${data.seeded} accounts with GW${gw} picks.`;
    log('LMS entries seeded', 'success');
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  }
}

async function adminSeedFantasyEntries() {
  const msgEl = document.getElementById('seedEntriesResultMsg');
  await adminEnsureTestUsers();
  msgEl.textContent = 'Finding live Fantasy tournament…';

  try {
    const tournamentId = await adminGetLiveTournamentId('fantasy');
    if (!tournamentId) { msgEl.textContent = 'No live Fantasy tournament found — launch one first.'; return; }

    msgEl.textContent = `Building squads for ${adminTestUserIds.length} test accounts…`;
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'fantasy_seed_entries', tournament_id: tournamentId, user_ids: adminTestUserIds })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }
    msgEl.textContent = `Seeded ${data.seeded} Fantasy squads.`;
    log('Fantasy squads seeded', 'success');
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  }
}

// Stock Market starts as 'upcoming' during its draft phase and only
// flips to 'live' when the market opens — so unlike the other three
// types, finding it means checking 'upcoming' first, then 'live'.
async function adminGetStockMarketTournamentId() {
  const token = localStorage.getItem('gbf_token');
  for (const status of ['upcoming', 'live']) {
    const response = await fetch(`/api/tournaments?status=${status}&tournament_type=stockmarket`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    const list = data.tournaments || [];
    if (Array.isArray(list) && list.length > 0) return list[0].id;
  }
  return null;
}

async function adminSeedStockMarketSquads() {
  const msgEl = document.getElementById('seedEntriesResultMsg');
  await adminEnsureTestUsers();
  msgEl.textContent = 'Finding Stock Market tournament…';

  try {
    const tournamentId = await adminGetStockMarketTournamentId();
    if (!tournamentId) { msgEl.textContent = 'No Stock Market tournament found — launch one first.'; return; }

    msgEl.textContent = `Drafting squads for ${adminTestUserIds.length} test accounts…`;
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'stockmarket_seed_squads', tournament_id: tournamentId, user_ids: adminTestUserIds })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }
    const skipped = data.already_had_squad_skipped || 0;
    msgEl.textContent = `Seeded ${data.seeded} new Stock Market squads.${skipped > 0 ? ` ${skipped} account(s) already had a squad and were correctly left untouched.` : ''} Draft your own squad on /stock-market-draft if you want in, THEN click Force Close SM Draft.`;
    log(`Stock Market squads seeded: ${data.seeded} new, ${skipped} skipped (already had one)`, 'success');
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  }
}

async function adminForceCloseDraft() {
  const msgEl = document.getElementById('seedEntriesResultMsg');
  if (!confirm('Force close the Stock Market draft window? Squads lock permanently and the market goes live. Make sure your own squad is drafted first if you want to be in.')) return;

  try {
    const tournamentId = await adminGetStockMarketTournamentId();
    if (!tournamentId) { msgEl.textContent = 'No Stock Market tournament found.'; return; }

    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'stockmarket_force_close', tournament_id: tournamentId })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }
    msgEl.textContent = 'Draft window closed — the market initializes on the next Stock Market page load.';
    log('Stock Market draft force-closed', 'success');
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  }
}

async function seedGameweekRange() {
  const fromGw = document.getElementById('seedFromGw').value;
  const toGw = document.getElementById('seedToGw').value;
  const btn = document.getElementById('seedRangeBtn');
  const msgEl = document.getElementById('seedRangeResultMsg');
  if (!fromGw || !toGw) { alert('Enter both a From and To gameweek.'); return; }
  if (!confirm(`Seed GW${fromGw} to GW${toGw} with realistic results + stats? Matches stay 'upcoming' — this just populates the data.`)) return;

  btn.disabled = true;
  msgEl.textContent = 'Seeding… this can take a little while for a big range.';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'seed_gameweek_range', from_gw: parseInt(fromGw), to_gw: parseInt(toGw) })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }

    const summary = Object.entries(data.seeded || {}).map(([gw, r]) =>
      r.status === 200 ? `GW${gw}: ${r.matches_updated} matches, ${r.players_with_stats} players ✓` : `GW${gw}: FAILED (${r.error})`
    ).join(' | ');
    msgEl.textContent = summary;
    log(`Seeded GW${fromGw}-${toGw}`, 'success');
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function loadSimulateMatches() {
  const gw = document.getElementById('simGwInput').value;
  const body = document.getElementById('simulateMatchesBody');
  if (!gw) { alert('Enter a gameweek first.'); return; }
  body.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">Loading…</td></tr>';

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/tournaments?admin_matches_for_gameweek=${gw}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      body.innerHTML = `<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">Failed: ${data.error}</td></tr>`;
      return;
    }

    pollingPausedState = !!data.polling_paused;
    updatePollingStatusUI(pollingPausedState);

    if (!data.matches || data.matches.length === 0) {
      body.innerHTML = '<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">No fixtures found for this gameweek — run Sync Everything first.</td></tr>';
      return;
    }

    renderSimulateMatches(data.matches);
  } catch (error) {
    body.innerHTML = `<tr><td colspan="4" class="text-muted" style="padding:0.75rem;">Error: ${error.message}</td></tr>`;
  }
}

function renderSimulateMatches(matches) {
  const body = document.getElementById('simulateMatchesBody');
  body.innerHTML = matches.map(m => {
    const statusColor = m.status === 'finished' ? 'var(--green)' : m.status === 'live' ? 'var(--red)' : 'var(--text-muted, #8a97b0)';
    const score = (m.home_score ?? '-') + ' - ' + (m.away_score ?? '-');
    return `
      <tr style="border-bottom:1px solid var(--border-color);">
        <td style="padding:0.5rem;"><input type="checkbox" class="simMatchCheckbox" value="${m.id}" ${m.status === 'finished' ? 'disabled' : ''}></td>
        <td style="padding:0.5rem;">${escapeHtmlWallet(m.home_team)} v ${escapeHtmlWallet(m.away_team)}</td>
        <td style="padding:0.5rem; color:${statusColor}; text-transform:uppercase; font-weight:700; font-size:0.75rem;">${escapeHtmlWallet(m.status)}</td>
        <td style="padding:0.5rem;">${score}</td>
      </tr>`;
  }).join('');
}

function toggleSelectAllMatches(checkbox) {
  document.querySelectorAll('.simMatchCheckbox:not(:disabled)').forEach(cb => { cb.checked = checkbox.checked; });
}

async function markSelectedMatchesFinished() {
  const selected = Array.from(document.querySelectorAll('.simMatchCheckbox:checked')).map(cb => cb.value);
  if (selected.length === 0) { alert('Select at least one match first.'); return; }
  if (!confirm(`Mark ${selected.length} match(es) as finished? Uses whatever result/stats data already exists for them — doesn't generate anything. Runs the real scoring/settlement functions.`)) return;

  const btn = document.getElementById('markFinishedBtn');
  const msgEl = document.getElementById('simulateResultMsg');
  btn.disabled = true;
  msgEl.textContent = 'Marking finished…';

  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'mark_matches_finished', match_ids: selected })
    });
    const data = await response.json();
    if (!response.ok) { msgEl.textContent = `Failed: ${data.error}`; return; }

    const gwSummaries = Object.entries(data.gameweek_results || {}).map(([gw, r]) =>
      r.fired
        ? `GW${gw}: ALL FINISHED — Stock Market settled (${r.stock_market_tournaments_settled}), LMS settled (${r.lms_tournaments_settled}), Fantasy players updated (${r.fantasy_players_updated})`
        : `GW${gw}: still waiting on other matches`
    ).join(' | ');

    msgEl.textContent = `${data.matches_marked} match(es) marked finished.${data.predictions_scored ? ' Predictions scored.' : ''} ${gwSummaries}`;
    log('Marked matches finished', 'success');
    loadSimulateMatches();
  } catch (error) {
    msgEl.textContent = `Error: ${error.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function generateTestGameweekData() {
  const gw = document.getElementById('genTestGwSelect').value;
  const resultEl = document.getElementById('genTestGwResult');
  if (!gw) { alert('Choose a gameweek first.'); return; }

  const token = localStorage.getItem('gbf_token');
  resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Generating…';
  try {
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'generate_test_gameweek_data', gameweek: parseInt(gw) })
    });
    const data = await response.json();
    if (!response.ok) {
      resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Failed: ${data.error}</span>`;
    } else if (data.matches_updated < data.matches_attempted) {
      // Some (or all) match updates genuinely failed — say so plainly
      // instead of reporting a clean success that didn't actually happen.
      resultEl.innerHTML = `
        <span style="color:var(--accent-red,#ef4444);">⚠ Only ${data.matches_updated} of ${data.matches_attempted} matches actually updated — ${data.matches_attempted - data.matches_updated} failed.</span><br>
        <span style="color:var(--accent-green,#22c55e);">${data.players_with_stats} player stat rows were written OK.</span>
        ${data.match_update_errors ? `<div style="margin-top:0.5rem; font-size:0.8rem; max-height:200px; overflow-y:auto;">${data.match_update_errors.map(e => `Match ${e.match_id}: ${e.error}`).join('<br>')}</div>` : ''}`;
    } else {
      resultEl.innerHTML = `<span style="color:var(--accent-green,#22c55e);">✓ Done — ${data.matches_updated} matches, ${data.players_with_stats} players${data.predictions_scored ? ', Predictions scored' : ''}. Set the master clock to GW${gw} and reload any tournament page to see it.</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Error: ${e.message}</span>`;
  }
}

async function loadPlayerIdChanges() {
  const resultEl = document.getElementById('playerIdChangesResult');
  const token = localStorage.getItem('gbf_token');
  resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading…';
  try {
    const response = await fetch('/api/tournaments?player_id_changes=true', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Failed: ${data.error}</span>`;
      return;
    }
    const changes = data.changes || [];
    if (changes.length === 0) {
      resultEl.innerHTML = '<span style="color:var(--accent-green,#22c55e);">✓ No changes detected.</span>';
      return;
    }
    const suspicious = changes.filter(c => c.change_type === 'possible_id_reassignment');
    const transfers = changes.filter(c => c.change_type !== 'possible_id_reassignment');

    let html = '';
    if (suspicious.length > 0) {
      html += `<div style="color:var(--accent-red,#ef4444); font-weight:700;">⚠ ${suspicious.length} possible ID reassignment(s) — same number, different name:</div>
        <div style="margin-top:0.4rem; margin-bottom:0.75rem; max-height:200px; overflow-y:auto; font-size:0.8rem;">
          ${suspicious.map(c => `<div style="margin-bottom:0.4rem; padding:0.4rem; background:rgba(239,68,68,0.1); border-radius:0.4rem;">
            Player ID ${c.player_id}: "${c.old_web_name || '?'}" → "${c.new_web_name || '?'}"
            <span class="text-muted">(detected ${new Date(c.detected_at).toLocaleString()})</span>
          </div>`).join('')}
        </div>`;
    } else {
      html += '<div style="color:var(--accent-green,#22c55e);">✓ No suspicious ID reassignments.</div>';
    }
    if (transfers.length > 0) {
      html += `<details style="margin-top:0.5rem;"><summary class="text-muted" style="cursor:pointer; font-size:0.8rem;">${transfers.length} routine transfer(s) (same name, new team) — informational only</summary>
        <div style="margin-top:0.4rem; max-height:200px; overflow-y:auto; font-size:0.8rem;">
          ${transfers.map(c => `<div style="margin-bottom:0.3rem;" class="text-muted">Player ID ${c.player_id} (${c.new_web_name}): team ${c.old_team} → ${c.new_team}</div>`).join('')}
        </div>
      </details>`;
    }
    resultEl.innerHTML = html;
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Error: ${e.message}</span>`;
  }
}

async function loadMissingPhotoPlayers() {
  const select = document.getElementById('photoUploadPlayerSelect');
  if (!select) return;
  const token = localStorage.getItem('gbf_token');
  try {
    const response = await fetch('/api/tournaments?missing_photo_players=true', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) {
      select.innerHTML = `<option value="">Failed to load: ${data.error || 'unknown error'}</option>`;
      return;
    }
    missingPhotoPlayersList = data.players || [];
    select.innerHTML = missingPhotoPlayersList.length === 0
      ? '<option value="">No missing photos — run Photo Verification first, or none are missing</option>'
      : '<option value="">-- choose a player --</option>' +
        missingPhotoPlayersList.map(p => `<option value="${p.id}">${escapeHtmlAdmin(p.web_name)} — ${escapeHtmlAdmin(p.team)}</option>`).join('');
  } catch (e) {
    select.innerHTML = `<option value="">Error: ${e.message}</option>`;
  }
}

function searchGoogleImagesForSelected() {
  const select = document.getElementById('photoUploadPlayerSelect');
  const playerId = select.value;
  if (!playerId) { alert('Choose a player first.'); return; }
  const player = missingPhotoPlayersList.find(p => String(p.id) === String(playerId));
  if (!player) return;
  // "transparent png" biases results toward cutout-style images, and
  // tbs=ift:png restricts Google's file-type filter to PNGs specifically —
  // between the two, far fewer plain background photos show up.
  const query = encodeURIComponent(`${player.web_name} ${player.team} premier league transparent png`);
  window.open(`https://www.google.com/search?q=${query}&tbm=isch&tbs=ift:png`, '_blank');
}

function uploadSelectedPlayerPhoto() {
  const select = document.getElementById('photoUploadPlayerSelect');
  const fileInput = document.getElementById('photoUploadFile');
  const resultEl = document.getElementById('photoUploadResult');
  const btn = document.getElementById('photoUploadBtn');
  const playerId = select.value;

  if (!playerId) { alert('Choose a player first.'); return; }
  if (!fileInput.files || !fileInput.files[0]) { alert('Choose a downloaded photo file first.'); return; }

  const file = fileInput.files[0];
  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const reader = new FileReader();

  reader.onload = async () => {
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading…';
    resultEl.innerHTML = '';
    try {
      const base64 = reader.result.split(',')[1]; // strip the data:...;base64, prefix
      const token = localStorage.getItem('gbf_token');
      const response = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'upload_player_photo', player_id: parseInt(playerId, 10), image_base64: base64, file_ext: ext })
      });
      const data = await response.json();
      if (!response.ok) {
        resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Failed: ${data.error || 'unknown error'}${data.detail ? ' — ' + data.detail : ''}</span>`;
      } else {
        resultEl.innerHTML = `<span style="color:var(--accent-green,#22c55e);">✓ Uploaded and live now.</span> <a href="${data.photo_url}" target="_blank" style="color:var(--accent-blue,#3b82f6);">View photo</a>`;
        fileInput.value = '';
        loadMissingPhotoPlayers(); // drop them from the list since they're fixed now
      }
    } catch (e) {
      resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">Error: ${e.message}</span>`;
    }
    btn.disabled = false;
    btn.innerHTML = '<i class="fas fa-cloud-arrow-up"></i> Upload';
  };
  reader.readAsDataURL(file);
}

async function loadAuditHistory() {
  const idField = document.getElementById('auditTournamentId');
  const selectField = document.getElementById('auditTournamentSelect');
  // Defensive fallback: if the text field is empty for any reason (stale
  // deployed script, unexpected timing, etc.), fall back to reading the
  // dropdown's own current selection directly rather than failing.
  const tournamentId = idField.value.trim() || (selectField ? selectField.value : '');
  if (tournamentId && !idField.value.trim()) idField.value = tournamentId;
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
    const actionAudit = data.action_audit;
    if (!rows) { results.innerHTML = 'No data returned.'; return; }

    const money = p => `£${((p || 0) / 100).toFixed(2)}`;
    const statusColor = rows.ok ? 'var(--accent-green)' : 'var(--accent-red)';

    let actionHtml = '';
    if (actionAudit) {
      const actionColor = actionAudit.ok ? 'var(--accent-green)' : 'var(--accent-red)';
      const mismatchRows = (actionAudit.mismatches || []).map(m => `
        <tr style="border-bottom:1px solid var(--border-color);">
          <td style="padding:4px 6px;">GW${m.gameweek}</td>
          <td style="padding:4px 6px;">${m.player}</td>
          <td style="padding:4px 6px;">expected ${money(m.expected_won)} / actual ${money(m.actual_won)}</td>
          <td style="padding:4px 6px;">expected ${money(m.expected_paid)} / actual ${money(m.actual_paid)}</td>
        </tr>`).join('');
      actionHtml = `
        <div style="margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border-color);">
          <div style="font-weight:700; margin-bottom:0.4rem;">Per-Player Action Check</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-bottom:0.75rem;">
            <div>Matchups checked: <strong>${actionAudit.matchups_checked}</strong></div>
            <div>Player-gameweek rows checked: <strong>${actionAudit.player_rows_checked}</strong></div>
          </div>
          <div style="padding:0.6rem; border-radius:0.5rem; background:rgba(0,0,0,0.2); color:${actionColor}; font-weight:700;">
            ${actionAudit.ok ? `✓ Every player got exactly what their actions should pay — ${actionAudit.player_rows_checked} rows, 0 mismatches` : `⚠ ${actionAudit.mismatches_found} MISMATCH(ES) FOUND`}
          </div>
          ${mismatchRows ? `<table style="width:100%; border-collapse:collapse; font-size:0.8rem; margin-top:0.6rem;">
            <tr style="text-align:left; border-bottom:1px solid var(--border-color);"><th style="padding:4px 6px;">GW</th><th style="padding:4px 6px;">Player</th><th style="padding:4px 6px;">Won</th><th style="padding:4px 6px;">Paid</th></tr>
            ${mismatchRows}
          </table>` : ''}
          <p class="text-muted" style="font-size:0.7rem; margin-top:0.6rem;">${actionAudit.note}</p>
        </div>`;
    }

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
      </p>
      ${actionHtml}`;
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
    const [listResponse, gwResponse] = await Promise.all([
      fetch('/api/tournaments?tournament_type=stockmarket'),
      fetch('/api/tournaments?stockmarket_current_gameweek=true')
    ]);
    const data = await listResponse.json();
    const gwData = await gwResponse.json();
    const liveGw = gwData.current_gameweek ?? '?';
    const tournaments = data.tournaments || [];
    const optionsHtml = tournaments.length === 0
      ? '<option value="">No Stock Market tournaments found</option>'
      : '<option value="">-- choose a tournament --</option>' +
        // Shows the real, live shared gameweek (not the tournament's own
        // `gameweek` column, which only ever holds its creation-time
        // value and is never updated again as play progresses).
        tournaments.map(t => `<option value="${t.id}">${escapeHtmlAdmin(t.name || 'Untitled')} — ${t.status} (currently GW${liveGw})</option>`).join('');
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

async function saveEndGameweek() {
  const tournamentId = document.getElementById('stagesTournamentId').value.trim();
  const newEndGw = document.getElementById('editEndGameweek').value;
  const resultEl = document.getElementById('editEndGameweekResult');
  if (!tournamentId) { alert('Load a tournament first.'); return; }
  if (!newEndGw) { alert('Enter an end gameweek.'); return; }

  const token = localStorage.getItem('gbf_token');
  resultEl.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  try {
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'stockmarket_edit_end_gameweek', tournament_id: tournamentId, end_gameweek: parseInt(newEndGw) })
    });
    const data = await response.json();
    if (!response.ok) {
      resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">${data.error}</span>`;
    } else {
      resultEl.innerHTML = `<span style="color:var(--accent-green,#22c55e);">✓ Saved</span>`;
    }
  } catch (e) {
    resultEl.innerHTML = `<span style="color:var(--accent-red,#ef4444);">${e.message}</span>`;
  }
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
    // A fresh tournament has no stage rows at all yet — without this,
    // the table rendered completely empty, with no input fields to type
    // into whatsoever. Confirmed as a real bug, not user error: there
    // was nothing to save because there was nothing to fill in.
    currentStagesData = (data.stages && data.stages.length > 0)
      ? data.stages
      : [1, 2, 3, 4].map(n => ({ stage_number: n, trigger_gameweek: null, relegate_count: 0, cost_multiplier: 1, applied: false }));
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

async function fullPlatformReset() {
  const resultEl = document.getElementById('fullResetResult');
  const typed = prompt('This wipes EVERY tournament, entry, wallet transaction, match result, and player stat across the ENTIRE platform — both databases, all four tournament types. This cannot be undone.\n\nType RESET EVERYTHING (exactly, in capitals) to confirm:');
  if (typed !== 'RESET EVERYTHING') {
    if (typed !== null) alert('Phrase didn\'t match exactly — nothing was reset.');
    return;
  }

  resultEl.innerHTML = '<span class="text-amber"><i class="fas fa-spinner fa-spin"></i> Resetting everything…</span>';
  log('Starting full platform reset...', 'warn');
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'full_platform_reset', confirm_phrase: typed })
    });
    const data = await response.json();
    if (!response.ok) {
      resultEl.innerHTML = `<span style="color:var(--accent-red);">Failed: ${data.error}</span>`;
      log(`Full reset failed: ${data.error}`, 'error');
      return;
    }
    resultEl.innerHTML = '<span style="color:var(--accent-green);">Done. Every table wiped, clock back to GW1, polling paused. Check the counts in the browser console for full detail.</span>';
    console.log('Full platform reset — deleted counts:', data.deleted);
    log('Full platform reset complete.', 'success');
    refreshStatus();
  } catch (error) {
    resultEl.innerHTML = `<span style="color:var(--accent-red);">Error: ${error.message}</span>`;
    log(`Full reset error: ${error.message}`, 'error');
  }
}

async function fullTestReset() {
  const resultEl = document.getElementById('resetResult');
  if (!confirm('This wipes EVERY Stock Market tournament, entry, and history record, and starts a brand new one at Gameweek 1. This cannot be undone. Continue?')) return;

  const name = document.getElementById('resetTournamentName').value.trim() || 'Test Stock Market';
  const entryFee = parseInt(document.getElementById('resetEntryFee').value) || 2400;

  resultEl.textContent = 'Resetting…';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'stockmarket_full_reset', name, entry_fee: entryFee })
    });
    const data = await response.json();
    if (!response.ok) { resultEl.innerHTML = `<span style="color:var(--accent-red);">Failed: ${data.error}</span>`; return; }
    resultEl.innerHTML = `<span style="color:var(--accent-green);">Done. New tournament: ${data.tournament_id}</span>`;
    document.getElementById('stagesTournamentId').value = data.tournament_id;
    await loadStockMarketTournamentList();
    const select = document.getElementById('stagesTournamentSelect');
    if (select) select.value = data.tournament_id;
    const auditSelect = document.getElementById('auditTournamentSelect');
    if (auditSelect) auditSelect.value = data.tournament_id;
  } catch (error) {
    resultEl.innerHTML = `<span style="color:var(--accent-red);">Error: ${error.message}</span>`;
  }
}

async function downloadFullExport() {
  const resultEl = document.getElementById('exportResult');
  const tournamentId = document.getElementById('stagesTournamentId').value.trim();
  if (!tournamentId) { resultEl.innerHTML = '<span style="color:var(--accent-red);">Pick a tournament in the panel above first.</span>'; return; }

  resultEl.textContent = 'Building export…';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch(`/api/tournaments?stockmarket_full_export=true&tournament_id=${tournamentId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) { resultEl.innerHTML = `<span style="color:var(--accent-red);">Failed: ${data.error}</span>`; return; }

    const players = (data.players || []).map(p => ({
      User: p.user_email, Relegated: p.relegated ? `Yes (GW${p.relegated_at_gameweek})` : 'No',
      Gameweek: p.gameweek, Player: p.name, Position: p.position, Team: p.team, Benched: p.benched ? 'Yes' : 'No',
      Goals: p.stats?.goals || 0, Assists: p.stats?.assists || 0, Yellow: p.stats?.yellow_cards || 0, Red: p.stats?.red_cards || 0,
      CleanSheets: p.stats?.clean_sheets || 0, GoalsConceded: p.stats?.goals_conceded || 0, Saves: p.stats?.saves || 0,
      StartValue: ((p.starting_value || 0) / 100).toFixed(2), WinBonus: ((p.win_bonus || 0) / 100).toFixed(2),
      PenaltyPaid: ((p.penalty_paid || 0) / 100).toFixed(2), EndValue: ((p.ending_value || 0) / 100).toFixed(2),
      Change: (((p.ending_value || 0) - (p.starting_value || 0)) / 100).toFixed(2)
    }));

    const transactions = (data.transactions || []).map(t => ({
      User: t.user_email, Gameweek: t.gameweek, Type: t.type, Player: t.player_name, Position: t.position,
      PackType: t.pack_type || '', Amount: ((t.amount || 0) / 100).toFixed(2),
      Shortfall: ((t.shortfall || 0) / 100).toFixed(2), FeeRecipients: t.fee_recipients || 0,
      Timestamp: t.created_at
    }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(players), 'Player GW History');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(transactions), 'Transactions');
    XLSX.writeFile(wb, `stockmarket-full-export-${tournamentId.slice(0, 8)}.xlsx`);

    if (data.transactions_error) {
      resultEl.innerHTML = `<span style="color:var(--accent-amber);">Downloaded — ${players.length} player rows, but transactions failed: ${data.transactions_error}</span>`;
    } else {
      resultEl.innerHTML = `<span style="color:var(--accent-green);">Downloaded — ${players.length} player rows, ${transactions.length} transactions.</span>`;
    }
  } catch (error) {
    resultEl.innerHTML = `<span style="color:var(--accent-red);">Error: ${error.message}</span>`;
  }
}

async function launchTournament() {
  const typeLabels = { predictions: 'Predictions', lms: 'Last Man Standing', stockmarket: 'Stock Market', fantasy: 'Fantasy Manager' };
  const tournamentType = document.getElementById('tournament-type-input')?.value || 'predictions';
  if (!confirm(`Launch new ${typeLabels[tournamentType]} tournament? This will:\n1. Sync current GW fixtures from FPL\n2. Create the tournament\n3. Open for user registrations`)) {
    return;
  }
  
  log(`Launching ${typeLabels[tournamentType]} tournament...`, 'info');
  
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
        tournament_type: tournamentType,
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
    
    const matchFinished = (data.gameweeks_recalculated || []).length > 0;
    const gwList = matchFinished ? data.gameweeks_recalculated.join(', ') : 'none (match not finished — nothing to score yet)';
    const lmsSummary = !matchFinished
      ? 'not checked (match not finished — nothing to correct yet)'
      : ((data.lms_corrections || [])
          .map(c => `${c.eliminated} eliminated, ${c.revived} revived`)
          .join(' / ') || 'no live LMS tournaments found');
    resultDiv.innerHTML = `<span class="text-green">✅ Score saved! Predictions recalculated for GW: ${gwList}. LMS: ${lmsSummary}</span>`;
    log(`Score saved. Predictions recalculated: GW ${gwList}. LMS corrections: ${lmsSummary}`, 'success');
    
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
    
    const gwList = (data.results.gameweeks_recalculated || []).join(', ') || 'none (no finished gameweeks yet)';
    const errCount = (data.results.errors || []).length;
    resultDiv.innerHTML = `<span class="text-green">✅ Recalculation complete! Gameweeks recalculated: ${gwList}${errCount ? ` (${errCount} error(s), check console)` : ''}</span>`;
    if (errCount) console.error('recalculate-tournament-points errors:', data.results.errors);
    log(`Tournament points recalculated. Gameweeks: ${gwList}`, 'success');
    
  } catch (error) {
    resultDiv.innerHTML = `<span class="text-red">❌ Error: ${error.message}</span>`;
    log(`Recalculation error: ${error.message}`, 'error');
  }
}

// ---------- Admin Guide modal ----------
function mdToHtml(md) {
  // Lightweight, dependency-free markdown -> HTML, covering exactly what
  // the guide doc uses (headers, bold, italic, lists, horizontal rules).
  // Not a general-purpose parser — just enough for this one document.
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  for (let raw of lines) {
    let line = escapeHtml(raw);
    line = line.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>');

    const isListItem = /^(-|\d+\.)\s+/.test(raw);
    if (isListItem && !inList) { html += '<ul style="margin:0.5rem 0; padding-left:1.5rem;">'; inList = true; }
    if (!isListItem && inList) { html += '</ul>'; inList = false; }

    if (/^### /.test(raw)) html += `<h4 style="margin:1.25rem 0 0.4rem;">${line.slice(4)}</h4>`;
    else if (/^## /.test(raw)) html += `<h3 style="margin:1.5rem 0 0.5rem; color:var(--accent-green);">${line.slice(3)}</h3>`;
    else if (/^# /.test(raw)) html += `<h2 style="margin:0 0 1rem;">${line.slice(2)}</h2>`;
    else if (/^---\s*$/.test(raw)) html += '<hr style="border-color:var(--border-color); margin:1.25rem 0;">';
    else if (isListItem) html += `<li>${line.replace(/^(-|\d+\.)\s+/, '')}</li>`;
    else if (raw.trim() === '') html += '';
    else html += `<p style="margin:0.6rem 0;">${line}</p>`;
  }
  if (inList) html += '</ul>';
  return html;
}

async function openAdminGuide() {
  const overlay = document.getElementById('adminGuideOverlay');
  const body = document.getElementById('adminGuideBody');
  overlay.style.display = 'flex';
  body.innerHTML = '<p class="text-muted"><i class="fas fa-spinner fa-spin"></i> Loading…</p>';

  try {
    const res = await fetch('https://ywfdilwfjytllethgrvl.supabase.co/storage/v1/object/public/admin-docs/ADMIN-PANEL-GUIDE.md', { cache: 'no-store' });
    if (!res.ok) {
      body.innerHTML = `
        <p class="text-muted">The guide hasn't been uploaded to storage yet.</p>
        <button class="btn btn-primary" onclick="uploadAdminGuideNow()"><i class="fas fa-cloud-arrow-up"></i> Upload Guide Now</button>
        <div id="guideUploadResult" style="margin-top:0.75rem; font-size:0.85rem;"></div>`;
      return;
    }
    const text = await res.text();
    body.innerHTML = mdToHtml(text);
  } catch (e) {
    body.innerHTML = `<p class="text-red">Couldn't load the guide: ${e.message}</p>`;
  }
}

function closeAdminGuide() {
  document.getElementById('adminGuideOverlay').style.display = 'none';
}

async function uploadAdminGuideNow() {
  const resultEl = document.getElementById('guideUploadResult');
  if (resultEl) resultEl.textContent = 'Uploading…';
  try {
    const token = localStorage.getItem('gbf_token');
    const response = await fetch('/api/tournaments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ action: 'upload_admin_guide' })
    });
    const data = await response.json();
    if (!response.ok) {
      if (resultEl) resultEl.innerHTML = `<span style="color:var(--accent-red);">Failed: ${data.error}</span>`;
      return;
    }
    openAdminGuide(); // reload now that it exists
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color:var(--accent-red);">Error: ${e.message}</span>`;
  }
}
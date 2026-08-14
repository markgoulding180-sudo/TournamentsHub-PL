// Shared notification bell — self-contained, matching the same pattern
// already proven in toast.js. Injects its own panel HTML and styles, and
// attaches to any existing `.bell-btn` element already present on the
// page — no page-specific markup or IDs required beyond that one class,
// which is already consistently present across every page's navbar.
//
// Confirmed as a real, systemic gap before building this: only 2 of 15
// pages with a bell icon had this actually wired up — the other 13 had
// a completely inert button, no click handler, no functionality at all.
(function () {
  function escapeHtmlNotif(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function notifAuthHeaders() {
    const token = localStorage.getItem('gbf_token');
    return token ? { 'Authorization': `Bearer ${token}` } : {};
  }

  function injectStyles() {
    if (document.getElementById('gbf-notif-styles')) return;
    const style = document.createElement('style');
    style.id = 'gbf-notif-styles';
    style.textContent = `
      .notif-overlay{ display:none; position:fixed; inset:0; z-index:198; background:rgba(0,0,0,0.5); }
      .notif-overlay.open{ display:block; }
      .notif-panel{
        display:none; position:fixed; top:76px; right:32px; z-index:199;
        width:360px; max-width:calc(100vw - 32px); max-height:70vh;
        background:var(--bg-panel,#0f1424); border:1px solid var(--border,#1f2740); border-radius:14px;
        box-shadow:0 20px 50px rgba(0,0,0,0.5); overflow:hidden; flex-direction:column;
      }
      .notif-panel.open{ display:flex; }
      .notif-panel-header{
        display:flex; align-items:center; justify-content:space-between; padding:14px 16px;
        border-bottom:1px solid var(--border,#1f2740); font-weight:700; font-size:14px; color:var(--text,#fff);
      }
      .notif-panel-header button{ width:26px;height:26px;border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--bg-card,#131a2e); border:none; color:var(--text,#fff); cursor:pointer; }
      .notif-panel-body{ overflow-y:auto; padding:10px; }
      .notif-empty{ text-align:center; padding:26px 16px; color:var(--text-faint,#7b869e); font-size:13px; }
      .notif-item{ display:block; padding:12px 12px; border-radius:10px; margin-bottom:6px; background:var(--bg-card,#131a2e); border:1px solid var(--border,#1f2740); text-decoration:none; }
      .notif-item:hover{ border-color:var(--border-hover,#2a3352); }
      .notif-item .notif-title{ font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:.3px; margin-bottom:4px; display:flex; align-items:center; gap:6px; }
      .notif-item .notif-msg{ font-size:13px; color:var(--text-dim,#a7b0c4); line-height:1.4; }
      .notif-item.admin .notif-title{ color:var(--gold,#f4b942); }
      .notif-item.action .notif-title{ color:var(--accent-2,#3b82f6); }
      .notif-item.severity-warning{ border-color:var(--gold,#f4b942); }
      .notif-item.severity-urgent{ border-color:var(--red,#ef4444); }
      .gbf-notif-dot{ position:absolute; top:4px; right:4px; width:8px; height:8px; border-radius:50%; background:var(--red,#ef4444); display:none; }
      @media (max-width:640px){
        .notif-panel{ top:auto; bottom:0; left:0; right:0; width:100%; max-width:100%; border-radius:16px 16px 0 0; max-height:80vh; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectPanel() {
    if (document.getElementById('notifPanel')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="notif-overlay" id="notifOverlay"></div>
      <div class="notif-panel" id="notifPanel">
        <div class="notif-panel-header">
          <span>Notifications</span>
          <button id="notifCloseBtn" title="Close">&times;</button>
        </div>
        <div class="notif-panel-body" id="notifBody">
          <div class="notif-empty">Loading…</div>
        </div>
      </div>`;
    document.body.appendChild(wrap);
  }

  async function loadNotifications() {
    const body = document.getElementById('notifBody');
    const dot = document.querySelector('.gbf-notif-dot');
    const token = localStorage.getItem('gbf_token');

    if (!token) {
      body.innerHTML = `<div class="notif-empty">Log in to see your notifications.</div>`;
      if (dot) dot.style.display = 'none';
      return;
    }

    try {
      const res = await fetch('/api/tournaments?notifications=true', { headers: notifAuthHeaders() });
      const data = await res.json();
      const adminMessages = data.admin_messages || [];
      const actionItems = data.action_items || [];
      const total = adminMessages.length + actionItems.length;

      if (dot) dot.style.display = total > 0 ? 'block' : 'none';

      if (total === 0) {
        body.innerHTML = `<div class="notif-empty">You're all caught up! 🎉</div>`;
        return;
      }

      const adminHtml = adminMessages.map(m => `
        <div class="notif-item admin severity-${escapeHtmlNotif(m.severity || 'info')}">
          <div class="notif-title"><i class="fas fa-bullhorn"></i> Announcement</div>
          <div class="notif-msg">${escapeHtmlNotif(m.message)}</div>
        </div>`).join('');

      const actionHtml = actionItems.map(item => `
        <a class="notif-item action" href="${item.href}">
          <div class="notif-title"><i class="fas fa-triangle-exclamation"></i> Action Needed</div>
          <div class="notif-msg">${escapeHtmlNotif(item.message)}</div>
        </a>`).join('');

      body.innerHTML = adminHtml + actionHtml;
    } catch (e) {
      console.error('Failed to load notifications:', e);
      body.innerHTML = `<div class="notif-empty">Couldn't load notifications right now.</div>`;
    }
  }

  function toggleNotifPanel(open) {
    document.getElementById('notifPanel').classList.toggle('open', open);
    document.getElementById('notifOverlay').classList.toggle('open', open);
    if (open) loadNotifications();
  }

  function findBellButton() {
    // Different pages use different class names for this button
    // (.bell-btn on most, .hub-icon-btn on a couple) — finding by the
    // actual bell icon inside it is more robust than depending on any
    // one specific class naming convention.
    const candidates = document.querySelectorAll('button');
    for (const btn of candidates) {
      if (btn.querySelector('.fa-bell')) return btn;
    }
    return null;
  }

  function initNotificationBell() {
    const bellBtn = findBellButton();
    if (!bellBtn) return;

    injectStyles();
    injectPanel();

    // Add the unread-dot indicator directly onto the existing bell
    // button, if it doesn't already have one.
    if (!bellBtn.querySelector('.gbf-notif-dot')) {
      bellBtn.style.position = 'relative';
      const dot = document.createElement('span');
      dot.className = 'gbf-notif-dot';
      bellBtn.appendChild(dot);
    }

    bellBtn.addEventListener('click', () => toggleNotifPanel(true));
    document.getElementById('notifCloseBtn').addEventListener('click', () => toggleNotifPanel(false));
    document.getElementById('notifOverlay').addEventListener('click', () => toggleNotifPanel(false));

    loadNotifications();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initNotificationBell);
  } else {
    initNotificationBell();
  }
})();

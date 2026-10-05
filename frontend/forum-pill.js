// forum-pill.js — adds a small "Forum" pill to the top bar on every page.
// Self-contained: finds the page's top bar, puts the pill just before the
// menu button, and brings its own styling. Changes nothing else.
(function () {
  if (window.__gbForumPill) return;
  window.__gbForumPill = true;

  function add() {
    const bar = document.querySelector('.topbar, .navbar, .hub-navbar');
    if (!bar || bar.querySelector('.gb-forum-pill')) return;

    const css = document.createElement('style');
    css.textContent =
      '.gb-forum-pill{display:inline-flex;align-items:center;gap:6px;flex:none;height:32px;padding:0 13px;border-radius:999px;' +
      'background:rgba(59,130,246,0.14);border:1px solid rgba(96,165,250,0.45);color:#dbeafe;text-decoration:none;' +
      "font-family:'Rajdhani',sans-serif;font-weight:700;font-size:14px;letter-spacing:.3px;white-space:nowrap;transition:background .2s,border-color .2s;}" +
      '.gb-forum-pill:hover{background:rgba(59,130,246,0.28);border-color:#60a5fa;color:#fff;}' +
      '.gb-forum-pill.on{background:linear-gradient(135deg,#3b82f6,#1d4ed8);border-color:#3b82f6;color:#fff;}' +
      '.gb-forum-pill i{font-size:12px;}' +
      '@media (max-width:420px){.gb-forum-pill{height:30px;padding:0 10px;font-size:13px;}.gb-forum-pill i{display:none;}}';
    document.head.appendChild(css);

    const pill = document.createElement('a');
    pill.className = 'gb-forum-pill' + (location.pathname.indexOf('/forum') === 0 ? ' on' : '');
    pill.href = '/forum';
    pill.title = 'Forum';
    pill.innerHTML = '<i class="fas fa-comments"></i>Forum';

    const menu = bar.querySelector('#mobileMenuBtn, .menu-btn, .menu-toggle, .hub-menu-toggle');
    if (menu && menu.parentNode) {
      // same flex "order" as the menu button, placed just before it
      const ord = getComputedStyle(menu).order;
      if (ord && ord !== '0') pill.style.order = ord;
      menu.parentNode.insertBefore(pill, menu);
    } else {
      (bar.querySelector('.nav-right, .hub-nav-right') || bar).appendChild(pill);
    }
  }

  // Some pages' top bars are already full on phones. If adding the pill
  // pushes anything off the screen, tighten things step by step until it
  // all fits: hide the name next to the profile photo, shrink the pill,
  // then close up the gaps between the buttons.
  function fit() {
    const bar = document.querySelector('.topbar, .navbar, .hub-navbar');
    const pill = bar && bar.querySelector('.gb-forum-pill');
    if (!pill) return;
    const over = () => bar.scrollWidth > bar.clientWidth + 1;
    if (!over()) return;
    bar.querySelectorAll('#navAuthLabel, .me-name, .hub-nav-label').forEach(el => { el.style.setProperty('display', 'none', 'important'); });
    if (!over()) return;
    pill.style.padding = '0 9px'; pill.style.fontSize = '12.5px';
    if (!over()) return;
    bar.querySelectorAll('.nav-right, .hub-nav-right').forEach(el => { el.style.gap = '6px'; });
    bar.style.gap = '6px';
    bar.querySelectorAll('.avatar-btn, .hub-avatar-btn, .me-btn').forEach(el => { el.style.marginLeft = '4px'; });
    if (!over()) return;
    bar.querySelectorAll('.icon-btn, .hub-icon-btn, .hub-tourney-home-link, .tourney-home-link, .avatar, .hub-avatar').forEach(el => {
      el.style.width = '32px'; el.style.height = '32px'; el.style.minWidth = '32px';
    });
    if (!over()) return;
    bar.querySelectorAll('.logo-text .sub, .hub-logo-text .sub, .logo-text small').forEach(el => { el.style.display = 'none'; });
    if (!over()) return;
    bar.style.paddingLeft = '10px'; bar.style.paddingRight = '10px';
  }

  function start() { add(); fit(); setTimeout(fit, 600); setTimeout(fit, 2000); }
  window.addEventListener('resize', fit);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

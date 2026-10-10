// =====================================================================
// GB Hub page shell
// Gives every page the same top bar, hero size, tab bar, phone bottom bar
// and Wallet / Notifications / Leaders pop-ups as the Hub page.
//
// How a page uses it (in <head>):
//   <html lang="en" data-gbs="leaderboard">
//   <link rel="stylesheet" href="/gb-shell.css">
//   <script src="/gb-shell.js"></script>
// The data-gbs name picks that page's settings from PAGES below.
//
// To switch it OFF for one page: remove data-gbs="..." from its <html> tag.
// The page's old top bar, hero and menu are still in the page (only hidden),
// so that brings the page straight back to how it was.
// =====================================================================
(function () {
  var HUB_URL = '/';            // change to '/' when the Hub becomes the homepage
  var root = document.documentElement;
  var KEY = root.getAttribute('data-gbs');
  if (!KEY || window.__gbShell) return;
  window.__gbShell = true;

  // ---------- tab sets (each game's own links) ----------
  var NAV = {
    predictions: [['Predictions', '/predictions', 'home'], ['Make Your Predictions', '/predict', 'ball'], ['Leaderboard', '/leaderboard', 'chart']],
    lms:         [['Make Your Pick', '/last-man-standing', 'ball'], ['Survivors', '/last-man-standing#survivorsSection', 'users']],
    fantasy:     [['Fantasy Manager', '/fantasy-manager', 'home'], ['Leaderboard', '/fantasy-leaderboard', 'chart']],
    stock:       [['Stock Market', '/stock-market', 'home'], ['Draft Squad', '/stock-market-draft', 'box'], ['Injuries', '/injuries', 'plus']],
    cl:          [['Make Your Picks', '/champions-league', 'ball'], ['Leaderboard', '/champions-league-leaderboard', 'chart'], ['How It Works', '/champions-league-how-it-works', 'info']],
    darts:       [['Bracket', '/darts', 'target'], ['Leaderboard', '/darts-leaderboard', 'chart']],
    football:    [['Fixtures', '/fixtures', 'cal'], ['Table', '/table', 'table'], ['Injuries', '/injuries', 'plus'], ['Clubs', '/links', 'shield']],
    account:     [['Profile', '/profile', 'user'], ['My Tournaments', '/my-tournaments', 'trophy'], ['Wallet', '/wallet', 'wallet'], ['All Tournaments', '/tournaments', 'grid']],
    community:   [['Forum', '/forum', 'chat'], ['How It Works', '/how-it-works', 'play'], ['My Tournaments', '/my-tournaments', 'trophy']]
  };

  // ---------- each page ----------
  // hero:  'own'  = the page already has a picture hero (.hero) - it is resized to the Hub size
  //        {eyebrow,title,sub,art} = a new Hub-size hero is added
  // on:    which tab is lit
  // hide:  the page's old title bits (replaced by the hero / tabs)
  var A = '/assets/';
  var PAGES = {
    'predictions-home': { own: true },   // already done (the blueprint): only the top bar + pop-ups
    'predict':      { nav: 'predictions', on: '/predict', hero: { eyebrow: 'Premier League Predictions', title: 'Make Your Predictions', sub: 'Predict the scores. Climb the leaderboard.', art: 'card-predictions.jpg' }, hide: ['.hero-stadium'] },
    'leaderboard':  { nav: 'predictions', on: '/leaderboard', hero: { eyebrow: 'Premier League Predictions', title: 'Leaderboard', sub: 'Every player, ranked by total points.', art: 'card-predictions.jpg' }, hide: ['.lb-hero'] },
    'predictions-user-history': { nav: 'predictions', on: '/leaderboard', hero: { eyebrow: 'Premier League Predictions', title: 'Player History', sub: 'Every gameweek, every pick.', art: 'card-predictions.jpg' } },
    'lms':          { nav: 'lms', on: '/last-man-standing', hero: 'own' },
    'fantasy':      { nav: 'fantasy', on: '/fantasy-manager', hero: 'own', hide: ['.hero .fm-leaderboard-pill'] },
    'fantasy-leaderboard': { nav: 'fantasy', on: '/fantasy-leaderboard', hero: { eyebrow: 'Fantasy Manager', title: 'Leaderboard', sub: "Season total points. Captain's points are doubled.", art: 'card-fantasy.jpg' }, hide: ['.lb-hero'] },
    'fantasy-entry-history': { nav: 'fantasy', on: '/fantasy-leaderboard', hero: { eyebrow: 'Fantasy Manager', title: 'Entry History', sub: 'Every gameweek, every player.', art: 'card-fantasy.jpg' } },
    'player':       { nav: 'fantasy', on: '/fantasy-manager', hero: { eyebrow: 'Fantasy Manager', title: 'Player', sub: 'Form, fixtures and points.', art: 'card-fantasy.jpg' }, hide: ['main > .back-link'] },
    'stock':        { nav: 'stock', on: '/stock-market', hero: 'own', art: 'card-stockmarket.jpg', hide: ['.hero .hero-pill-link[href="/injuries"]'] },
    'stock-draft':  { nav: 'stock', on: '/stock-market-draft', hero: { eyebrow: 'Player Stock Market', title: 'Draft Your Squad', sub: 'Open a pack. Pick your 6.', art: 'card-stockmarket.jpg' }, hide: ['main > h1:first-of-type'] },
    'stock-history': { nav: 'stock', on: '/stock-market', hero: { eyebrow: 'Player Stock Market', title: 'Gameweek History', sub: 'Every player, every action.', art: 'card-stockmarket.jpg' }, hide: ['main > h1:first-of-type'] },
    'stock-player': { nav: 'stock', on: '/stock-market', hero: { eyebrow: 'Player Stock Market', title: 'Player History', sub: 'Week-by-week breakdown for this entrant.', art: 'card-stockmarket.jpg' } },
    'cl':           { nav: 'cl', on: '/champions-league', hero: 'own', hide: ['.cl-links'] },
    'cl-leaderboard': { nav: 'cl', on: '/champions-league-leaderboard', hero: { eyebrow: 'Champions League', title: 'Leaderboard', sub: 'Every entrant, ranked by total points.', art: 'card-champions-league-2.jpg' }, hide: ['.lb-hero'] },
    'cl-how':       { nav: 'cl', on: '/champions-league-how-it-works', hero: { eyebrow: 'Champions League', title: 'How It Works', sub: 'Pick Your Teams. Wisely.', art: 'card-champions-league-2.jpg' }, hide: ['.hiw-hero .hiw-badge', '.hiw-hero h1'] },
    'darts':        { nav: 'darts', on: '/darts', hero: 'own', hide: ['.hero .hero-leaderboard-pill'] },
    'darts-leaderboard': { nav: 'darts', on: '/darts-leaderboard', hero: { eyebrow: 'Darts', title: 'Leaderboard', sub: 'Every entrant, ranked by total bracket points.', art: 'card-darts.jpg' }, hide: ['.lb-hero'] },
    'fixtures':     { nav: 'football', on: '/fixtures', hero: { eyebrow: 'Premier League', title: 'Fixtures', sub: 'Every match, every gameweek.', art: 'card-predictions.jpg' }, hide: ['.page-hero'] },
    'table':        { nav: 'football', on: '/table', hero: { eyebrow: 'Premier League', title: 'League Table', sub: 'Live standings 2025/26.', art: 'card-predictions.jpg' }, hide: ['main > h1:first-of-type', 'main > h1:first-of-type + p'] },
    'injuries':     { nav: 'football', on: '/injuries', hero: { eyebrow: 'Premier League', title: 'Injury Updates', sub: "Who's out, doubtful or on the way back.", art: 'card-predictions.jpg' }, hide: ['main > h1:first-of-type', 'main > h1:first-of-type + p'] },
    'links':        { nav: 'football', on: '/links', hero: { eyebrow: 'Premier League', title: 'Club Links', sub: 'Official club websites for 2025/26.', art: 'card-predictions.jpg' }, hide: ['.clubs-header', 'aside.sidebar'] },
    'profile':      { nav: 'account', on: '/profile', hero: { eyebrow: 'Your Account', title: 'Profile', sub: 'Your picture, your tournaments, your stats.', art: 'hero-gb-app.jpg' } },
    'my-tournaments': { nav: 'account', on: '/my-tournaments', hero: { eyebrow: 'Your Account', title: 'My Tournaments', sub: "Every tournament you're entered in.", art: 'hero-gb-app.jpg' }, hide: ['main > h1:first-of-type', 'main > h1:first-of-type + .subtitle'] },
    'wallet':       { nav: 'account', on: '/wallet', hero: { eyebrow: 'Your Account', title: 'Wallet', sub: "Entry fees, payments and what's due.", art: 'hero-gb-app.jpg' }, hide: ['.wallet-hero'] },
    'tournaments':  { nav: 'account', on: '/tournaments', hero: { eyebrow: 'GB Hub', title: 'All Tournaments', sub: 'Every live tournament in one place.', art: 'hero-gb-tournaments.jpg' }, hide: ['main > h1:first-of-type', 'main > h1:first-of-type + .subtitle'] },
    'forum':        { nav: 'community', on: '/forum', hero: 'own' },
    'how-it-works': { nav: 'community', on: '/how-it-works', hero: { eyebrow: 'GB Hub', title: 'How It Works', sub: 'Compete. Predict. Win.', art: 'hero-gb-tournaments.jpg' }, hide: ['.hiw-hero .hiw-badge', '.hiw-hero h1'] }
  };
  var CFG = PAGES[KEY] || {};

  var BOARDS = [
    ['Score Predictions', '/leaderboard', 'card-predictions.jpg', 'Premier League'],
    ['Last Man Standing', '/last-man-standing#survivorsSection', 'card-lms.jpg', 'Premier League'],
    ['Fantasy Manager', '/fantasy-leaderboard', 'card-fantasy.jpg', 'Premier League'],
    ['Player Stock Market', '/stock-market', 'card-stockmarket.jpg', 'Premier League'],
    ['Champions League', '/champions-league-leaderboard', 'card-champions-league-2.jpg', 'Champions League'],
    ['World Grand Prix', '/darts-leaderboard', 'card-darts.jpg', 'Darts']
  ];

  // ---------- hide the old title bits straight away (no flash) ----------
  (function () {
    var css = '';
    (CFG.hide || []).forEach(function (s) { css += 'html[data-gbs] ' + s + '{display:none !important}'; });
    if (css) { var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st); }
  })();

  // ---------- helpers ----------
  var P = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    chart: '<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>',
    wallet: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16.5" cy="14.5" r="1.3"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 12 6 8z"/><path d="M9.5 17a2.5 2.5 0 0 0 5 0"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    user: '<circle cx="12" cy="8" r="3.3"/><path d="M5 20c0-3.6 3-6.2 7-6.2s7 2.6 7 6.2"/>',
    users: '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-5.6 6-5.6s6 2.3 6 5.6"/><path d="M16 5.5a3 3 0 0 1 0 5.6M18 14.6c1.8.6 3 2.3 3 4.4"/>',
    trophy: '<path d="M7 4h10v3a5 5 0 0 1-10 0V4z"/><path d="M7 5H4a3 3 0 0 0 3 3"/><path d="M17 5h3a3 3 0 0 1-3 3"/><path d="M12 12v3"/><path d="M9 19h6"/><path d="M10 16h4l1 3H9l1-3z"/>',
    ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z"/>',
    stats: '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>',
    box: '<path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/>',
    plus: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><path d="M12 7.5v.5"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M3 14h18M9 4v16"/>',
    shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z"/>',
    chat: '<path d="M4 5h16v10H9l-5 4V5z"/><path d="M8 9h8M8 12h5"/>',
    play: '<path d="M6 4l14 8-14 8V4z"/>',
    cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    arrow: '<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v8h14v-8"/><path d="M12 8v12"/><path d="M12 8c-2-3-6-3-6-1s4 1 6 1zM12 8c2-3 6-3 6-1s-4 1-6 1z"/>'
  };
  function ic(n, style) { return '<svg class="gbs-icon" viewBox="0 0 24 24"' + (style ? ' style="' + style + '"' : '') + '>' + (P[n] || '') + '</svg>'; }
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function token() { try { return localStorage.getItem('gbf_token'); } catch (e) { return null; } }
  function user() { try { return JSON.parse(localStorage.getItem('gbf_user') || 'null'); } catch (e) { return null; } }
  function money(p) { return '£' + (Math.abs(p || 0) / 100).toFixed(2); }
  function shortDate(s) { if (!s) return ''; var d = s.length === 10 ? new Date(s + 'T12:00:00') : new Date(s); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }
  var expired = false;
  async function getJSON(url) {
    try {
      var r = await fetch(url, token() ? { headers: { Authorization: 'Bearer ' + token() } } : undefined);
      if (r.status === 401) { expired = true; return null; }
      return r.ok ? await r.json() : null;
    } catch (e) { return null; }
  }
  function here() { return location.pathname + location.search; }
  function loginHref() { return '/login?redirect=' + encodeURIComponent(here()); }
  function samePage(href) {
    var p = href.split('#')[0];
    return p === location.pathname || p + '.html' === location.pathname;
  }

  // ---------- build ----------
  function build() {
    var body = document.body;
    var u = token() ? user() : null;
    var name = u ? (u.display_name || u.username || 'Account') : 'Log In';
    var photo = u && u.avatar_type === 'upload' && /^https:\/\//i.test(u.avatar_url || '') ? u.avatar_url : '';

    // top bar
    var bar = document.createElement('header');
    bar.className = 'gbs-topbar';
    bar.innerHTML =
      '<a href="' + HUB_URL + '" class="gbs-logo"><div class="gbs-logo-mark">' + ic('trophy', 'width:19px;height:19px') + '</div><div class="gbs-logo-text">GB HUB<small>CLICK HERE</small></div></a>' +
      '<a class="gbs-me" href="' + (u ? '/profile' : loginHref()) + '" title="' + (u ? 'Your profile' : 'Log in') + '"><div class="gbs-avatar">' +
        (u ? esc(name.substring(0, 2).toUpperCase()) + (photo ? '<img src="' + esc(photo) + '" alt="" onerror="this.remove()">' : '') : ic('user', 'width:16px;height:16px')) +
        '</div><span class="gbs-me-name">' + esc(name) + '</span></a>' +
      '<a class="gbs-ibtn" id="gbsWalletBtn" href="/wallet" title="Wallet">' + ic('wallet') + '</a>' +
      '<button type="button" class="gbs-ibtn" id="gbsBellBtn" title="Notifications">' + ic('bell') + '<span class="gbs-dot" id="gbsBellDot"></span></button>' +
      '<a class="gbs-forum' + (location.pathname.indexOf('/forum') === 0 ? ' on' : '') + '" href="/forum" title="Forum">Forum</a>' +
      '<button type="button" class="gbs-ibtn" id="gbsMenuBtn" title="Menu">' + ic('menu') + '</button>';
    body.insertBefore(bar, body.firstChild);

    // hero + tabs
    if (!CFG.own) {
      var top = document.createElement('div');
      top.className = 'gbs-top';
      var oldHeader = document.querySelector('body > header.navbar, body > nav.navbar, body > header.hub-navbar');
      if (CFG.hero === 'own') {
        var h = document.querySelector('.hero');
        if (h) {
          top.appendChild(h);
          if (CFG.art) {
            h.classList.add('gbs-restyle');
            var art = document.createElement('div');
            art.className = 'gbs-hero-art';
            art.style.backgroundImage = "url('" + A + CFG.art + "')";
            h.insertBefore(art, h.firstChild);
          }
        }
      } else if (CFG.hero) {
        var hero = document.createElement('section');
        hero.className = 'gbs-hero';
        hero.innerHTML = (CFG.hero.art ? '<div class="gbs-hero-art" style="background-image:url(\'' + A + CFG.hero.art + '\')"></div>' : '') +
          '<div class="gbs-hero-body"><div class="gbs-eyebrow"><i></i>' + esc(CFG.hero.eyebrow) + '</div><h1 class="gbs-title">' + esc(CFG.hero.title) + '</h1><div class="gbs-sub">' + esc(CFG.hero.sub) + '</div></div>';
        top.appendChild(hero);
      }
      var tabs = NAV[CFG.nav] || [], nav = null;
      if (tabs.length) {
        nav = document.createElement('nav');
        nav.className = 'gbs-tabs';
        nav.style.setProperty('--gbs-n', tabs.length);
        nav.innerHTML = tabs.map(function (t) {
          return '<a class="gbs-tab' + (t[1] === CFG.on ? ' on' : '') + '" href="' + t[1] + '">' + ic(t[2]) + '<span>' + esc(t[0]) + '</span></a>';
        }).join('');
      }
      // the tab bar sits straight in <body> (not inside the hero block) so it can stick under the top bar while scrolling
      var after = oldHeader && oldHeader.parentNode === body ? oldHeader : bar;
      body.insertBefore(top, after.nextSibling);
      if (nav) body.insertBefore(nav, top.nextSibling);
    }

    // phone bottom bar (the Predictions page already has its own)
    if (!document.getElementById('prBottomBar')) {
      var bb = document.createElement('nav');
      bb.className = 'gbs-bottombar';
      bb.innerHTML =
        '<a class="gbs-bb" href="' + HUB_URL + '">' + ic('home') + 'Home</a>' +
        '<a class="gbs-bb" href="' + HUB_URL + '?go=all">' + ic('grid') + 'Tournaments</a>' +
        '<button type="button" class="gbs-bb" id="gbsLeadersTab">' + ic('chart') + 'Leaders</button>' +
        '<a class="gbs-bb" id="gbsWalletTab" href="/wallet">' + ic('wallet') + 'Wallet</a>';
      body.appendChild(bb);
    }

    // scrim, menu, pop-ups
    var extra = document.createElement('div');
    extra.innerHTML =
      '<div class="gbs-scrim" id="gbsScrim"></div>' +
      '<nav class="gbs-drawer" id="gbsDrawer" aria-label="Menu">' +
        '<div class="gbs-drawer-head"><div class="gbs-logo-text">MENU</div><button type="button" class="gbs-ibtn" data-gbs-close title="Close">' + ic('close') + '</button></div>' +
        '<a href="' + HUB_URL + '">' + ic('home') + 'GB Hub</a>' +
        '<a href="/my-tournaments">' + ic('trophy') + 'My Tournaments</a>' +
        '<a href="/tournaments">' + ic('grid') + 'All Tournaments</a>' +
        '<a href="/fixtures">' + ic('ball') + 'Prem Fixtures</a>' +
        '<a href="/table">' + ic('table') + 'League Table</a>' +
        '<a href="/injuries">' + ic('plus') + 'Injuries</a>' +
        '<a href="/wallet">' + ic('wallet') + 'Wallet</a>' +
        '<a href="/how-it-works">' + ic('play') + 'How It Works</a>' +
        '<a href="/forum">' + ic('chat') + 'Forum</a>' +
        (u && u.is_admin ? '<a href="/admin">' + ic('cog') + 'Admin</a>' : '') +
        '<div class="gbs-drawer-label">Leaderboards</div>' +
        BOARDS.map(function (b) { return '<a href="' + b[1] + '">' + ic('chart') + esc(b[0]) + '</a>'; }).join('') +
        (u ? '<a href="#" class="danger" id="gbsLogout">' + ic('close') + 'Log Out</a>' : '<a href="' + loginHref() + '">' + ic('user') + 'Log In</a>') +
      '</nav>' +
      pop('wallet', 'Wallet', 'gbsWalletBody') + pop('notif', 'Notifications', 'gbsNotifBody', 'bell') + pop('leaders', 'Leaderboards', 'gbsLeadersBody', 'chart');
    while (extra.firstChild) body.appendChild(extra.firstChild);
    document.getElementById('gbsLeadersBody').innerHTML = BOARDS.map(function (b) {
      return '<a class="gbs-board" href="' + b[1] + '"><img src="' + A + b[2] + '" alt=""><div><b>' + esc(b[0]) + '</b><span>' + esc(b[3]) + '</span></div></a>';
    }).join('');

    wire();
    if (token()) loadNotifs();
  }
  function pop(id, title, bodyId, icon) {
    return '<div class="gbs-pop" id="gbsPop-' + id + '" role="dialog" aria-label="' + title + '"><div class="gbs-pop-head"><h3>' + ic(icon || id) + title + '</h3>' +
      '<button type="button" class="gbs-ibtn" data-gbs-close title="Close">' + ic('close') + '</button></div><div class="gbs-pop-body" id="' + bodyId + '"><div class="gbs-empty">Loading…</div></div></div>';
  }

  // ---------- open / close ----------
  var OPEN = null;
  function openPanel(which) {
    OPEN = which;
    ['wallet', 'notif', 'leaders'].forEach(function (k) { var el = document.getElementById('gbsPop-' + k); if (el) el.classList.toggle('open', which === k); });
    document.getElementById('gbsDrawer').classList.toggle('open', which === 'menu');
    document.getElementById('gbsScrim').classList.toggle('open', !!which);
    var set = function (id, on) { var el = document.getElementById(id); if (el) el.classList.toggle('on', on); };
    set('gbsWalletBtn', which === 'wallet'); set('gbsBellBtn', which === 'notif'); set('gbsWalletTab', which === 'wallet'); set('gbsLeadersTab', which === 'leaders');
    if (which === 'wallet') loadWallet();
    if (which === 'notif') loadNotifs();
  }
  function toggle(which) { openPanel(OPEN === which ? null : which); }
  function wire() {
    document.getElementById('gbsWalletBtn').addEventListener('click', function (e) { e.preventDefault(); toggle('wallet'); });
    document.getElementById('gbsBellBtn').addEventListener('click', function () { toggle('notif'); });
    document.getElementById('gbsMenuBtn').addEventListener('click', function () { toggle('menu'); });
    var wt = document.getElementById('gbsWalletTab'); if (wt) wt.addEventListener('click', function (e) { e.preventDefault(); toggle('wallet'); });
    var lt = document.getElementById('gbsLeadersTab'); if (lt) lt.addEventListener('click', function () { toggle('leaders'); });
    // the Predictions page's own bottom bar: its Wallet button opens the pop-up too
    document.querySelectorAll('#prBottomBar a[href="/wallet"]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); toggle('wallet'); }); });
    document.getElementById('gbsScrim').addEventListener('click', function () { openPanel(null); });
    document.querySelectorAll('[data-gbs-close]').forEach(function (b) { b.addEventListener('click', function () { openPanel(null); }); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && OPEN) openPanel(null); });
    var lo = document.getElementById('gbsLogout');
    if (lo) lo.addEventListener('click', function (e) {
      e.preventDefault();
      ['gbf_token', 'gbf_refresh', 'gbf_user'].forEach(function (k) { try { localStorage.removeItem(k); } catch (_) {} });
      location.href = '/';
    });
    // tabs that point at a section of this same page just scroll to it
    document.querySelectorAll('.gbs-tab[href*="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        var href = a.getAttribute('href');
        var el = document.getElementById(href.split('#')[1]);
        if (!el && !samePage(href)) return;   // section is on another page: just go there
        if (!el) return;
        e.preventDefault();
        if (el.offsetParent !== null) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
        // section not showing yet (tournament not started / not entered): say so on the tab for a moment
        var sp = a.querySelector('span'), was = sp.textContent;
        if (a.dataset.busy) return; a.dataset.busy = '1';
        sp.textContent = 'Shows once it starts';
        setTimeout(function () { sp.textContent = was; delete a.dataset.busy; }, 2200);
      });
    });
    document.getElementById('gbsWalletBody').addEventListener('click', async function (e) {
      var btn = e.target.closest('.gbs-copy'); if (!btn) return;
      var v = btn.getAttribute('data-copy');
      try { await navigator.clipboard.writeText(v); }
      catch (err) { var ta = document.createElement('textarea'); ta.value = v; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (x) {} ta.remove(); }
      var em = btn.querySelector('em'); btn.classList.add('copied'); em.textContent = 'Copied';
      setTimeout(function () { btn.classList.remove('copied'); em.textContent = 'Copy'; }, 1500);
    });
  }

  // ---------- wallet pop-up (same as the Hub) ----------
  function loggedOut(what) { return '<div class="gbs-empty">Log in to see your ' + what + '.</div><a class="gbs-btn" href="' + loginHref() + '">Log In</a>'; }
  async function loadWallet() {
    var body = document.getElementById('gbsWalletBody');
    if (!token()) { body.innerHTML = loggedOut('wallet'); return; }
    var d = await getJSON('/api/tournaments?wallet=true');
    if (!d) { body.innerHTML = expired ? loggedOut('wallet') : '<div class="gbs-empty">Couldn\'t load your wallet right now.</div><a class="gbs-btn" href="/wallet">Open Wallet</a>'; return; }
    var owed = d.owed || 0, list = d.tournaments || [];
    var rank = { overdue: 0, due: 1, paid_late: 2, paid: 2 }, far = '9999-12-31';
    var sorted = list.slice().sort(function (a, b) {
      return (rank[a.status] - rank[b.status]) ||
        ((a.status === 'overdue' || a.status === 'due') ? (a.payment_due_date || far).localeCompare(b.payment_due_date || far) : (b.last_paid_at || '').localeCompare(a.last_paid_at || ''));
    });
    var overdue = list.filter(function (t) { return t.status === 'overdue'; }).reduce(function (s, t) { return s + t.balance; }, 0);
    var next = list.filter(function (t) { return t.status === 'due' && t.payment_due_date; }).sort(function (a, b) { return a.payment_due_date.localeCompare(b.payment_due_date); })[0];
    var big = owed > 0 ? '<small>You owe</small><b class="owed">' + money(owed) + '</b>'
            : owed < 0 ? '<small>In credit</small><b class="clear">' + money(owed) + '</b>'
            : '<small>Balance</small><b class="clear">£0.00</b>';
    var right = next ? '<div class="gbs-wp-next">Next due<span>' + shortDate(next.payment_due_date) + ' · ' + money(next.balance) + '</span></div>'
              : (owed <= 0 ? '<div class="gbs-wp-next"><span style="color:var(--gbs-green)">All paid up</span></div>' : '');
    var chip = function (t) {
      return t.status === 'paid' ? '<span class="gbs-chip paid">Paid</span>'
        : t.status === 'paid_late' ? '<span class="gbs-chip paid_late">Paid late</span>'
        : t.status === 'overdue' ? '<span class="gbs-chip overdue">Overdue</span>'
        : '<span class="gbs-chip due">' + (t.payment_due_date ? 'Due ' + shortDate(t.payment_due_date) : 'To pay') + '</span>';
    };
    var rows = sorted.slice(0, 6).map(function (t) {
      var paid = t.status === 'paid' || t.status === 'paid_late';
      return '<div class="gbs-wp-row"><span class="n">' + esc(t.name) + '</span>' + chip(t) + '<span class="a">' + money(paid ? t.fee : t.balance) + '</span></div>';
    }).join('');
    var b = d.bank_details;
    var cp = function (label, val, copyVal) { return val ? '<button type="button" class="gbs-copy" data-copy="' + esc(copyVal || val) + '"><small>' + label + '<em>Copy</em></small><span>' + esc(val) + '</span></button>' : ''; };
    var pay = (b && owed > 0) ? '<div class="gbs-wp-pay"><div class="gbs-label" style="margin-top:0">Pay by bank transfer</div><div class="gbs-wp-grid">' +
        cp('Name', b.account_name) + cp('Sort code', b.sort_code, (b.sort_code || '').replace(/-/g, '')) + cp('Account no.', b.account_number) + cp('Reference', b.reference) + '</div>' +
        '<div class="gbs-hint">Always use <b style="color:var(--gbs-accent-2)">' + esc(b.reference || 'your username') + '</b> as the reference so your payment is matched to you.</div></div>' : '';
    body.innerHTML = '<div class="gbs-wp-owe"><div>' + big + '</div>' + right + '</div>' +
      (overdue > 0 ? '<div class="gbs-wp-over">⚠ ' + money(overdue) + ' overdue — please pay as soon as you can</div>' : '') +
      (rows ? '<div class="gbs-label">Your tournaments</div>' + rows : '<div class="gbs-empty" style="padding:14px">No paid tournaments yet.</div>') +
      pay + '<a class="gbs-btn" href="/wallet">Open Full Wallet ' + ic('arrow') + '</a>';
  }

  // ---------- notifications pop-up (same as the Hub) ----------
  async function loadNotifs() {
    var body = document.getElementById('gbsNotifBody'), dot = document.getElementById('gbsBellDot');
    if (!token()) { body.innerHTML = loggedOut('notifications'); dot.style.display = 'none'; return; }
    var d = await getJSON('/api/tournaments?notifications=true');
    if (!d) { body.innerHTML = expired ? loggedOut('notifications') : '<div class="gbs-empty">Couldn\'t load notifications right now.</div>'; return; }
    var admin = d.admin_messages || [], actions = d.action_items || [];
    dot.style.display = (admin.length + actions.length) ? 'block' : 'none';
    if (!admin.length && !actions.length) { body.innerHTML = '<div class="gbs-empty">You\'re all caught up! 🎉</div>'; return; }
    body.innerHTML = admin.map(function (m) { return '<div class="gbs-np admin severity-' + esc(m.severity || 'info') + '"><div class="t">📣 Announcement</div><div class="m">' + esc(m.message) + '</div></div>'; }).join('') +
      actions.map(function (a) { return '<a class="gbs-np action" href="' + esc(a.href || '#') + '"><div class="t">⚠ Action Needed</div><div class="m">' + esc(a.message) + '</div></a>'; }).join('');
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();

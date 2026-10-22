// GB Hub - move players from the old address to www.gbhub.live, keeping them logged in.
//
// Loaded first in <head> on every page.
//  - On tournaments-hub-pl.vercel.app it forwards to the same page on
//    www.gbhub.live, passing the saved login across (after the "#", so it is
//    never sent to any server).
//  - On gbhub.live it picks that login up, saves it, and tidies the address bar.
//
// FORWARD_ON = false  -> nobody is forwarded, EXCEPT a test visit to the old
//                        address with ?gbmove=1 on the end (e.g.
//                        https://tournaments-hub-pl.vercel.app/?gbmove=1)
// FORWARD_ON = true   -> everyone on the old address is forwarded.
(function () {
  var FORWARD_ON = true;
  var OLD_HOST = 'tournaments-hub-pl.vercel.app';
  var NEW_ORIGIN = 'https://www.gbhub.live';

  function b64encode(str) { return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function b64decode(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return decodeURIComponent(escape(atob(str))); }

  try {
    var host = location.hostname;

    // ---------- receiving end (gbhub.live) ----------
    if (/(^|\.)gbhub\.live$/.test(host) && location.hash.indexOf('gbmove=') !== -1) {
      var hp = new URLSearchParams(location.hash.slice(1));
      var payload = hp.get('gbmove'), origHash = hp.get('gbhash') || '';
      try {
        var data = JSON.parse(b64decode(payload));
        // Only use the login brought across if there is NO login saved here yet.
        // A login carried over from the old address is frozen at the day of the
        // move (10 Oct), so it must never replace a newer one saved here -
        // doing that is what kept logging people out (the old renewal key gets
        // used again and Supabase cancels the login as "stolen").
        var hasLoginHere = !!(localStorage.getItem('gbf_refresh') || localStorage.getItem('gbf_token'));
        if (data && data.gbf_token && !hasLoginHere) {
          Object.keys(data).forEach(function (k) { if (k.indexOf('gbf_') === 0 && typeof data[k] === 'string') localStorage.setItem(k, data[k]); });
        }
      } catch (e) { /* bad or partial link - just carry on, they can log in normally */ }
      history.replaceState(null, '', location.pathname + location.search + origHash);
      return;
    }

    // ---------- sending end (old address) ----------
    if (host === OLD_HOST) {
      var params = new URLSearchParams(location.search);
      var testVisit = params.get('gbmove') === '1';
      if (!FORWARD_ON && !testVisit) return;
      params.delete('gbmove');
      var qs = params.toString();
      var target = NEW_ORIGIN + location.pathname + (qs ? '?' + qs : '');
      var bundle = {};
      for (var i = 0; i < localStorage.length; i++) {
        var key = localStorage.key(i);
        if (key && key.indexOf('gbf_') === 0) bundle[key] = localStorage.getItem(key);
      }
      if (bundle.gbf_token) {
        target += '#gbmove=' + b64encode(JSON.stringify(bundle)) + (location.hash ? '&gbhash=' + encodeURIComponent(location.hash) : '');
        // Carry it across once, then forget it here, so an old bookmark or
        // home-screen icon can't keep sending the same out-of-date login.
        Object.keys(bundle).forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      } else if (location.hash) {
        target += location.hash;
      }
      location.replace(target);
    }
  } catch (e) { /* never block the page */ }
})();

// GB Hub - keep people logged in, on every page.
//
// A login is a short "pass" (gbf_token, lasts about an hour) plus a "renewal
// key" (gbf_refresh). Each renewal gives a NEW key and the old one stops
// working; if an old key is ever used again, Supabase treats it as stolen and
// logs the person out for good. That used to happen a lot, because three
// different scripts renewed the login - one on every page load and every 10
// minutes - so a renewal was often cut off half way (tapping to another page,
// closing the browser) and the new key was never saved.
//
// Now there is ONE renewal, here, for the whole site:
//  - only when the pass is about to run out (or already has)
//  - one at a time, even across several open tabs
//  - never while the tab is hidden
//  - any call to our own /api/ that is about to use an expired pass waits for
//    the renewal and goes out with the new pass; a "401 expired" reply is
//    renewed and tried once more - so every page stays logged in.
(function () {
  if (location.hostname === 'tournaments-hub-pl.vercel.app') return;   // that address just forwards to gbhub.live
  var SB_URL = 'https://liuuzvboeesimvovnooh.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXV6dmJvZWVzaW12b3Zub29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTA1MjYsImV4cCI6MjA5ODc2NjUyNn0.rfV-5DZ-06GIQ5vJcT0rCzmruSjXdCOP__XhhPv7jDs';
  var RENEW_BEFORE = 300;            // renew when under 5 minutes left
  var OLD_SB_KEY = 'sb-liuuzvboeesimvovnooh-auth-token';
  var realFetch = window.fetch ? window.fetch.bind(window) : null;
  var inflight = null, deadKey = null;

  function get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  // The phone's clock can be wrong; remember how far out it was at the last renewal.
  function skew() { var s = Number(get('gbf_clock_skew')); return isFinite(s) ? s : 0; }
  function claims(tok) {
    try { return JSON.parse(atob(String(tok).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; }
  }
  function secsLeftOf(tok) { var c = claims(tok); return c && c.exp ? c.exp - (Date.now() / 1000 + skew()) : -1; }
  function secsLeft() { var t = get('gbf_token'); return t ? secsLeftOf(t) : -1; }
  function hidden() { return document.visibilityState === 'hidden'; }

  // The leftover copy from the very old setup only ever holds a used-up key
  // now, and trying a used-up key is exactly what gets a login cancelled.
  try { localStorage.removeItem(OLD_SB_KEY); } catch (e) {}

  function callRenew() {
    var key = get('gbf_refresh');
    if (!key || key === deadKey || !realFetch) return Promise.resolve(false);
    return realFetch(SB_URL + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: key })
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (r.ok && d && d.access_token && d.refresh_token) {
          set('gbf_token', d.access_token);
          set('gbf_refresh', d.refresh_token);
          var c = claims(d.access_token);
          if (c && c.iat) set('gbf_clock_skew', String(Math.round(c.iat - Date.now() / 1000)));
          return true;
        }
        // Another tab may have renewed it a moment ago - use theirs.
        if (get('gbf_refresh') !== key) return secsLeft() > 60;
        // The key really is no good: don't keep trying it from this page.
        if (r.status >= 400 && r.status < 500) deadKey = key;
        return false;
      });
    }).catch(function () { return false; });   // no signal - keep everything, try again later
  }

  // Renew if needed. Resolves true when there is a usable pass afterwards.
  function renew() {
    if (!get('gbf_refresh')) return Promise.resolve(secsLeft() > 0);
    if (get('gbf_token') && secsLeft() > RENEW_BEFORE) return Promise.resolve(true);
    if (inflight) return inflight;
    var job = function () {
      // waited for another tab? it may have just renewed
      if (get('gbf_token') && secsLeft() > RENEW_BEFORE) return true;
      return callRenew();
    };
    var p = (navigator.locks && navigator.locks.request)
      ? navigator.locks.request('gbf-renew-login', job)
      : Promise.resolve().then(job);
    inflight = Promise.resolve(p).then(function (ok) { inflight = null; return !!ok; }, function () { inflight = null; return false; });
    return inflight;
  }

  window.gbAuth = { renew: renew, secsLeft: secsLeft };

  // ---- calls to our own /api/ use a fresh pass ----
  function authOf(init) {
    var h = init && init.headers;
    if (!h) return null;
    if (typeof Headers !== 'undefined' && h instanceof Headers) return h.get('Authorization');
    if (Array.isArray(h)) { for (var i = 0; i < h.length; i++) if (String(h[i][0]).toLowerCase() === 'authorization') return h[i][1]; return null; }
    for (var k in h) if (k.toLowerCase() === 'authorization') return h[k];
    return null;
  }
  function withAuth(init, tok) {
    var out = {}; for (var k in init) out[k] = init[k];
    var h = init.headers, v = 'Bearer ' + tok;
    if (typeof Headers !== 'undefined' && h instanceof Headers) { h = new Headers(h); h.set('Authorization', v); }
    else if (Array.isArray(h)) { h = h.map(function (p) { return String(p[0]).toLowerCase() === 'authorization' ? [p[0], v] : p; }); }
    else { var n = {}; for (var j in h) if (j.toLowerCase() !== 'authorization') n[j] = h[j]; n.Authorization = v; h = n; }
    out.headers = h;
    return out;
  }
  if (realFetch) {
    window.fetch = function (input, init) {
      var sent;
      try {
        if (typeof input !== 'string' && !(input instanceof URL)) return realFetch(input, init);
        var u = new URL(String(input), location.href);
        if (u.origin !== location.origin || u.pathname.indexOf('/api/') !== 0) return realFetch(input, init);
        var a = authOf(init);
        if (!a || !/^Bearer\s+/i.test(a)) return realFetch(input, init);
        sent = a.replace(/^Bearer\s+/i, '');
        if (!sent || sent === 'null' || sent === 'undefined') return realFetch(input, init);
      } catch (e) { return realFetch(input, init); }
      // only touch a pass that has (nearly) run out - never a valid one
      if (secsLeftOf(sent) > 60) return realFetch(input, init);
      return renew().then(function () {
        var now = get('gbf_token');
        var go = (now && now !== sent) ? withAuth(init, now) : init;
        return realFetch(input, go).then(function (r) {
          if (r.status !== 401) return r;
          return renew().then(function (ok) {
            var again = get('gbf_token');
            return (ok && again && again !== now) ? realFetch(input, withAuth(init, again)) : r;
          });
        });
      });
    };
  }

  // ---- renew on load, when the page comes back on screen, and while it's open ----
  function check() { if (!hidden() && get('gbf_refresh') && (!get('gbf_token') || secsLeft() < RENEW_BEFORE)) renew(); }
  check();
  document.addEventListener('visibilitychange', check);
  window.addEventListener('pageshow', check);
  setInterval(check, 60 * 1000);     // just reads the saved pass; only calls out when it's nearly up
})();

// ---- Clean-up: the Android "share a bet to GB Hub" app helper was removed.
// Any phone that picked it up drops it again, so pages load exactly as before.
(function () {
  try {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(function (rs) { rs.forEach(function (r) { r.unregister(); }); }).catch(function () {});
    if (window.caches) caches.delete('gb-shared-bet').catch(function () {});
  } catch (e) {}
})();

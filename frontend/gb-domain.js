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
        var existing = localStorage.getItem('gbf_token');
        var existingUser = null, incomingUser = null;
        try { existingUser = JSON.parse(localStorage.getItem('gbf_user') || 'null'); } catch (e) {}
        try { incomingUser = JSON.parse(data.gbf_user || 'null'); } catch (e) {}
        // Don't replace someone who is already logged in here as a different person
        var sameOrEmpty = !existing || (existingUser && incomingUser && existingUser.id === incomingUser.id);
        if (data && data.gbf_token && sameOrEmpty) {
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
      } else if (location.hash) {
        target += location.hash;
      }
      location.replace(target);
    }
  } catch (e) { /* never block the page */ }
})();

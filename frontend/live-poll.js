// live-poll.js — shared background refresh, included on every page that
// matters (Hub, Predictions, Fantasy Manager, Tournaments, Leaderboard).
//
// While a logged-in user has any of these pages open, this quietly keeps
// the shared PL data fresh every 2 minutes:
//   - /api/live-scores   -> match scores/status, recalculates prediction points
//   - /api/sync-players  -> player points (season total + this gameweek)
//
// Both write to the shared master data, so ANY user with ANY of these
// pages open keeps things fresh for EVERYONE, not just themselves.
// No server cron needed — same trade-off the app already relied on before
// this file existed, just consolidated into one place instead of being
// duplicated (inconsistently) per page.

(function () {
  const POLL_INTERVAL_MS = 120000; // 2 minutes
  let pollTimer = null;

  async function pollAll() {
    const token = localStorage.getItem('gbf_token');
    if (!token) return; // only poll while logged in

    try {
      await fetch('/api/live-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
    } catch (e) {
      console.error('[live-poll] live-scores refresh failed:', e);
    }

    try {
      await fetch('/api/sync-players');
    } catch (e) {
      console.error('[live-poll] player sync failed:', e);
    }

    console.log('[live-poll] Refreshed shared PL data');
    // Let the page react to fresh data if it wants to (e.g. re-render
    // without a full reload) by listening for this event.
    window.dispatchEvent(new CustomEvent('gbf-data-refreshed'));
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    pollAll(); // immediate first run
    pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
  }

  function stop() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // Only start if logged in; if the user logs in/out later without a full
  // page reload, other scripts can call window.gbfLivePoll.start()/stop().
  if (localStorage.getItem('gbf_token')) {
    start();
  }

  window.gbfLivePoll = { start, stop };
})();

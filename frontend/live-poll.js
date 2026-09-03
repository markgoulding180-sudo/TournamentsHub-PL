// live-poll.js — shared background refresh, included on every page that
// matters (Hub, Predictions, Fantasy Manager, Tournaments, Leaderboard).
//
// Two things happen here, both while a logged-in user has any of these
// pages open:
//
// 1. Data refresh, every 2 minutes:
//   - /api/live-scores    -> match scores/status, recalculates prediction points
//   - /api/sync-players   -> player points (season total + this gameweek)
//   - /api/sync-fixtures  -> fixture schedule itself (postponements, kickoff
//     time changes) — FPL is the sole source of truth here, so whatever it
//     corrects on its end now self-corrects on ours automatically too
//   - /api/tournaments (action: sync_current_gameweek_stats) -> Stock
//     Market's per-gameweek player stats (goals/assists/cards THIS
//     gameweek specifically). Server-side debounces this to once per ~90
//     seconds regardless of how many users are polling at once, so many
//     concurrent visitors don't each independently hammer FPL's API for
//     the same data.
//   - /api/tournaments (action: cl_sync) -> Champions League fixtures/teams
//     from football-data.org (separate provider, separate schema,
//     structurally unreachable from everything else here), plus
//     auto-scoring any newly-finished match. Consolidated into this
//     shared action rather than its own file, to stay within Vercel
//     Hobby's 12-function cap.
//   All five write to the shared master data, so ANY user with ANY of
//   these pages open keeps things fresh for EVERYONE, not just themselves.
//   None of this can ever touch predictions.predictions — an entirely
//   separate database schema, structurally unreachable by anything here.
//
// 2. Session refresh, every 10 minutes:
//   Supabase login tokens expire (usually after ~1 hour). Previously only
//   a couple of pages tried to renew this, only once on page load, so any
//   session running longer than that eventually broke with "Invalid or
//   expired token". This renews it proactively, repeatedly, on every page.

const SUPABASE_URL = 'https://liuuzvboeesimvovnooh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXV6dmJvZWVzaW12b3Zub29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTA1MjYsImV4cCI6MjA5ODc2NjUyNn0.rfV-5DZ-06GIQ5vJcT0rCzmruSjXdCOP__XhhPv7jDs';

(function () {
  const POLL_INTERVAL_MS = 120000;    // 2 minutes — data refresh
  const REFRESH_INTERVAL_MS = 600000; // 10 minutes — session refresh (well under the ~1hr expiry)
  let pollTimer = null;
  let refreshTimer = null;
  let supabaseClient = null;

  function getClient() {
    if (supabaseClient) return supabaseClient;
    if (typeof window !== 'undefined' && window.supabase) {
      supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
    return supabaseClient;
  }

  async function refreshSessionToken() {
    const refreshToken = localStorage.getItem('gbf_refresh');
    if (!refreshToken) return;

    const client = getClient();
    if (!client) {
      console.warn('[live-poll] supabase-js not loaded on this page — cannot refresh session');
      return;
    }

    try {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data?.session) {
        console.warn('[live-poll] Session refresh failed:', error?.message);
        return;
      }
      localStorage.setItem('gbf_token', data.session.access_token);
      localStorage.setItem('gbf_refresh', data.session.refresh_token);
      console.log('[live-poll] Session token refreshed');
    } catch (e) {
      console.error('[live-poll] Session refresh error:', e);
    }
  }

  async function pollAll() {
    const token = localStorage.getItem('gbf_token');
    if (!token) return; // only poll while logged in

    try {
      const liveScoresResponse = await fetch('/api/live-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      const liveScoresData = await liveScoresResponse.json();
      if (liveScoresResponse.ok) {
        console.log('[live-poll] live-scores refresh:', liveScoresData);
      } else {
        console.error('[live-poll] live-scores refresh failed:', liveScoresResponse.status, liveScoresData);
      }
    } catch (e) {
      console.error('[live-poll] live-scores refresh failed:', e);
    }

    try {
      await fetch('/api/sync-players');
    } catch (e) {
      console.error('[live-poll] player sync failed:', e);
    }

    try {
      await fetch('/api/sync-fixtures?poll=true');
    } catch (e) {
      console.error('[live-poll] fixtures sync failed:', e);
    }

    try {
      const token = localStorage.getItem('gbf_token');
      const clResponse = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'cl_sync' })
      });
      const clData = await clResponse.json();
      // Real fix: fetch() only throws on genuine network failures, never
      // on HTTP error status codes - a 500/502 response was silently
      // passing through here uncaught, so the actual error was only ever
      // visible via the browser's own separate network logging, never
      // this file's own console output. Checking response.ok explicitly
      // and logging either way gives real, reliable visibility instead.
      if (clResponse.ok) {
        console.log('[live-poll] Champions League sync:', clData);
      } else {
        console.error('[live-poll] Champions League sync failed:', clResponse.status, clData);
      }
    } catch (e) {
      console.error('[live-poll] Champions League sync failed:', e);
    }

    try {
      const token = localStorage.getItem('gbf_token');
      const smResponse = await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'stockmarket_check_deadline' })
      });
      const smData = await smResponse.json();
      // Real fix: the drafting-to-live transition used to only ever fire
      // when someone specifically visited the Stock Market page itself -
      // confirmed as a real, live problem (a real match kicked off, but
      // the tournament sat stuck in drafting since nobody happened to
      // load that specific page for a while). Now runs automatically on
      // any page, same as everything else here.
      if (smResponse.ok) {
        console.log('[live-poll] Stock Market deadline check:', smData);
      } else {
        console.error('[live-poll] Stock Market deadline check failed:', smResponse.status, smData);
      }
    } catch (e) {
      console.error('[live-poll] Stock Market deadline check failed:', e);
    }

    try {
      const token = localStorage.getItem('gbf_token');
      await fetch('/api/tournaments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ action: 'sync_current_gameweek_stats' })
      });
    } catch (e) {
      console.error('[live-poll] Stock Market gameweek stats sync failed:', e);
    }

    console.log('[live-poll] Refreshed shared PL data');
    // Let the page react to fresh data if it wants to (e.g. re-render
    // without a full reload) by listening for this event.
    window.dispatchEvent(new CustomEvent('gbf-data-refreshed'));
  }

  function start() {
    if (pollTimer) clearInterval(pollTimer);
    if (refreshTimer) clearInterval(refreshTimer);

    pollAll(); // immediate first run
    refreshSessionToken(); // immediate first refresh too

    pollTimer = setInterval(pollAll, POLL_INTERVAL_MS);
    refreshTimer = setInterval(refreshSessionToken, REFRESH_INTERVAL_MS);
  }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
  }

  // Only start if logged in; if the user logs in/out later without a full
  // page reload, other scripts can call window.gbfLivePoll.start()/stop().
  if (localStorage.getItem('gbf_token')) {
    start();
  }

  window.gbfLivePoll = { start, stop };
})();

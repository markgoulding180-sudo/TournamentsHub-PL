// GB Fantasy - Main JavaScript
// Premier League Prediction Website

// API Base URL - Vercel API Routes
const API_BASE = '/api';

// Supabase client configuration (public anon key - safe for frontend)
const SUPABASE_URL = 'https://liuuzvboeesimvovnooh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpdXV6dmJvZWVzaW12b3Zub29oIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMxOTA1MjYsImV4cCI6MjA5ODc2NjUyNn0.rfV-5DZ-06GIQ5vJcT0rCzmruSjXdCOP__XhhPv7jDs';

// Initialize Supabase client - only if not already defined
if (typeof supabase === 'undefined') {
  var supabase = null;
  if (typeof window !== 'undefined' && window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}

// Auth state
let currentUser = null;
let authToken = localStorage.getItem('gbf_token') || null;

// Frontend polling interval (2 minutes)
let liveScoresPollInterval = null;
const POLL_INTERVAL_MS = 120000; // 2 minutes

// Load user from localStorage on startup
const storedUser = localStorage.getItem('gbf_user');
if (storedUser) {
  try {
    currentUser = JSON.parse(storedUser);
  } catch (e) {
    console.error('Failed to parse stored user:', e);
  }
}

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
  initApp();
});

async function initApp() {
  // Refresh token client-side using Supabase - no API endpoint needed
  const refreshToken = localStorage.getItem('gbf_refresh');
  if (refreshToken && supabase && supabase.auth) {
    try {
      const { data, error } = await supabase.auth.refreshSession({ 
        refresh_token: refreshToken 
      });
      if (data?.session) {
        localStorage.setItem('gbf_token', data.session.access_token);
        localStorage.setItem('gbf_refresh', data.session.refresh_token);
        authToken = data.session.access_token;
        console.log('Token refreshed successfully');
      } else {
        console.log('Refresh failed, user needs to log in again');
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
    }
  }
  
  // Check for existing session
  if (authToken) {
    await validateSession();
  }

  // Mobile menu toggle
  initMobileMenu();

  // Page-specific initializations
  const path = window.location.pathname;
  
  if (path.includes('predictions')) {
    await initPredictionsPage();
  } else if (path.includes('leaderboard')) {
    await initLeaderboardPage();
  } else if (path.includes('tournaments')) {
    await initTournamentsPage();
  } else if (path.includes('register')) {
    initRegisterPage();
  } else if (path.includes('login')) {
    initLoginPage();
  } else {
    await initHomePage();
  }

  // Update UI based on auth state
  updateAuthUI();
}

// ==================== AUTH FUNCTIONS ====================

async function validateSession() {
  try {
    const response = await fetch(`${API_BASE}/leaderboard?limit=1`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) {
      // Token invalid, clear it
      logout();
    }
  } catch (error) {
    console.error('Session validation error:', error);
  }
}

async function registerUser(userData) {
  try {
    const response = await fetch(`${API_BASE}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Registration failed');
    }

    return { success: true, user: data.user };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function loginUser(credentials) {
  try {
    const response = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Login failed');
    }

    // Store session
    authToken = data.session.access_token;
    localStorage.setItem('gbf_token', authToken);
    localStorage.setItem('gbf_refresh', data.session.refresh_token);
    currentUser = data.user;
    localStorage.setItem('gbf_user', JSON.stringify(currentUser));
    
    // Start live scores polling
    startLiveScoresPolling();

    return { success: true, user: data.user };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function logout() {
  // Stop polling
  stopLiveScoresPolling();
  
  authToken = null;
  currentUser = null;
  localStorage.removeItem('gbf_token');
  localStorage.removeItem('gbf_refresh');
  localStorage.removeItem('gbf_user');
  window.location.href = 'index.html';
}

// Make logout globally accessible
window.logout = logout;

function updateAuthUI() {
  // Update navigation based on auth state
  const navLinks = document.querySelector('.nav-links');
  if (!navLinks) return;

  // Get auth state from localStorage
  const token = localStorage.getItem('gbf_token');
  let user = null;
  const storedUser = localStorage.getItem('gbf_user');
  if (storedUser) {
    try {
      user = JSON.parse(storedUser);
    } catch (e) {
      console.error('Failed to parse stored user:', e);
    }
  }

  console.log('updateAuthUI - token exists:', !!token, 'user:', user?.display_name);

  // Find the nav items
  let registerItem = navLinks.querySelector('a[href="register.html"]')?.parentElement;
  let loginItem = navLinks.querySelector('a[href="login.html"]')?.parentElement;
  
  if (token && user) {
    // User is logged in - replace Register and Login with User and Logout
    if (registerItem) {
      registerItem.innerHTML = `<a href="profile.html"><i class="fas fa-user"></i> ${user.display_name || user.username}</a>`;
    }
    if (loginItem) {
      loginItem.innerHTML = `<a href="#" onclick="logout(); return false;"><i class="fas fa-sign-out-alt"></i> Logout</a>`;
    }
  } else {
    // User is logged out - ensure Login and Register links are present
    if (registerItem && !registerItem.querySelector('a[href="register.html"]')) {
      registerItem.innerHTML = `<a href="register.html"><i class="fas fa-user-plus"></i> Register</a>`;
    }
    if (loginItem && !loginItem.querySelector('a[href="login.html"]')) {
      loginItem.innerHTML = `<a href="login.html"><i class="fas fa-sign-in-alt"></i> Login</a>`;
    }
  }
}

// ==================== PAGE INITIALIZERS ====================

function initMobileMenu() {
  const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
  const navLinks = document.querySelector('.nav-links');
  
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', function() {
      navLinks.style.display = navLinks.style.display === 'flex' ? 'none' : 'flex';
    });
  }
}

async function initHomePage() {
  // Fetch live stats
  try {
    // Build fetch array - only add user entries if logged in
    const fetchPromises = [
      fetch(`${API_BASE}/tournaments?status=live&limit=2`),
      fetch(`${API_BASE}/leaderboard?limit=5`),
      fetch(`${API_BASE}/current-gameweek`)
    ];
    
    // If logged in, also fetch user's tournament entries and predictions
    if (authToken) {
      fetchPromises.push(
        fetch(`${API_BASE}/tournaments?my_entries=true`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        })
      );
    }

    const responses = await Promise.all(fetchPromises);
    
    const tournamentsData = await responses[0].json();
    const leaderboardData = await responses[1].json();
    const gameweekData = await responses[2].json();
    
    // Get user's tournament entries if logged in
    let userEntries = [];
    if (authToken && responses[3]) {
      const entriesData = await responses[3].json();
      userEntries = entriesData.tournaments?.map(t => t.id) || [];
    }

    // Update hero stats if elements exist
    updateHeroStats(tournamentsData.tournaments, leaderboardData.leaderboard, gameweekData);
    
    // Update live tournaments section with user entry status
    updateLiveTournaments(tournamentsData.tournaments, userEntries);
    
    // Update top players
    updateTopPlayers(leaderboardData.leaderboard);
    
    // Update quick actions text
    updateQuickActions(gameweekData);
    
    // Update prediction status bar for logged in users
    // Use current gameweek if not finished, otherwise use next
    const predictionGameweek = gameweekData.finished ? gameweekData.next_gameweek : gameweekData.current_gameweek;
    if (authToken && predictionGameweek) {
      await updatePredictionStatusBar(predictionGameweek, gameweekData.finished);
    }

  } catch (error) {
    console.error('Failed to load home page data:', error);
  }
}

async function updatePredictionStatusBar(gameweek, currentFinished) {
  const statusBar = document.getElementById('prediction-status-bar');
  if (!statusBar) return;
  
  // Show the bar for logged in users
  statusBar.style.display = 'block';
  
  const iconEl = document.getElementById('prediction-status-icon');
  const titleEl = document.getElementById('prediction-status-title');
  const subtitleEl = document.getElementById('prediction-status-subtitle');
  const btnEl = document.getElementById('prediction-status-btn');
  
  try {
    // Fetch user's predictions for the gameweek
    const response = await fetch(`${API_BASE}/predictions?gameweek=${gameweek}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    
    if (!response.ok) throw new Error('Failed to fetch predictions');
    
    const data = await response.json();
    const hasPredictions = data.predictions && data.predictions.length > 0;
    
    // Determine status message based on whether current GW is finished
    const gwLabel = currentFinished ? 'next GW' : 'current GW';
    
    if (hasPredictions) {
      // User has predicted
      iconEl.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
      iconEl.style.color = 'var(--accent-green)';
      iconEl.innerHTML = '<i class="fas fa-check-circle"></i>';
      titleEl.textContent = `You've predicted for GW ${gameweek}`;
      titleEl.style.color = 'var(--accent-green)';
      subtitleEl.textContent = currentFinished 
        ? `${data.predictions.length} predictions ready for next gameweek`
        : `${data.predictions.length} predictions submitted for current gameweek`;
      btnEl.innerHTML = '<i class="fas fa-edit"></i> Edit Predictions';
      btnEl.href = 'predictions.html';
      btnEl.className = 'btn btn-success btn-sm';
    } else {
      // User hasn't predicted
      iconEl.style.backgroundColor = 'rgba(245, 158, 11, 0.2)';
      iconEl.style.color = 'var(--accent-amber)';
      iconEl.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
      titleEl.textContent = `You haven't predicted for GW ${gameweek}`;
      titleEl.style.color = 'var(--accent-amber)';
      subtitleEl.textContent = currentFinished
        ? 'Submit your predictions for the next gameweek'
        : 'Submit your predictions before the deadline';
      btnEl.innerHTML = '<i class="fas fa-futbol"></i> Predict Now';
      btnEl.href = 'predictions.html';
      btnEl.className = 'btn btn-primary btn-sm';
    }
  } catch (error) {
    console.error('Failed to check prediction status:', error);
    iconEl.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
    iconEl.style.color = 'var(--accent-red)';
    iconEl.innerHTML = '<i class="fas fa-times-circle"></i>';
    titleEl.textContent = 'Unable to check predictions';
    titleEl.style.color = 'var(--accent-red)';
    subtitleEl.textContent = 'Please refresh the page';
  }
}

async function initPredictionsPage() {
  const gameweekSelect = document.getElementById('gameweek');
  
  // Load current gameweek info and deadline
  await loadGameweekInfo();
  
  // Load fixtures for selected gameweek
  await loadFixtures(gameweekSelect ? gameweekSelect.value : '35');

  // Gameweek selector change handler
  if (gameweekSelect) {
    gameweekSelect.addEventListener('change', function() {
      loadFixtures(this.value);
    });
  }

  // Handle prediction form submission
  const predictionsForm = document.getElementById('predictions-form');
  if (predictionsForm) {
    predictionsForm.addEventListener('submit', handlePredictionSubmit);
  }
  
  // Start deadline countdown
  startDeadlineCountdown();

  // Prediction option selection visual feedback
  const predictionOptions = document.querySelectorAll('.prediction-option input');
  predictionOptions.forEach(option => {
    option.addEventListener('change', function() {
      const name = this.name;
      document.querySelectorAll(`input[name="${name}"]`).forEach(input => {
        input.parentElement.classList.remove('selected');
      });
      if (this.checked) {
        this.parentElement.classList.add('selected');
      }
    });
  });

  // Score input validation
  const scoreInputs = document.querySelectorAll('.score-input');
  scoreInputs.forEach(input => {
    input.addEventListener('input', function() {
      let value = parseInt(this.value);
      if (value < 0) this.value = 0;
      if (value > 20) this.value = 20;
    });
  });
}

async function initLeaderboardPage() {
  const tournamentFilter = document.getElementById('tournament-filter');
  
  await loadLeaderboard(tournamentFilter ? tournamentFilter.value : 'all');

  if (tournamentFilter) {
    tournamentFilter.addEventListener('change', function() {
      loadLeaderboard(this.value);
    });
  }
}

async function initTournamentsPage() {
  await loadTournaments();
}

function initRegisterPage() {
  // Handle registration form submission
  const registerForm = document.getElementById('register-form');
  if (registerForm) {
    registerForm.addEventListener('submit', handleRegisterSubmit);
  }
}

function initLoginPage() {
  // Handle login form submission
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLoginSubmit);
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  
  const credentials = {
    email: document.getElementById('email').value,
    password: document.getElementById('password').value
  };

  const result = await loginUser(credentials);

  if (result.success) {
    alert('Welcome back, ' + result.user.display_name + '!');
    // Honor the page that sent the user here (set by auth-gate.js as
    // ?redirect=/some-page.html), falling back to profile.html only if
    // there wasn't one (e.g. someone navigated to login.html directly).
    const params = new URLSearchParams(window.location.search);
    const redirectTo = params.get('redirect');
    window.location.href = redirectTo ? decodeURIComponent(redirectTo) : 'profile.html';
  } else {
    alert(result.error);
  }
}

// ==================== DATA LOADING FUNCTIONS ====================

let gameweekInfo = null;

async function loadGameweekInfo() {
  try {
    const response = await fetch(`${API_BASE}/current-gameweek`);
    if (response.ok) {
      gameweekInfo = await response.json();
      
      // Update gameweek selector if on predictions page
      const gwSelect = document.getElementById('gameweek');
      if (gwSelect && gameweekInfo.next_gameweek) {
        // Set to next gameweek for predictions
        gwSelect.value = gameweekInfo.next_gameweek;
      }
    }
  } catch (error) {
    console.error('Failed to load gameweek info:', error);
  }
}

function startDeadlineCountdown() {
  if (!gameweekInfo || !gameweekInfo.deadline_epoch) return;
  
  const deadlineEl = document.getElementById('deadline-countdown');
  if (!deadlineEl) return;
  
  function update() {
    const now = Math.floor(Date.now() / 1000);
    const diff = gameweekInfo.deadline_epoch - now;
    
    if (diff <= 0) {
      deadlineEl.innerHTML = '<span style="color: var(--accent-red);">DEADLINE PASSED - Predictions Locked</span>';
      lockPredictionForm();
      return;
    }
    
    const days = Math.floor(diff / 86400);
    const hours = Math.floor((diff % 86400) / 3600);
    const minutes = Math.floor((diff % 3600) / 60);
    
    deadlineEl.innerHTML = `Deadline: <strong>${days}d ${hours}h ${minutes}m</strong>`;
  }
  
  update();
  setInterval(update, 60000); // Update every minute
}

function lockPredictionForm() {
  const form = document.getElementById('predictions-form');
  if (form) {
    const inputs = form.querySelectorAll('input, button');
    inputs.forEach(input => input.disabled = true);
    
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.textContent = 'Deadline Passed';
      submitBtn.classList.add('btn-disabled');
    }
  }
}

async function loadFixtures(gameweek) {
  try {
    const headers = authToken ? { 'Authorization': `Bearer ${authToken}` } : {};
    const response = await fetch(`${API_BASE}/predictions?gameweek=${gameweek}`, { headers });
    
    if (!response.ok) throw new Error('Failed to load fixtures');
    
    const data = await response.json();
    
    // Store matches data for form submission
    window.currentMatches = data.matches;
    
    // If user has existing predictions, populate the form
    if (data.predictions && data.predictions.length > 0) {
      populateExistingPredictions(data.predictions);
    }

  } catch (error) {
    console.error('Error loading fixtures:', error);
    // Fall back to static HTML content if API fails
  }
}

async function loadLeaderboard(tournament) {
  try {
    const response = await fetch(`${API_BASE}/leaderboard?tournament=${tournament}&limit=50`);
    
    if (!response.ok) throw new Error('Failed to load leaderboard');
    
    const data = await response.json();
    renderLeaderboard(data.leaderboard);

  } catch (error) {
    console.error('Error loading leaderboard:', error);
  }
}

async function loadTournaments() {
  try {
    const response = await fetch(`${API_BASE}/tournaments`);
    
    if (!response.ok) throw new Error('Failed to load tournaments');
    
    const data = await response.json();
    renderTournaments(data.tournaments);

  } catch (error) {
    console.error('Error loading tournaments:', error);
  }
}

// ==================== FORM HANDLERS ====================

async function handleRegisterSubmit(e) {
  e.preventDefault();
  
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirm-password').value;
  
  if (password !== confirmPassword) {
    alert('Passwords do not match!');
    return;
  }
  
  if (password.length < 8) {
    alert('Password must be at least 8 characters long!');
    return;
  }

  const userData = {
    username: document.getElementById('username').value,
    display_name: document.getElementById('display-name').value,
    email: document.getElementById('email').value,
    password: password
  };

  const result = await registerUser(userData);

  if (result.success) {
    alert('Account created successfully! Please log in.');
    // Preserve wherever the user was headed (e.g. Fantasy Manager, a
    // tournament page) so login.html can send them there after signing in.
    const params = new URLSearchParams(window.location.search);
    const redirectTo = params.get('redirect');
    window.location.href = redirectTo ? ('login.html?redirect=' + encodeURIComponent(redirectTo)) : 'login.html';
  } else {
    alert(result.error);
  }
}

async function handlePredictionSubmit(e) {
  e.preventDefault();
  
  if (!authToken) {
    alert('Please log in to submit predictions');
    return;
  }

  const gameweek = document.getElementById('gameweek').value;
  const predictions = [];

  // Collect all predictions
  for (let i = 1; i <= 10; i++) {
    const result = document.querySelector(`input[name="match${i}_result"]:checked`);
    const homeScoreInput = document.querySelector(`input[name="match${i}_home_score"]`);
    const awayScoreInput = document.querySelector(`input[name="match${i}_away_score"]`);
    
    const homeScore = homeScoreInput ? homeScoreInput.value : '';
    const awayScore = awayScoreInput ? awayScoreInput.value : '';
    
    if (!result || homeScore === '' || awayScore === '') {
      alert(`Please complete prediction for Match ${i}`);
      return;
    }

    // Get match ID from stored matches data or use a temporary ID based on gameweek
    let matchId = window.currentMatches && window.currentMatches[i - 1] 
      ? window.currentMatches[i - 1].id 
      : null;

    // If no match ID from API, create a temporary one based on gameweek and match number
    // This allows predictions to work even before matches are seeded in the database
    if (!matchId) {
      matchId = `temp-${gameweek}-${i}`;
    }

    predictions.push({
      match_id: matchId,
      predicted_result: result.value,
      home_score: parseInt(homeScore),
      away_score: parseInt(awayScore)
    });
  }

  try {
    const response = await fetch(`${API_BASE}/predictions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ gameweek: parseInt(gameweek), predictions })
    });

    const data = await response.json();

    if (response.ok) {
      alert('Predictions submitted successfully! Good luck!');
    } else {
      alert(data.error || 'Failed to submit predictions');
    }
  } catch (error) {
    alert('Error submitting predictions. Please try again.');
  }
}

// ==================== RENDER FUNCTIONS ====================

function updateHeroStats(tournaments, leaderboard, gameweekData) {
  // Calculate total prize pool from live tournaments (entry_fee × entries)
  const totalPrizePool = tournaments 
    ? tournaments.reduce((sum, t) => {
        const entryFee = parseFloat(t.entry_fee) || 0;
        const entries = parseInt(t.current_entries) || 0;
        return sum + (entryFee * entries);
      }, 0)
    : 0;

  // Get active player count from leaderboard
  const activePlayers = leaderboard ? leaderboard.length : 0;
  
  // Get current gameweek (current if not finished, otherwise next)
  const currentGW = gameweekData?.finished 
    ? gameweekData?.next_gameweek 
    : (gameweekData?.current_gameweek || gameweekData?.next_gameweek || '--');

  // Update Prize Pool
  const prizePoolEl = document.getElementById('hero-prize-pool');
  if (prizePoolEl) {
    prizePoolEl.textContent = '£' + totalPrizePool.toLocaleString();
  }

  // Update Active Players
  const playersEl = document.getElementById('hero-active-players');
  if (playersEl) {
    playersEl.textContent = activePlayers.toLocaleString();
  }
  
  // Update Current GW
  const gwEl = document.getElementById('hero-current-gw');
  if (gwEl) {
    gwEl.textContent = 'GW ' + currentGW;
  }
}

function updateQuickActions(gameweekData) {
  // Use current gameweek if not finished, otherwise use next
  const activeGW = gameweekData?.finished 
    ? gameweekData?.next_gameweek 
    : (gameweekData?.current_gameweek || gameweekData?.next_gameweek);
  const predictionsText = document.getElementById('quick-action-predictions-text');
  if (predictionsText) {
    predictionsText.textContent = `GW ${activeGW || '--'} fixtures are now live. Submit your predictions before kickoff.`;
  }
}

function updateLiveTournaments(tournaments, userEntries = []) {
  const container = document.getElementById('live-tournaments-container');
  if (!container) return;
  
  if (!tournaments || tournaments.length === 0) {
    container.innerHTML = `
      <div class="tournament-card">
        <div class="tournament-header">
          <div>
            <div class="tournament-name">No Live Tournaments</div>
            <div class="text-muted" style="font-size: 0.875rem;">Check back soon for new tournaments</div>
          </div>
        </div>
      </div>
    `;
    return;
  }
  
  const isLoggedIn = !!authToken;
  
  container.innerHTML = tournaments.slice(0, 2).map(t => {
    const timeRemaining = t.time_remaining || 'Closing soon';
    const status = t.status === 'live' ? 'Live' : t.status;
    const statusClass = t.status === 'live' ? 'live' : t.status;
    const isRegistered = userEntries.includes(t.id);
    const hasStarted = t.status === 'live' || t.status === 'closed' || t.status === 'finished';
    
    // Determine button state
    let buttonHtml = '';
    if (!isLoggedIn) {
      // Not logged in - show login to enter
      buttonHtml = `<a href="login.html" class="btn btn-outline" style="width: 100%;"><i class="fas fa-sign-in-alt"></i> Login to Enter</a>`;
    } else if (isRegistered) {
      // Registered - show view predictions button
      buttonHtml = `<a href="predictions.html?tournament=${t.id}" class="btn btn-success" style="width: 100%;"><i class="fas fa-eye"></i> View Predictions</a>`;
    } else if (hasStarted) {
      // Not registered and tournament has started - show disabled button
      buttonHtml = `<button class="btn btn-disabled" style="width: 100%;" disabled><i class="fas fa-lock"></i> Tournament Started</button>`;
    } else {
      // Not registered and tournament not started - show enter button
      buttonHtml = `<a href="predictions.html?tournament=${t.id}" class="btn btn-primary" style="width: 100%;"><i class="fas fa-ticket"></i> Enter Tournament</a>`;
    }
    
    return `
      <div class="tournament-card ${statusClass}">
        <div class="tournament-header">
          <div>
            <div class="tournament-name">${t.name}</div>
            <div class="text-muted" style="font-size: 0.875rem;">Closes in ${timeRemaining}</div>
          </div>
          <span class="tournament-status ${statusClass}">${status}</span>
        </div>
        <div class="tournament-details">
          <div class="tournament-detail">
            <div class="tournament-detail-value">£${(t.prize_pool || 0).toLocaleString()}</div>
            <div class="tournament-detail-label">Prize Pool</div>
          </div>
          <div class="tournament-detail">
            <div class="tournament-detail-value">£${t.entry_fee || 0}</div>
            <div class="tournament-detail-label">Entry Fee</div>
          </div>
          <div class="tournament-detail">
            <div class="tournament-detail-value">${t.current_entries || 0}</div>
            <div class="tournament-detail-label">Entries</div>
          </div>
        </div>
        ${buttonHtml}
      </div>
    `;
  }).join('');
}

function updateTopPlayers(leaderboard) {
  const tbody = document.getElementById('top-players-tbody');
  if (!tbody) return;
  
  if (!leaderboard || leaderboard.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">No players yet</td></tr>';
    return;
  }

  // Avatar colors for variety
  const avatarColors = [
    'var(--accent-blue)',
    'var(--accent-red)',
    'var(--accent-amber)',
    '#8b5cf6',
    '#ec4899',
    '#10b981',
    '#f59e0b'
  ];

  tbody.innerHTML = leaderboard.slice(0, 5).map((entry, index) => {
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : 'rank';
    const initials = entry.user?.avatar_initials || 
                    (entry.user?.display_name || '??').substring(0, 2).toUpperCase();
    const displayName = entry.user?.display_name || 'Unknown';
    const username = entry.user?.username || 'unknown';
    const avatarColor = avatarColors[index % avatarColors.length];
    
    return `
      <tr>
        <td><span class="rank ${rankClass}">${entry.rank}</span></td>
        <td>
          <div class="player-info">
            <div class="player-avatar" style="background-color: ${avatarColor};">${initials}</div>
            <div>
              <div style="font-weight: 600;">${displayName}</div>
              <div class="text-muted" style="font-size: 0.875rem;">@${username}</div>
            </div>
          </div>
        </td>
        <td class="text-right points">${(entry.total_points || 0).toLocaleString()}</td>
        <td class="text-right text-green">${entry.gw_points || '-'}</td>
      </tr>
    `;
  }).join('');
}

function populateExistingPredictions(predictions) {
  predictions.forEach(pred => {
    // Find the match index
    const matchIndex = window.currentMatches 
      ? window.currentMatches.findIndex(m => m.id === pred.match_id) + 1
      : null;

    if (matchIndex) {
      // Set result radio
      const resultRadio = document.querySelector(`input[name="match${matchIndex}_result"][value="${pred.predicted_result}"]`);
      if (resultRadio) {
        resultRadio.checked = true;
        resultRadio.parentElement.classList.add('selected');
      }

      // Set scores
      const homeInput = document.querySelector(`input[name="match${matchIndex}_home_score"]`);
      const awayInput = document.querySelector(`input[name="match${matchIndex}_away_score"]`);
      
      if (homeInput) homeInput.value = pred.home_score;
      if (awayInput) awayInput.value = pred.away_score;
    }
  });
}

function renderLeaderboard(leaderboard) {
  const tbody = document.querySelector('.leaderboard-table tbody');
  if (!tbody) return;

  tbody.innerHTML = leaderboard.map((entry, index) => {
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : 'rank';
    const initials = entry.user.avatar_initials || entry.user.display_name.substring(0, 2).toUpperCase();
    const streakHtml = entry.streak > 1 
      ? `<span style="color: var(--accent-green);"><i class="fas fa-fire"></i> ${entry.streak}</span>` 
      : '-';

    return `
      <tr>
        <td><span class="rank ${rankClass}">${entry.rank}</span></td>
        <td>
          <div class="player-info">
            <div class="player-avatar">${initials}</div>
            <div>
              <div style="font-weight: 600;">${entry.user.display_name}</div>
              <div class="text-muted" style="font-size: 0.875rem;">@${entry.user.username}</div>
            </div>
          </div>
        </td>
        <td class="text-right points">${entry.total_points.toLocaleString()}</td>
        <td class="text-right text-green">${entry.gw_points || '-'}</td>
        <td class="text-right">${entry.gw_points || '-'}</td>
        <td class="text-right">${entry.correct_scores}</td>
        <td class="text-right">${streakHtml}</td>
      </tr>
    `;
  }).join('');
}

function renderTournaments(tournaments) {
  // This would dynamically render tournaments
  // For now, static HTML serves as fallback with enhanced interactivity
  
  // Add click handlers to enter buttons
  document.querySelectorAll('.tournament-card .btn-primary').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      if (!authToken) {
        e.preventDefault();
        alert('Please log in to enter tournaments');
        return;
      }
      
      // Tournament entry is handled via the predictions page
      // This could be enhanced to show a tournament selection modal
    });
  });
}



// ==================== UTILITY FUNCTIONS ====================

function formatNumber(num) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatCurrency(amount) {
  return '£' + formatNumber(amount);
}

// Animate cards on scroll
function initScrollAnimations() {
  const cards = document.querySelectorAll('.card, .tournament-card, .fixture');
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
      }
    });
  }, observerOptions);

  cards.forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    observer.observe(card);
  });
}

// Countdown timer for tournament deadlines
function updateCountdowns() {
  const countdownElements = document.querySelectorAll('[data-countdown]');
  countdownElements.forEach(el => {
    const deadline = new Date(el.dataset.countdown);
    const now = new Date();
    const diff = deadline - now;
    
    if (diff > 0) {
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      el.textContent = `${days}d ${hours}h ${minutes}m`;
    } else {
      el.textContent = 'Closed';
    }
  });
}

// Initialize scroll animations and countdowns
initScrollAnimations();
updateCountdowns();
setInterval(updateCountdowns, 60000);

// ==================== LIVE SCORES POLLING ====================
// Poll for live scores every 2 minutes when user is logged in
// This keeps data fresh for all users

async function pollLiveScores() {
  if (!authToken) return; // Only poll when logged in
  
  try {
    console.log('[Polling] Fetching live scores...');
    const response = await fetch(`${API_BASE}/live-scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log('[Polling] Live scores updated:', data.message, 'GW:', data.gameweek);
    } else {
      console.log('[Polling] Live scores request failed:', response.status);
    }
  } catch (error) {
    console.error('[Polling] Error:', error.message);
  }
}

function startLiveScoresPolling() {
  if (liveScoresPollInterval) {
    clearInterval(liveScoresPollInterval);
  }
  
  // Immediate first call
  pollLiveScores();
  
  // Then every 2 minutes
  liveScoresPollInterval = setInterval(pollLiveScores, POLL_INTERVAL_MS);
  console.log('[Polling] Started live scores polling (every 2 mins)');
}

function stopLiveScoresPolling() {
  if (liveScoresPollInterval) {
    clearInterval(liveScoresPollInterval);
    liveScoresPollInterval = null;
    console.log('[Polling] Stopped live scores polling');
  }
}

// Start polling if user is logged in
if (authToken) {
  startLiveScoresPolling();
}

// Export for potential module use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { formatNumber, formatCurrency, registerUser, loginUser, logout };
}

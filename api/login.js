// Vercel API Route: Login User
// POST /api/login

const { createClient } = require('@supabase/supabase-js');

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ---- Forgot password, step 1: email a reset link ----
  // Always answers the same way, so it never reveals whether an email has an account.
  if (req.method === 'POST' && req.body && req.body.action === 'request_reset') {
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, flowType: 'implicit' },
        global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) }
      });
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: 'https://www.gbhub.live/reset-password.html' });
      if (error) {
        console.error('request_reset error:', error.message);
        if (/rate limit|too many/i.test(error.message)) {
          return res.status(429).json({ error: 'Too many reset emails have been sent just now. Please try again in a little while, or message the GB Hub admin.' });
        }
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error('request_reset crash:', err);
      return res.status(500).json({ error: 'Could not send the reset email right now. Please try again shortly.' });
    }
  }

  // ---- Forgot password, step 2: set the new password from the emailed link ----
  // The link gives the reset page a short-lived recovery session; it's used
  // here only to change that one user's password, then they're logged in.
  if (req.method === 'POST' && req.body && req.body.action === 'complete_reset') {
    const { access_token, refresh_token, new_password } = req.body;
    if (!access_token || !refresh_token) return res.status(400).json({ error: 'This reset link is missing information. Please request a new one.' });
    if (!new_password || String(new_password).length < 8 || !/[0-9]/.test(new_password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include a number.' });
    }
    try {
      const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) }
      });
      const { data: sess, error: sessErr } = await supabase.auth.setSession({ access_token, refresh_token });
      if (sessErr || !sess || !sess.session) {
        return res.status(401).json({ error: 'This reset link has expired or was already used. Please request a new one.' });
      }
      const { error: updErr } = await supabase.auth.updateUser({ password: new_password });
      if (updErr) {
        return res.status(400).json({ error: updErr.message || 'Could not update the password.' });
      }
      const { data: profile } = await supabase.from('users').select('*').eq('id', sess.session.user.id).maybeSingle();
      return res.status(200).json({
        ok: true,
        session: { access_token: sess.session.access_token, refresh_token: sess.session.refresh_token, expires_at: sess.session.expires_at },
        user: profile || null
      });
    } catch (err) {
      console.error('complete_reset crash:', err);
      return res.status(500).json({ error: 'Could not update the password right now. Please try again.' });
    }
  }

  // Handle token refresh
  if (req.method === 'POST' && req.body.refresh_token) {
    try {
      const supabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_KEY,
        { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
      );
      
      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: req.body.refresh_token
      });
      
      if (error || !data.session) {
        return res.status(401).json({ error: 'Invalid refresh token' });
      }
      
      return res.status(200).json({
        session: {
          access_token: data.session.access_token,
          refresh_token: data.session.refresh_token,
          expires_at: data.session.expires_at
        }
      });
      
    } catch (error) {
      return res.status(500).json({ error: 'Refresh failed', details: error.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Initialize Supabase with anon key for client-side auth
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_KEY,
      { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
    );

    // Sign in user
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Get user profile
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError) {
      return res.status(500).json({ error: 'Failed to fetch user profile' });
    }

    return res.status(200).json({
      message: 'Login successful',
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at
      },
      user: profile
    });

  } catch (error) {
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

const { createClient } = require('@supabase/supabase-js')

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Check environment variables
  const missingVars = []
  if (!process.env.SUPABASE_URL) missingVars.push('SUPABASE_URL')
  if (!process.env.SUPABASE_SECRET) missingVars.push('SUPABASE_SECRET')
  
  if (missingVars.length > 0) {
    console.error('Missing environment variables:', missingVars)
    return res.status(500).json({ 
      error: 'Server configuration error: Missing ' + missingVars.join(', ') 
    })
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SECRET,
      { global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) } }
    )
    const { username, display_name, email, password } = req.body
    
    // Create user in Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true
    })
    
    if (error) {
      console.error('Supabase auth error:', error)
      return res.status(400).json({ error: error.message })
    }

    // Insert user data into users table
    const { data: userData, error: userError } = await supabase
      .from('users')
      .insert({
        id: data.user.id,
        username,
        display_name,
        email
      })
      .select()

    if (userError) {
      console.error('Supabase users table error:', userError)
      // Real bug fix: without this, a failed profile insert left a
      // permanently orphaned auth account behind — logs in fine (auth
      // genuinely succeeds) but can never fetch a profile, and the email
      // is stuck as "already registered" with no way to retry cleanly.
      // Roll back the auth account so the email is genuinely free again.
      const { error: cleanupError } = await supabase.auth.admin.deleteUser(data.user.id)
      if (cleanupError) {
        console.error('Failed to roll back orphaned auth account:', cleanupError)
      }
      return res.status(500).json({
        error: 'Failed to save profile: ' + userError.message + '. Please try registering again.'
      })
    }

    console.log('User created successfully:', { id: data.user.id, username, email })
    
    return res.status(200).json({ 
      success: true, 
      message: 'Account created successfully',
      user: {
        id: data.user.id,
        username,
        display_name,
        email
      }
    })
  } catch (err) {
    console.error('Unexpected error:', err)
    return res.status(500).json({ error: err.message })
  }
}
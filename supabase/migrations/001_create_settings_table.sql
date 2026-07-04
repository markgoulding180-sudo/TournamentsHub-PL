-- Create settings table for storing system configuration
CREATE TABLE IF NOT EXISTS public.settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;

-- Allow all access to service role (for API functions using SUPABASE_SECRET)
CREATE POLICY "Allow service role full access" 
    ON public.settings 
    FOR ALL 
    TO service_role 
    USING (true) 
    WITH CHECK (true);

-- Also allow anon and authenticated to read (for client-side checks)
CREATE POLICY "Allow public read access" 
    ON public.settings 
    FOR SELECT 
    TO anon, authenticated 
    USING (true);

-- Insert initial settings
INSERT INTO public.settings (key, value) VALUES
('current_gameweek', '{"current_gameweek": 36, "next_gameweek": 37, "manual_override": true}'),
('last_finalised_gameweek', '{"gameweek": 35, "finalised_at": "2026-05-05T03:39:00Z"}'),
('manual_gameweek', '{"gameweek": 36, "set_at": "2026-05-05T03:39:00Z"}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

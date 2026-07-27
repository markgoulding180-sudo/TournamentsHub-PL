-- Wallet ledger — a "promise to pay" system, not a payment processor.
-- No money ever moves through this table. It just tracks what each user
-- owes (entry fees, added automatically when they join a paid tournament)
-- and what's been paid off (recorded manually by an admin after receiving
-- real money outside the app — cash, bank transfer, whatever).
--
-- Run this in TB-PL (public schema — shared across all tournament types,
-- same place public.users already lives).
--
-- owed_by_user = SUM(amount) grouped by user_id.
--   entry_fee   -> positive amount  (increases what they owe)
--   payment     -> negative amount  (reduces what they owe)
--   adjustment  -> either sign      (admin manual correction, e.g. a refund
--                                    or a goodwill credit)

CREATE TABLE IF NOT EXISTS public.wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('entry_fee', 'payment', 'adjustment')),
  amount INTEGER NOT NULL, -- pence. Positive = increases debt, negative = reduces it.
  tournament_type TEXT,    -- 'predictions' | 'fantasy' | 'lms' | 'stockmarket' | NULL
  tournament_id UUID,      -- NULL for payments/adjustments not tied to one tournament
  description TEXT,
  created_by UUID,         -- admin user id for payments/adjustments; NULL for system-generated entry_fee rows
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON public.wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created_at ON public.wallet_transactions(created_at);

ALTER TABLE public.wallet_transactions ENABLE ROW LEVEL SECURITY;

-- Users can see their own transaction history (e.g. their own /wallet page).
-- All writes happen server-side via the service key, so this policy only
-- ever matters for read access, never blocks the API.
DROP POLICY IF EXISTS "Users can view own wallet transactions" ON public.wallet_transactions;
CREATE POLICY "Users can view own wallet transactions"
  ON public.wallet_transactions FOR SELECT
  USING (auth.uid() = user_id);

-- Align the booking payment-source constraint with the PayFast ITN settlement function.
ALTER TABLE public.customer_bookings
  DROP CONSTRAINT IF EXISTS customer_bookings_payment_source_check;
ALTER TABLE public.customer_bookings
  ADD CONSTRAINT customer_bookings_payment_source_check
  CHECK (payment_source IN ('cash','wallet','paystack','pay_later','payfast'));

-- The driver portal needs the exact combined earnings + reward balance, not a truncated page of ledger rows.
CREATE OR REPLACE FUNCTION public.get_driver_available_balance(p_driver_id uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT
    COALESCE((SELECT sum(amount_cents) FROM public.driver_earnings_ledger WHERE driver_user_id=p_driver_id),0)
    + COALESCE((SELECT sum(amount_cents) FROM public.driver_reward_ledger WHERE driver_user_id=p_driver_id),0);
$$;
REVOKE ALL ON FUNCTION public.get_driver_available_balance(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_driver_available_balance(uuid) TO service_role;

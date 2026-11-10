ALTER TABLE public.customer_bookings
  DROP CONSTRAINT IF EXISTS customer_bookings_payment_method_check;

ALTER TABLE public.customer_bookings
  ADD CONSTRAINT customer_bookings_payment_method_check
  CHECK (payment_method = ANY (ARRAY['cash'::text, 'dispatch'::text, 'eft'::text, 'card'::text]));

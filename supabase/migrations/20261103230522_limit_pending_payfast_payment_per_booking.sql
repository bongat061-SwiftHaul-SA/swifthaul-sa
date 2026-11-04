create unique index if not exists payment_transactions_one_pending_per_booking_idx
  on public.payment_transactions (booking_waybill)
  where status = 'pending';

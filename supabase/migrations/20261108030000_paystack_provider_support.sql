begin;

-- Allow Paystack alongside the legacy PayFast provider without changing
-- existing payment records or silently switching the default provider.
alter table public.payment_transactions
  drop constraint if exists payment_transactions_provider_check;
alter table public.payment_transactions
  add constraint payment_transactions_provider_check
  check (provider in ('payfast','paystack'));

-- Paystack supports both test and live merchant environments.
alter table public.payment_transactions
  drop constraint if exists payment_transactions_payment_mode_check;
alter table public.payment_transactions
  add constraint payment_transactions_payment_mode_check
  check (payment_mode in ('sandbox','live'));

-- Keep provider references generic. pf_payment_id remains for legacy PayFast
-- records and webhook compatibility.
alter table public.payment_transactions
  add column if not exists provider_reference text;

create unique index if not exists payment_transactions_provider_reference_uidx
  on public.payment_transactions(provider, provider_reference)
  where provider_reference is not null;

-- Keep the booking source allow-list aligned with both gateways.
alter table public.customer_bookings
  drop constraint if exists customer_bookings_payment_source_check;
alter table public.customer_bookings
  add constraint customer_bookings_payment_source_check
  check (
    payment_source is null
    or payment_source = any (array['cash','wallet','payfast','paystack','pay_later']::text[])
  );

commit;

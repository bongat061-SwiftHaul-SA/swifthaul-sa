-- Optional customer-requested loading/carrying assistance, priced server-side.
alter table public.customer_bookings
  add column if not exists assistance_requested boolean not null default false,
  add column if not exists assistance_minutes integer not null default 0,
  add column if not exists assistance_fee_cents integer not null default 0,
  add column if not exists assistance_status text not null default 'not_requested';

alter table public.customer_bookings
  drop constraint if exists customer_bookings_assistance_minutes_check,
  add constraint customer_bookings_assistance_minutes_check check (assistance_minutes in (0,30,60,90,120)),
  drop constraint if exists customer_bookings_assistance_fee_check,
  add constraint customer_bookings_assistance_fee_check check (assistance_fee_cents >= 0),
  drop constraint if exists customer_bookings_assistance_status_check,
  add constraint customer_bookings_assistance_status_check check (assistance_status in ('not_requested','requested_pending_dispatch_confirmation','accepted','declined','completed'));

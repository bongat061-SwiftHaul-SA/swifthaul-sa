alter table public.customer_bookings
  add column if not exists vehicle_suitability_status text not null default 'not_required';

alter table public.customer_bookings
  drop constraint if exists customer_bookings_vehicle_suitability_status_check;

alter table public.customer_bookings
  add constraint customer_bookings_vehicle_suitability_status_check
  check (vehicle_suitability_status in ('not_required','pending_admin_review','approved','declined'));

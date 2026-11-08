-- Record an optional customer request for follow-up about possible Nedbank cargo cover.
-- This is not a policy, insurance application, premium charge, or cover activation.
alter table public.customer_bookings
  add column if not exists nedbank_cargo_insurance_interest boolean not null default false;

comment on column public.customer_bookings.nedbank_cargo_insurance_interest is
  'Customer requested information about possible Nedbank Insurance goods-in-transit cover; enquiry only, no insurance cover confirmed.';

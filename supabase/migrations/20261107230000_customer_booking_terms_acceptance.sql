-- Private audit record for customer acceptance of booking terms.
create table if not exists public.customer_booking_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  quote_id uuid not null references public.delivery_quotes(id) on delete restrict,
  terms_version text not null check (length(terms_version) between 1 and 120),
  accepted_at timestamptz not null default now(),
  unique (owner_id, quote_id, terms_version)
);

alter table public.customer_booking_terms_acceptances enable row level security;
revoke all on public.customer_booking_terms_acceptances from anon, authenticated;
grant all on public.customer_booking_terms_acceptances to service_role;

comment on table public.customer_booking_terms_acceptances is
  'Private server-recorded customer acceptance of a specific terms version for a delivery quote. No direct client access.';

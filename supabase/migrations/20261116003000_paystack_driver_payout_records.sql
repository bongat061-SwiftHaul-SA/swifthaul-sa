create table if not exists public.paystack_driver_payout_records (
 id uuid primary key default gen_random_uuid(),
 payout_request_id uuid not null references public.driver_payout_requests(id) on delete restrict,
 attempt_number integer not null check(attempt_number>0),
 driver_user_id uuid not null references public.user_profiles(id),
 reference text not null unique,
 recipient_code text not null,
 amount_cents bigint not null check(amount_cents>0),
 currency text not null default 'ZAR' check(currency='ZAR'),
 transfer_code text,
 status text not null default 'initiating' check(status in ('initiating','pending','success','failed','reversed')),
 failure_message text,
 initiated_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(payout_request_id,attempt_number)
);
create index if not exists paystack_driver_payout_records_request_idx on public.paystack_driver_payout_records(payout_request_id,created_at desc);
create index if not exists paystack_driver_payout_records_reference_idx on public.paystack_driver_payout_records(reference);
alter table public.paystack_driver_payout_records enable row level security;
revoke all on public.paystack_driver_payout_records from anon,authenticated;
grant all on public.paystack_driver_payout_records to service_role;

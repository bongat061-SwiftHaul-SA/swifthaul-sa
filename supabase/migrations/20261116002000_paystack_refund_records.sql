create table if not exists public.paystack_refund_records (
 id uuid primary key default gen_random_uuid(),
 refund_request_id uuid not null references public.booking_refund_requests(id) on delete restrict,
 attempt_number integer not null check (attempt_number > 0),
 waybill text not null,
 transaction_reference text not null,
 refund_reference text not null unique,
 provider_refund_id bigint,
 amount_cents bigint not null check (amount_cents > 0),
 currency text not null default 'ZAR' check (currency = 'ZAR'),
 status text not null default 'initiating' check (status in ('initiating','pending','processing','needs-attention','processed','failed')),
 failure_message text,
 initiated_by uuid not null references public.user_profiles(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(refund_request_id, attempt_number)
);
create index if not exists paystack_refund_records_request_idx
 on public.paystack_refund_records(refund_request_id, created_at desc);
create index if not exists paystack_refund_records_transaction_idx
 on public.paystack_refund_records(transaction_reference);
alter table public.paystack_refund_records enable row level security;
revoke all on public.paystack_refund_records from anon, authenticated;
grant all on public.paystack_refund_records to service_role;

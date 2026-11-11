create table if not exists public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  recipient_phone text not null,
  recipient_type text not null check (recipient_type in ('sender','recipient','driver')),
  channel text not null check (channel in ('whatsapp','sms')),
  event_type text not null check (event_type in ('order_dispatched','delivery_otp','document_expiry','payout_success','document_rejected')),
  payload_json jsonb not null default '{}'::jsonb,
  provider_message_id text,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed')),
  fallback_triggered boolean not null default false,
  provider text,
  last_error text,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_logs_sa_phone_e164 check (recipient_phone ~ '^\\+27[6-8][0-9]{8}$')
);
create index if not exists notification_logs_created_at_idx on public.notification_logs (created_at desc);
create index if not exists notification_logs_status_next_attempt_idx on public.notification_logs (status, next_attempt_at);
create index if not exists notification_logs_event_type_idx on public.notification_logs (event_type, created_at desc);
create unique index if not exists notification_logs_provider_message_id_uidx on public.notification_logs(provider_message_id) where provider_message_id is not null;
alter table public.notification_logs enable row level security;
revoke all on public.notification_logs from anon, authenticated;
grant all on public.notification_logs to service_role;

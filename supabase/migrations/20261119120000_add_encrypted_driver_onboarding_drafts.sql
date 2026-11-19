create table if not exists public.driver_onboarding_drafts (
  driver_user_id uuid primary key references auth.users(id) on delete cascade,
  draft_payload_encrypted text not null,
  updated_at timestamptz not null default now()
);
alter table public.driver_onboarding_drafts enable row level security;
revoke all on table public.driver_onboarding_drafts from anon, authenticated;
grant select, insert, update, delete on table public.driver_onboarding_drafts to service_role;
comment on table public.driver_onboarding_drafts is 'Encrypted driver onboarding form drafts; accessible only to service_role.';

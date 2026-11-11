-- Structured South African driver onboarding applications and expanded evidence categories.
alter table public.driver_documents drop constraint if exists driver_documents_document_type_check;
alter table public.driver_documents add constraint driver_documents_document_type_check
  check (document_type in (
    'id_document','id_front','id_back','profile_selfie','passport','work_permit','traffic_register_number',
    'proof_of_address','bank_confirmation','drivers_licence','licence_front','licence_back','prdp',
    'vehicle_document','vehicle_licence_disc','enatis_certificate','fleet_lease_agreement','vehicle_insurance'
  ));

create table if not exists public.driver_onboarding_applications (
  driver_user_id uuid primary key references auth.users(id) on delete cascade,
  identity_type text not null check(identity_type in ('sa_citizen','foreign_national')),
  identity_details jsonb not null default '{}'::jsonb,
  licence_details jsonb not null default '{}'::jsonb,
  vehicle_details jsonb not null default '{}'::jsonb,
  banking_details jsonb not null default '{}'::jsonb,
  verification_status text not null default 'pending' check(verification_status in ('pending','reviewing','approved','rejected')),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_note text,
  updated_at timestamptz not null default now()
);
alter table public.driver_onboarding_applications enable row level security;
revoke all on public.driver_onboarding_applications from public,anon,authenticated;
grant select,insert,update,delete on public.driver_onboarding_applications to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-application-documents','driver-application-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

-- New driver profiles are created with verification_status='pending' by the auth trigger.
-- Existing approved drivers are deliberately left unchanged by this migration.

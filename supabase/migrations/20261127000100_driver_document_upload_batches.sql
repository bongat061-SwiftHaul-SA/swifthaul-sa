-- Driver single-upload batches (staging implementation)
-- Files remain private and unclassified until an authorised admin assigns a type.
create table if not exists public.driver_document_upload_batches (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  bucket_id text not null default 'driver-application-documents',
  storage_path text not null unique,
  original_filename text not null,
  content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
  classification_status text not null default 'pending_classification'
    check (classification_status in ('pending_classification','classified','discarded')),
  document_type text null check (document_type is null or document_type in (
    'id_document','id_front','id_back','profile_selfie','passport','work_permit',
    'traffic_register_number','proof_of_address','bank_confirmation','drivers_licence',
    'licence_front','licence_back','prdp','vehicle_document','vehicle_licence_disc',
    'enatis_certificate','fleet_lease_agreement','vehicle_insurance'
  )),
  document_id uuid null references public.driver_documents(id) on delete set null,
  created_at timestamptz not null default now(),
  classified_at timestamptz null,
  classified_by uuid null references auth.users(id),
  constraint driver_document_upload_batches_classification_consistency check (
    (classification_status = 'pending_classification' and document_type is null and document_id is null)
    or (classification_status = 'classified' and document_type is not null and document_id is not null)
    or classification_status = 'discarded'
  )
);

create index if not exists driver_document_upload_batches_driver_status_idx
  on public.driver_document_upload_batches(driver_user_id, classification_status, created_at desc);

alter table public.driver_document_upload_batches enable row level security;

-- No direct client policies: uploads and review are mediated by authenticated
-- Edge Functions using server-side authorization and the service-role client.
comment on table public.driver_document_upload_batches is
  'Private staging queue for multi-file driver onboarding uploads pending admin classification.';

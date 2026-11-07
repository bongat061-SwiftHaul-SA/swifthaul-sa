-- Driver application documents and notification delivery tracking.
create table if not exists public.driver_documents (
 id uuid primary key default gen_random_uuid(),
 driver_user_id uuid not null references auth.users(id) on delete cascade,
 document_type text not null check (document_type in ('id_document','proof_of_address','bank_confirmation','drivers_licence','vehicle_document')),
 storage_path text not null unique,
 original_name text not null,
 content_type text not null check (content_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 file_size_bytes bigint not null check (file_size_bytes > 0 and file_size_bytes <= 10485760),
 review_status text not null default 'pending' check (review_status in ('pending','accepted','rejected')),
 review_note text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists driver_documents_owner_idx on public.driver_documents(driver_user_id,created_at desc);
alter table public.driver_documents enable row level security;
revoke all on public.driver_documents from anon,authenticated;
grant select,insert,update,delete on public.driver_documents to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-application-documents','driver-application-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;
create table if not exists public.driver_application_notifications (
 driver_user_id uuid primary key references auth.users(id) on delete cascade,
 welcome_email_sent_at timestamptz, admin_email_sent_at timestamptz, admin_whatsapp_sent_at timestamptz,
 last_attempt_at timestamptz, updated_at timestamptz not null default now()
);
alter table public.driver_application_notifications enable row level security;
revoke all on public.driver_application_notifications from anon,authenticated;
grant select,insert,update,delete on public.driver_application_notifications to service_role;

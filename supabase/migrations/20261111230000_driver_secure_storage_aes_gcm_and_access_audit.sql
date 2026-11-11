create extension if not exists pgcrypto with schema extensions;
do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='driver_pii_aes256_gcm_key') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'base64'),'driver_pii_aes256_gcm_key','SwiftHaul driver AES-256-GCM field encryption key');
 end if;
end $$;
create or replace function public.get_driver_pii_aes256_gcm_key()
returns text language plpgsql security definer set search_path=''
as $$ declare v text; begin
 select decrypted_secret into v from vault.decrypted_secrets where name='driver_pii_aes256_gcm_key';
 if v is null then raise exception 'driver AES-256-GCM key unavailable'; end if; return v;
end $$;
revoke all on function public.get_driver_pii_aes256_gcm_key() from public,anon,authenticated;
grant execute on function public.get_driver_pii_aes256_gcm_key() to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('driver-application-documents','driver-application-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
alter table public.driver_profiles add column if not exists sa_id_number_aesgcm text, add column if not exists passport_number_aesgcm text, add column if not exists account_number_aesgcm text, add column if not exists sa_id_hash text;
create unique index if not exists driver_profiles_sa_id_hash_unique on public.driver_profiles(sa_id_hash) where sa_id_hash is not null;
create table if not exists public.document_access_logs(id uuid primary key default gen_random_uuid(),admin_id uuid not null references auth.users(id) on delete restrict,driver_id uuid not null references public.driver_profiles(user_id) on delete cascade,document_id uuid not null references public.driver_documents(id) on delete cascade,document_type text not null,accessed_at timestamptz not null default now(),access_action text not null default 'signed_read_url');
create index if not exists document_access_logs_driver_accessed_idx on public.document_access_logs(driver_id,accessed_at desc);
alter table public.document_access_logs enable row level security;
revoke all on public.document_access_logs from public,anon,authenticated;
grant all on public.document_access_logs to service_role;
create table if not exists public.driver_upload_tickets(id uuid primary key default gen_random_uuid(),token_hash text not null unique,driver_user_id uuid not null references public.driver_profiles(user_id) on delete cascade,document_type text not null,object_path text not null unique,content_type text not null,original_name text not null,expiry_date date,issued_at date,expires_at timestamptz not null,consumed_at timestamptz,created_at timestamptz not null default now());
create index if not exists driver_upload_tickets_expiry_idx on public.driver_upload_tickets(expires_at) where consumed_at is null;
alter table public.driver_upload_tickets enable row level security;
revoke all on public.driver_upload_tickets from public,anon,authenticated;
grant all on public.driver_upload_tickets to service_role;
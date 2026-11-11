create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
 if not exists(select 1 from vault.decrypted_secrets where name='driver_pii_encryption_key') then
  perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'driver_pii_encryption_key','SwiftHaul driver identity and banking PII encryption key');
 end if;
end $$;

create or replace function public.encrypt_driver_pii(p_plaintext text)
returns text language plpgsql security definer set search_path=''
as $$
declare v_key text;
begin
 select decrypted_secret into v_key from vault.decrypted_secrets where name='driver_pii_encryption_key';
 if v_key is null then raise exception 'driver PII encryption key is not configured'; end if;
 return encode(extensions.pgp_sym_encrypt(p_plaintext,v_key,'cipher-algo=aes256,compress-algo=0'),'base64');
end $$;
create or replace function public.decrypt_driver_pii(p_ciphertext text)
returns text language plpgsql security definer set search_path=''
as $$
declare v_key text;
begin
 select decrypted_secret into v_key from vault.decrypted_secrets where name='driver_pii_encryption_key';
 if v_key is null then raise exception 'driver PII encryption key is not configured'; end if;
 return extensions.pgp_sym_decrypt(decode(p_ciphertext,'base64'),v_key);
end $$;
revoke all on function public.encrypt_driver_pii(text) from public,anon,authenticated;
revoke all on function public.decrypt_driver_pii(text) from public,anon,authenticated;
grant execute on function public.encrypt_driver_pii(text) to service_role;
grant execute on function public.decrypt_driver_pii(text) to service_role;

alter table public.driver_profiles
 add column if not exists onboarding_status text not null default 'incomplete',
 add column if not exists can_go_online boolean not null default false,
 add column if not exists identity_type text,
 add column if not exists identity_number_encrypted text,
 add column if not exists passport_number_encrypted text,
 add column if not exists identity_last4 text,
 add column if not exists licence_code text,
 add column if not exists prdp_holder boolean not null default false,
 add column if not exists prdp_category text,
 add column if not exists prdp_expiry date,
 add column if not exists vehicle_make text,
 add column if not exists vehicle_model text,
 add column if not exists vehicle_year integer,
 add column if not exists vehicle_gvm_kg integer,
 add column if not exists bank_name text,
 add column if not exists bank_account_holder text,
 add column if not exists bank_account_encrypted text,
 add column if not exists universal_branch_code text,
 add column if not exists criminal_background_clearance boolean not null default false,
 add column if not exists criminal_background_reviewed_by uuid references auth.users(id),
 add column if not exists criminal_background_reviewed_at timestamptz;
alter table public.driver_profiles drop constraint if exists driver_profiles_onboarding_status_check;
alter table public.driver_profiles add constraint driver_profiles_onboarding_status_check check(onboarding_status in ('incomplete','pending_review','approved','suspended'));
alter table public.driver_profiles drop constraint if exists driver_profiles_identity_type_check;
alter table public.driver_profiles add constraint driver_profiles_identity_type_check check(identity_type is null or identity_type in ('sa_citizen','foreign_national'));
alter table public.driver_profiles drop constraint if exists driver_profiles_prdp_category_check;
alter table public.driver_profiles add constraint driver_profiles_prdp_category_check check(prdp_category is null or prdp_category in ('goods','passengers','dangerous_goods'));

alter table public.driver_documents drop constraint if exists driver_documents_driver_user_id_fkey;
alter table public.driver_documents add constraint driver_documents_driver_user_id_fkey foreign key(driver_user_id) references public.driver_profiles(user_id) on delete cascade;
alter table public.driver_documents
 add column if not exists file_url text,
 add column if not exists expiry_date date,
 add column if not exists verification_status text not null default 'pending',
 add column if not exists rejection_reason text,
 add column if not exists issued_at date,
 add column if not exists alert_30_sent_at timestamptz,
 add column if not exists alert_7_sent_at timestamptz;
update public.driver_documents set file_url=storage_path where file_url is null;
update public.driver_documents set verification_status=case review_status when 'accepted' then 'approved' when 'rejected' then 'rejected' else 'pending' end;
alter table public.driver_documents drop constraint if exists driver_documents_verification_status_check;
alter table public.driver_documents add constraint driver_documents_verification_status_check check(verification_status in ('pending','approved','rejected','expired'));
create index if not exists driver_documents_driver_status_expiry_idx on public.driver_documents(driver_user_id,verification_status,expiry_date);
create index if not exists driver_profiles_onboarding_status_idx on public.driver_profiles(onboarding_status,can_go_online);
revoke all on public.driver_documents from anon,authenticated;
grant all on public.driver_documents to service_role;

alter table public.driver_onboarding_applications add column if not exists identity_details_encrypted text, add column if not exists banking_details_encrypted text;
do $$
declare r record;
begin
 for r in select driver_user_id,identity_details,banking_details from public.driver_onboarding_applications loop
  update public.driver_onboarding_applications
  set identity_details_encrypted=coalesce(identity_details_encrypted,public.encrypt_driver_pii(coalesce(r.identity_details,'{}'::jsonb)::text)),
      banking_details_encrypted=coalesce(banking_details_encrypted,public.encrypt_driver_pii(coalesce(r.banking_details,'{}'::jsonb)::text)),
      identity_details='{}'::jsonb,banking_details='{}'::jsonb
  where driver_user_id=r.driver_user_id;
 end loop;
end $$;

create table if not exists public.driver_verification_audit(
 id uuid primary key default gen_random_uuid(),driver_user_id uuid not null references public.driver_profiles(user_id) on delete cascade,
 document_id uuid references public.driver_documents(id) on delete set null,actor_user_id uuid references auth.users(id) on delete set null,
 event_type text not null,details jsonb not null default '{}'::jsonb,created_at timestamptz not null default now());
create index if not exists driver_verification_audit_driver_created_idx on public.driver_verification_audit(driver_user_id,created_at desc);
alter table public.driver_verification_audit enable row level security;
revoke all on public.driver_verification_audit from public,anon,authenticated;
grant all on public.driver_verification_audit to service_role;

create table if not exists public.driver_onboarding_notifications(
 id uuid primary key default gen_random_uuid(),driver_user_id uuid not null references public.driver_profiles(user_id) on delete cascade,
 document_id uuid references public.driver_documents(id) on delete cascade,notification_type text not null,title text not null,message text not null,
 read_at timestamptz,created_at timestamptz not null default now(),unique(document_id,notification_type));
alter table public.driver_onboarding_notifications enable row level security;
revoke all on public.driver_onboarding_notifications from public,anon,authenticated;
grant all on public.driver_onboarding_notifications to service_role;

create or replace function public.refresh_driver_online_eligibility(p_driver_user_id uuid)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_profile public.driver_profiles%rowtype;v_required text[];v_ok boolean;
begin
 select * into v_profile from public.driver_profiles where user_id=p_driver_user_id;
 if not found then return false; end if;
 if v_profile.identity_type='sa_citizen' then
  v_required:=array['id_front','id_back','profile_selfie','licence_front','licence_back','vehicle_licence_disc','vehicle_insurance','proof_of_address'];
 elsif v_profile.identity_type='foreign_national' then
  v_required:=array['passport','work_permit','licence_front','licence_back','vehicle_licence_disc','vehicle_insurance','proof_of_address'];
 else
  v_required:=array['id_document','proof_of_address','bank_confirmation','drivers_licence','vehicle_document'];
 end if;
 select v_profile.onboarding_status='approved' and v_profile.criminal_background_clearance
  and not exists(select 1 from unnest(v_required) req(t) where not exists(
   select 1 from public.driver_documents d where d.driver_user_id=p_driver_user_id and d.document_type=req.t and d.verification_status='approved' and (d.expiry_date is null or d.expiry_date>=current_date)))
  and exists(select 1 from public.driver_documents d where d.driver_user_id=p_driver_user_id and d.document_type in ('enatis_certificate','fleet_lease_agreement','vehicle_document') and d.verification_status='approved' and (d.expiry_date is null or d.expiry_date>=current_date))
  and (not v_profile.prdp_holder or exists(select 1 from public.driver_documents d where d.driver_user_id=p_driver_user_id and d.document_type='prdp' and d.verification_status='approved' and (d.expiry_date is null or d.expiry_date>=current_date)))
 into v_ok;
 update public.driver_profiles set can_go_online=coalesce(v_ok,false),is_online=case when coalesce(v_ok,false) then is_online else false end,
  availability_status=case when coalesce(v_ok,false) then availability_status else 'offline' end,updated_at=now() where user_id=p_driver_user_id;
 return coalesce(v_ok,false);
end $$;
revoke all on function public.refresh_driver_online_eligibility(uuid) from public,anon,authenticated;
grant execute on function public.refresh_driver_online_eligibility(uuid) to service_role;

create or replace function public.driver_documents_refresh_eligibility_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 if tg_op='DELETE' then perform public.refresh_driver_online_eligibility(old.driver_user_id);return old;end if;
 perform public.refresh_driver_online_eligibility(new.driver_user_id);return new;
end $$;
revoke all on function public.driver_documents_refresh_eligibility_trigger() from public,anon,authenticated;
drop trigger if exists driver_documents_refresh_eligibility on public.driver_documents;
create trigger driver_documents_refresh_eligibility after insert or update or delete on public.driver_documents for each row execute function public.driver_documents_refresh_eligibility_trigger();

create or replace function public.driver_profiles_refresh_eligibility_trigger()
returns trigger language plpgsql security definer set search_path=''
as $$ begin
 if new.onboarding_status is distinct from old.onboarding_status or new.criminal_background_clearance is distinct from old.criminal_background_clearance or new.identity_type is distinct from old.identity_type or new.prdp_holder is distinct from old.prdp_holder then
  perform public.refresh_driver_online_eligibility(new.user_id);
 end if;
 return new;
end $$;
revoke all on function public.driver_profiles_refresh_eligibility_trigger() from public,anon,authenticated;
drop trigger if exists driver_profiles_refresh_eligibility on public.driver_profiles;
create trigger driver_profiles_refresh_eligibility after update on public.driver_profiles for each row execute function public.driver_profiles_refresh_eligibility_trigger();

create or replace function public.process_driver_document_expiry()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_today date:=timezone('Africa/Johannesburg',now())::date;v_expired integer:=0;v_30 integer:=0;v_7 integer:=0;r record;
begin
 for r in select d.id,d.driver_user_id,d.document_type,d.expiry_date from public.driver_documents d
  where d.expiry_date is not null and d.verification_status in ('pending','approved','rejected')
 loop
  if r.expiry_date<=v_today then
   update public.driver_documents set verification_status='expired',review_status='rejected',
    rejection_reason='Document expired on '||r.expiry_date::text,review_note='Document expired automatically'
   where id=r.id and verification_status<>'expired';
   if found then
    v_expired:=v_expired+1;
    insert into public.driver_verification_audit(driver_user_id,document_id,event_type,details)
     values(r.driver_user_id,r.id,'document_expired',jsonb_build_object('document_type',r.document_type,'expiry_date',r.expiry_date));
    insert into public.driver_onboarding_notifications(driver_user_id,document_id,notification_type,title,message)
     values(r.driver_user_id,r.id,'document_expired','Document expired','Your '||replace(r.document_type,'_',' ')||' has expired. Upload a current document to restore driver eligibility.')
     on conflict(document_id,notification_type) do nothing;
   end if;
  elsif r.expiry_date=v_today+30 then
   insert into public.driver_onboarding_notifications(driver_user_id,document_id,notification_type,title,message)
    values(r.driver_user_id,r.id,'expiry_30_day','Document expires in 30 days','Your '||replace(r.document_type,'_',' ')||' expires in 30 days. Upload a renewed document before it expires.')
    on conflict(document_id,notification_type) do nothing;
   update public.driver_documents set alert_30_sent_at=coalesce(alert_30_sent_at,now()) where id=r.id;v_30:=v_30+1;
  elsif r.expiry_date=v_today+7 then
   insert into public.driver_onboarding_notifications(driver_user_id,document_id,notification_type,title,message)
    values(r.driver_user_id,r.id,'expiry_7_day','Document expires in 7 days','Your '||replace(r.document_type,'_',' ')||' expires in 7 days. Upload a renewed document now.')
    on conflict(document_id,notification_type) do nothing;
   update public.driver_documents set alert_7_sent_at=coalesce(alert_7_sent_at,now()) where id=r.id;v_7:=v_7+1;
  end if;
 end loop;
 return jsonb_build_object('expired',v_expired,'warning_30_day',v_30,'warning_7_day',v_7);
end $$;
revoke all on function public.process_driver_document_expiry() from public,anon,authenticated;
grant execute on function public.process_driver_document_expiry() to service_role;
select cron.schedule('driver-document-expiry-0600-sast','0 4 * * *','select public.process_driver_document_expiry();');
update public.driver_profiles set onboarding_status=case when verification_status='approved' then 'approved' else 'pending_review' end;
update public.driver_profiles set can_go_online=false,is_online=false,availability_status='offline';

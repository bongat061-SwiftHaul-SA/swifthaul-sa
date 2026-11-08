alter table public.customer_bookings
  drop constraint if exists customer_bookings_payment_method_check,
  add constraint customer_bookings_payment_method_check
    check (payment_method = any (array['cash'::text,'dispatch'::text,'eft'::text])),
  drop constraint if exists customer_bookings_payment_source_check,
  add constraint customer_bookings_payment_source_check
    check (payment_source is null or payment_source = any (array['cash'::text,'wallet'::text,'payfast'::text,'paystack'::text,'pay_later'::text,'eft'::text]));

create table public.customer_eft_payments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  payment_reference text not null unique,
  customer_reference text,
  amount_cents bigint not null check (amount_cents > 0),
  proof_object_path text not null,
  status text not null default 'submitted' check (status = any (array['submitted'::text,'verified'::text,'rejected'::text])),
  admin_reference text,
  rejection_reason text,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_eft_proof_path_check check (length(proof_object_path) between 10 and 500 and proof_object_path !~ '(^/|\\.\\.|\\\\)'),
  constraint customer_eft_review_state_check check (
    (status='submitted' and reviewed_by is null and reviewed_at is null)
    or (status in ('verified','rejected') and reviewed_by is not null and reviewed_at is not null)
  )
);
create unique index customer_eft_one_submitted_per_booking on public.customer_eft_payments(waybill) where status='submitted';
create unique index customer_eft_admin_reference_unique on public.customer_eft_payments(lower(admin_reference)) where admin_reference is not null and status='verified';
create index customer_eft_payments_queue_idx on public.customer_eft_payments(status,created_at desc);
alter table public.customer_eft_payments enable row level security;
revoke all on public.customer_eft_payments from anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('customer-eft-proofs','customer-eft-proofs',false,8388608,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=8388608,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];

create policy customer_eft_proof_upload_own_folder on storage.objects
for insert to authenticated with check (
  bucket_id='customer-eft-proofs'
  and (storage.foldername(name))[1]=(select auth.uid()::text)
  and (storage.foldername(name))[2] is not null
  and storage.extension(name)=any(array['pdf','jpg','jpeg','png'])
);

create or replace function public.submit_customer_eft_proof(p_waybill text,p_proof_object_path text,p_customer_reference text default null)
returns jsonb language plpgsql security definer
set search_path=public,auth,storage,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_booking public.customer_bookings%rowtype;
  v_existing public.customer_eft_payments%rowtype; v_id uuid:=gen_random_uuid();
  v_reference text:='SH-EFT-'||upper(substr(replace(v_id::text,'-',''),1,12)); v_amount bigint;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_waybill is null or length(p_waybill)>100 or p_proof_object_path is null
    or p_proof_object_path not like v_uid::text||'/'||p_waybill||'/%'
    or p_proof_object_path ~ '(^/|\\.\\.|\\\\)'
    or length(coalesce(p_customer_reference,''))>100 then
    raise exception 'invalid_eft_proof_details' using errcode='22023';
  end if;
  if not exists(select 1 from public.user_profiles where id=v_uid and role='customer' and account_status='active') then
    raise exception 'active_customer_account_required' using errcode='42501';
  end if;
  select * into v_booking from public.customer_bookings where waybill=p_waybill and owner_hash=v_uid::text for update;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.paid_at is not null or v_booking.payment_source is not null or v_booking.status in ('cancelled','delivered') then
    raise exception 'booking_not_eligible_for_eft' using errcode='23514';
  end if;
  if v_booking.payment_method not in ('eft','dispatch') then raise exception 'booking_not_set_to_eft' using errcode='23514'; end if;
  if not exists(select 1 from storage.objects where bucket_id='customer-eft-proofs' and name=p_proof_object_path and owner_id=v_uid::text) then
    raise exception 'eft_proof_file_not_found_or_not_owned' using errcode='42501';
  end if;
  select * into v_existing from public.customer_eft_payments where waybill=p_waybill and status='submitted' for update;
  if found then return jsonb_build_object('already_submitted',true,'payment_reference',v_existing.payment_reference,'status',v_existing.status,'amount_cents',v_existing.amount_cents); end if;
  v_amount:=round(v_booking.price*100)::bigint;
  insert into public.customer_eft_payments(id,owner_id,waybill,payment_reference,customer_reference,amount_cents,proof_object_path)
  values(v_id,v_uid,p_waybill,v_reference,nullif(trim(coalesce(p_customer_reference,'')),''),v_amount,p_proof_object_path);
  update public.customer_bookings set payment_method='eft' where waybill=p_waybill;
  return jsonb_build_object('already_submitted',false,'payment_reference',v_reference,'status','submitted','amount_cents',v_amount);
end $$;

create or replace function public.review_customer_eft_payment(p_payment_id uuid,p_decision text,p_admin_reference text default null,p_rejection_reason text default null)
returns jsonb language plpgsql security definer
set search_path=public,auth,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_payment public.customer_eft_payments%rowtype; v_booking public.customer_bookings%rowtype;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if not exists(select 1 from public.user_profiles where id=v_uid and role='admin' and account_status='active') then
    raise exception 'administrator_access_required' using errcode='42501';
  end if;
  if p_decision not in ('verified','rejected') then raise exception 'invalid_review_decision' using errcode='22023'; end if;
  if p_decision='verified' and (p_admin_reference is null or length(trim(p_admin_reference))<3 or length(trim(p_admin_reference))>120) then
    raise exception 'bank_statement_reference_required' using errcode='22023';
  end if;
  if p_decision='rejected' and (p_rejection_reason is null or length(trim(p_rejection_reason))<3 or length(trim(p_rejection_reason))>500) then
    raise exception 'rejection_reason_required' using errcode='22023';
  end if;
  select * into v_payment from public.customer_eft_payments where id=p_payment_id for update;
  if not found then raise exception 'eft_submission_not_found' using errcode='P0002'; end if;
  if v_payment.status<>'submitted' then return jsonb_build_object('already_reviewed',true,'status',v_payment.status,'payment_reference',v_payment.payment_reference); end if;
  select * into v_booking from public.customer_bookings where waybill=v_payment.waybill for update;
  if not found or v_booking.owner_hash<>v_payment.owner_id::text or v_booking.paid_at is not null or v_booking.status in ('cancelled','delivered') then
    raise exception 'booking_state_changed_recheck_before_review' using errcode='23514';
  end if;
  if p_decision='verified' then
    update public.customer_bookings set paid_at=now(),payment_source='eft',payment_method='eft' where waybill=v_payment.waybill and paid_at is null;
    if not found then raise exception 'booking_payment_already_confirmed' using errcode='23505'; end if;
    update public.customer_eft_payments set status='verified',admin_reference=trim(p_admin_reference),reviewed_by=v_uid,reviewed_at=now(),updated_at=now() where id=p_payment_id;
  else
    update public.customer_eft_payments set status='rejected',rejection_reason=trim(p_rejection_reason),reviewed_by=v_uid,reviewed_at=now(),updated_at=now() where id=p_payment_id;
  end if;
  return jsonb_build_object('already_reviewed',false,'status',p_decision,'payment_reference',v_payment.payment_reference,'waybill',v_payment.waybill);
end $$;

revoke all on function public.submit_customer_eft_proof(text,text,text) from public,anon;
revoke all on function public.review_customer_eft_payment(uuid,text,text,text) from public,anon;
grant execute on function public.submit_customer_eft_proof(text,text,text) to authenticated;
grant execute on function public.review_customer_eft_payment(uuid,text,text,text) to authenticated;

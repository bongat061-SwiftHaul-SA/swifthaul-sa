-- SwiftHaul cash collection, driver cash-clearing ledger and verified settlement.
-- Apply only to an isolated test/staging Supabase project after review.
begin;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('driver-cash-receipts','driver-cash-receipts',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists driver_cash_receipt_signature_upload on storage.objects;
create policy driver_cash_receipt_signature_upload on storage.objects
for insert to authenticated
with check (bucket_id='driver-cash-receipts' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists driver_cash_receipt_signature_read on storage.objects;
create policy driver_cash_receipt_signature_read on storage.objects
for select to authenticated
using (bucket_id='driver-cash-receipts' and (storage.foldername(name))[1]=auth.uid()::text);

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('driver-cash-deposit-proofs','driver-cash-deposit-proofs',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists driver_cash_deposit_proof_upload on storage.objects;
create policy driver_cash_deposit_proof_upload on storage.objects
for insert to authenticated
with check (bucket_id='driver-cash-deposit-proofs' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists driver_cash_deposit_proof_read on storage.objects;
create policy driver_cash_deposit_proof_read on storage.objects
for select to authenticated
using (bucket_id='driver-cash-deposit-proofs' and (storage.foldername(name))[1]=auth.uid()::text);

drop policy if exists driver_cash_receipt_signature_admin_read on storage.objects;
create policy driver_cash_receipt_signature_admin_read on storage.objects
for select to authenticated
using (
  bucket_id='driver-cash-receipts'
  and storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
  and exists (select 1 from public.user_profiles up
    where up.id=auth.uid() and up.role='admin' and up.account_status='active')
);
drop policy if exists driver_cash_deposit_proof_admin_read on storage.objects;
create policy driver_cash_deposit_proof_admin_read on storage.objects
for select to authenticated
using (
  bucket_id='driver-cash-deposit-proofs'
  and storage.allow_any_operation(array['object.get_authenticated_info','object.get_authenticated'])
  and exists (select 1 from public.user_profiles up
    where up.id=auth.uid() and up.role='admin' and up.account_status='active')
);

-- The current PayFast ITN RPC writes payment_source='payfast'. The linked
-- database check constraint omitted that value, which would reject the ITN update.
alter table public.customer_bookings
  drop constraint if exists customer_bookings_payment_source_check;
alter table public.customer_bookings
  add constraint customer_bookings_payment_source_check
  check (payment_source is null or payment_source = any (
    array['cash','wallet','payfast','paystack','pay_later']::text[]
  ));

create table if not exists public.driver_cash_receipts (
  id uuid primary key default gen_random_uuid(),
  waybill text not null references public.customer_bookings(waybill) on delete restrict,
  driver_user_id uuid not null references auth.users(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  customer_signed_name text not null check (length(trim(customer_signed_name)) between 2 and 120),
  customer_signature_object text not null check (length(trim(customer_signature_object)) between 3 and 500),
  receipt_reference text not null unique,
  driver_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (waybill)
);

create table if not exists public.driver_cash_clearing_ledger (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete restrict,
  event_key text not null unique,
  event_type text not null check (event_type in (
    'cash_received_from_customer','cash_deposit_reconciled',
    'cash_receipt_reversal','cash_variance_adjustment'
  )),
  amount_cents bigint not null check (amount_cents <> 0),
  waybill text references public.customer_bookings(waybill) on delete restrict,
  cash_receipt_id uuid references public.driver_cash_receipts(id) on delete restrict,
  deposit_id uuid,
  description text not null check (length(trim(description)) between 3 and 500),
  created_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists driver_cash_clearing_driver_created_idx
  on public.driver_cash_clearing_ledger(driver_user_id, created_at desc);
create index if not exists driver_cash_clearing_waybill_idx
  on public.driver_cash_clearing_ledger(waybill);

create table if not exists public.driver_cash_deposits (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete restrict,
  reference text not null unique,
  amount_cents bigint not null check (amount_cents > 0),
  channel text not null check (channel in ('eft','participating_store')),
  status text not null default 'awaiting_deposit' check (status in (
    'awaiting_deposit','proof_submitted','reconciled','rejected','expired'
  )),
  proof_object text,
  driver_note text,
  reconciled_by uuid references auth.users(id) on delete restrict,
  reconciled_at timestamptz,
  bank_statement_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status <> 'reconciled') or (reconciled_by is not null and reconciled_at is not null and bank_statement_reference is not null))
);
create index if not exists driver_cash_deposits_driver_created_idx
  on public.driver_cash_deposits(driver_user_id, created_at desc);

alter table public.driver_cash_clearing_ledger
  drop constraint if exists driver_cash_clearing_deposit_fk;
alter table public.driver_cash_clearing_ledger
  add constraint driver_cash_clearing_deposit_fk
  foreign key (deposit_id) references public.driver_cash_deposits(id) on delete restrict;

alter table public.driver_cash_receipts enable row level security;
alter table public.driver_cash_clearing_ledger enable row level security;
alter table public.driver_cash_deposits enable row level security;

drop policy if exists driver_cash_receipts_read_own on public.driver_cash_receipts;
create policy driver_cash_receipts_read_own on public.driver_cash_receipts
  for select to authenticated using (driver_user_id = auth.uid());
drop policy if exists driver_cash_ledger_read_own on public.driver_cash_clearing_ledger;
create policy driver_cash_ledger_read_own on public.driver_cash_clearing_ledger
  for select to authenticated using (driver_user_id = auth.uid());
drop policy if exists driver_cash_deposits_read_own on public.driver_cash_deposits;
create policy driver_cash_deposits_read_own on public.driver_cash_deposits
  for select to authenticated using (driver_user_id = auth.uid());

revoke all on public.driver_cash_receipts, public.driver_cash_clearing_ledger, public.driver_cash_deposits from anon, authenticated;
grant select on public.driver_cash_receipts, public.driver_cash_clearing_ledger, public.driver_cash_deposits to authenticated;
grant all on public.driver_cash_receipts, public.driver_cash_clearing_ledger, public.driver_cash_deposits to service_role;

create or replace function public.record_driver_cash_receipt(
  p_waybill text,
  p_amount_cents bigint,
  p_customer_signed_name text,
  p_customer_signature_object text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver uuid := auth.uid();
  v_booking public.customer_bookings%rowtype;
  v_expected bigint;
  v_receipt public.driver_cash_receipts%rowtype;
  v_reference text;
begin
  if v_driver is null or p_waybill is null or length(trim(p_waybill)) not between 3 and 100
    or p_amount_cents is null or p_amount_cents <= 0
    or p_customer_signed_name is null or length(trim(p_customer_signed_name)) not between 2 and 120
    or p_customer_signature_object is null
    or p_customer_signature_object not like v_driver::text || '/%'
    or length(trim(p_customer_signature_object)) not between 3 and 500
    or not exists (select 1 from storage.objects so
      where so.bucket_id='driver-cash-receipts' and so.name=trim(p_customer_signature_object)) then
    raise exception 'Valid cash receipt details and customer signature are required' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_driver::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_waybill, 0));
  select * into v_booking from public.customer_bookings where waybill = p_waybill for update;
  if not found then raise exception 'Booking not found' using errcode='P0002'; end if;
  if v_booking.driver_user_id is distinct from v_driver
    or v_booking.payment_method <> 'cash'
    or v_booking.status <> 'delivered' then
    raise exception 'Only the assigned driver on an active cash booking may record receipt' using errcode='42501';
  end if;
  if v_booking.paid_at is not null then
    raise exception 'This booking is already recorded as paid' using errcode='23505';
  end if;

  v_expected := round(v_booking.price * 100)::bigint;
  if coalesce(v_booking.assistance_requested,false) and v_booking.assistance_status = 'accepted' then
    v_expected := v_expected + coalesce(v_booking.assistance_fee_cents,0);
  end if;
  if p_amount_cents <> v_expected then
    raise exception 'Cash amount does not match the confirmed booking total' using errcode='22023';
  end if;

  v_reference := 'SHC-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
  insert into public.driver_cash_receipts(
    waybill,driver_user_id,amount_cents,customer_signed_name,customer_signature_object,receipt_reference
  ) values (
    p_waybill,v_driver,p_amount_cents,trim(p_customer_signed_name),trim(p_customer_signature_object),v_reference
  ) returning * into v_receipt;

  insert into public.driver_cash_clearing_ledger(
    driver_user_id,event_key,event_type,amount_cents,waybill,cash_receipt_id,description,created_by
  ) values (
    v_driver,'cash-received:' || v_receipt.id,'cash_received_from_customer',p_amount_cents,
    p_waybill,v_receipt.id,'Customer cash received for waybill ' || p_waybill,v_driver
  );

  update public.customer_bookings
    set paid_at = now(), payment_source = 'cash'
    where waybill = p_waybill and paid_at is null;

  return jsonb_build_object(
    'receipt_id',v_receipt.id,'receipt_reference',v_reference,
    'amount_cents',p_amount_cents,'currency','ZAR','status','cash_received_pending_company_reconciliation'
  );
end;
$$;

create or replace function public.create_driver_cash_deposit(
  p_amount_cents bigint,
  p_channel text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver uuid := auth.uid();
  v_outstanding bigint;
  v_deposit public.driver_cash_deposits%rowtype;
  v_ref text;
begin
  if v_driver is null or p_amount_cents is null or p_amount_cents <= 0
    or p_channel is null or p_channel not in ('eft','participating_store') then
    raise exception 'Valid deposit amount and channel are required' using errcode='22023';
  end if;
  if not exists(select 1 from public.user_profiles where id=v_driver and role='driver' and account_status='active')
    or not exists(select 1 from public.driver_profiles where user_id=v_driver and verification_status='approved') then
    raise exception 'Approved active driver required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_driver::text, 0));
  if exists(select 1 from public.driver_cash_deposits
    where driver_user_id=v_driver and status in ('awaiting_deposit','proof_submitted')) then
    raise exception 'A cash deposit instruction is already awaiting completion' using errcode='23505';
  end if;
  select coalesce(sum(amount_cents),0) into v_outstanding
    from public.driver_cash_clearing_ledger where driver_user_id=v_driver;
  if p_amount_cents > v_outstanding then
    raise exception 'Deposit exceeds outstanding cash held for SwiftHaul' using errcode='22023';
  end if;
  v_ref := 'SHD-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,18));
  insert into public.driver_cash_deposits(driver_user_id,reference,amount_cents,channel)
    values(v_driver,v_ref,p_amount_cents,p_channel) returning * into v_deposit;
  return jsonb_build_object('id',v_deposit.id,'reference',v_ref,'amount_cents',p_amount_cents,'channel',p_channel,'status',v_deposit.status);
end;
$$;

create or replace function public.submit_driver_cash_deposit_proof(
  p_deposit_id uuid,
  p_proof_object text,
  p_driver_note text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver uuid := auth.uid();
  v_deposit public.driver_cash_deposits%rowtype;
begin
  if v_driver is null or p_deposit_id is null or p_proof_object is null
    or p_proof_object not like v_driver::text || '/%'
    or length(trim(p_proof_object)) not between 3 and 500
    or not exists (select 1 from storage.objects so
      where so.bucket_id='driver-cash-deposit-proofs' and so.name=trim(p_proof_object))
    or (p_driver_note is not null and length(p_driver_note)>500) then
    raise exception 'Valid deposit proof is required' using errcode='22023';
  end if;
  update public.driver_cash_deposits
    set proof_object=trim(p_proof_object),driver_note=nullif(trim(p_driver_note),''),status='proof_submitted',updated_at=now()
    where id=p_deposit_id and driver_user_id=v_driver and status='awaiting_deposit'
    returning * into v_deposit;
  if not found then raise exception 'Pending deposit instruction not found' using errcode='P0002'; end if;
  return jsonb_build_object('id',v_deposit.id,'reference',v_deposit.reference,'status',v_deposit.status);
end;
$$;

create or replace function public.reconcile_driver_cash_deposit(
  p_deposit_id uuid,
  p_action text,
  p_bank_statement_reference text,
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_deposit public.driver_cash_deposits%rowtype;
  v_outstanding bigint;
begin
  if v_admin is null or not exists(select 1 from public.user_profiles where id=v_admin and role='admin' and account_status='active') then
    raise exception 'Active administrator required' using errcode='42501';
  end if;
  if p_deposit_id is null or p_action is null or p_action not in ('reconcile','reject') then
    raise exception 'Invalid reconciliation action' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_deposit_id::text,0));
  select * into v_deposit from public.driver_cash_deposits where id=p_deposit_id for update;
  if not found or v_deposit.status <> 'proof_submitted' then
    raise exception 'Deposit is not awaiting reconciliation' using errcode='55000';
  end if;
  if p_action='reject' then
    if p_reason is null or length(trim(p_reason)) not between 3 and 500 then
      raise exception 'A reason is required to reject a deposit' using errcode='22023';
    end if;
    update public.driver_cash_deposits set status='rejected',reconciled_by=v_admin,reconciled_at=now(),
      bank_statement_reference='REJECTED: ' || trim(p_reason),updated_at=now() where id=p_deposit_id;
    return jsonb_build_object('id',p_deposit_id,'status','rejected');
  end if;
  if p_bank_statement_reference is null or length(trim(p_bank_statement_reference)) not between 3 and 200 then
    raise exception 'Actual bank statement reference is required' using errcode='22023';
  end if;
  select coalesce(sum(amount_cents),0) into v_outstanding
    from public.driver_cash_clearing_ledger where driver_user_id=v_deposit.driver_user_id;
  if v_deposit.amount_cents > v_outstanding then
    raise exception 'Deposit exceeds outstanding cash liability' using errcode='22023';
  end if;
  update public.driver_cash_deposits set status='reconciled',reconciled_by=v_admin,reconciled_at=now(),
    bank_statement_reference=trim(p_bank_statement_reference),updated_at=now() where id=p_deposit_id;
  insert into public.driver_cash_clearing_ledger(
    driver_user_id,event_key,event_type,amount_cents,deposit_id,description,created_by
  ) values (
    v_deposit.driver_user_id,'cash-deposit-reconciled:' || v_deposit.id,
    'cash_deposit_reconciled',-v_deposit.amount_cents,v_deposit.id,
    'Company reconciled deposit ' || v_deposit.reference || ' against bank statement ' || trim(p_bank_statement_reference),v_admin
  );
  return jsonb_build_object('id',p_deposit_id,'status','reconciled','amount_cents',v_deposit.amount_cents);
end;
$$;

-- Earnings are credited only once the delivery is both delivered and paid.
create or replace function public.credit_driver_earning_on_delivery()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_gross_cents bigint;
  v_driver_cents bigint;
begin
  if new.status = 'delivered'
     and new.paid_at is not null
     and new.driver_user_id is not null
     and new.price is not null
     and new.price > 0
     and (old.status is distinct from 'delivered' or old.paid_at is null) then
    v_gross_cents := round(new.price * 100)::bigint;
    v_driver_cents := round(v_gross_cents * 0.75)::bigint;
    if v_driver_cents > 0 then
      insert into public.driver_earnings_ledger (
        driver_user_id,event_key,event_type,amount_cents,waybill,description
      ) values (
        new.driver_user_id,'delivery-earning:' || new.waybill,'earning',v_driver_cents,new.waybill,
        'Driver share: 75% of delivery charge R' || to_char(new.price,'FM999999990.00')
      ) on conflict (event_key) do nothing;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists credit_driver_earning_after_delivery on public.customer_bookings;
create trigger credit_driver_earning_after_delivery
after update of status, paid_at on public.customer_bookings
for each row
when (new.status = 'delivered' and new.paid_at is not null)
execute function public.credit_driver_earning_on_delivery();

-- Prevent payout while any driver cash liability remains outstanding.
create or replace function public.guard_driver_payout_cash_liability()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_outstanding bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.driver_user_id::text, 0));
  select coalesce(sum(amount_cents),0) into v_outstanding
    from public.driver_cash_clearing_ledger where driver_user_id=new.driver_user_id;
  if v_outstanding > 0 and (
    (tg_op = 'INSERT') or
    (tg_op = 'UPDATE' and new.status in ('approved','paid'))
  ) then
    raise exception 'Outstanding cash held for SwiftHaul must be reconciled before payout approval or payment' using errcode='55000';
  end if;
  return new;
end;
$$;
drop trigger if exists guard_driver_payout_cash_liability on public.driver_payout_requests;
create trigger guard_driver_payout_cash_liability
before insert or update of status on public.driver_payout_requests
for each row execute function public.guard_driver_payout_cash_liability();

revoke all on function public.record_driver_cash_receipt(text,bigint,text,text) from public, anon;
revoke all on function public.create_driver_cash_deposit(bigint,text) from public, anon;
revoke all on function public.submit_driver_cash_deposit_proof(uuid,text,text) from public, anon;
revoke all on function public.reconcile_driver_cash_deposit(uuid,text,text,text) from public, anon;
grant execute on function public.record_driver_cash_receipt(text,bigint,text,text) to authenticated;
grant execute on function public.create_driver_cash_deposit(bigint,text) to authenticated;
grant execute on function public.submit_driver_cash_deposit_proof(uuid,text,text) to authenticated;
grant execute on function public.reconcile_driver_cash_deposit(uuid,text,text,text) to authenticated;

commit;

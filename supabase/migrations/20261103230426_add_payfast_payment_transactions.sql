create table if not exists public.payment_transactions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  booking_waybill text not null references public.customer_bookings(waybill) on delete restrict,
  provider text not null default 'payfast' check (provider = 'payfast'),
  m_payment_id text not null unique,
  pf_payment_id text unique,
  amount numeric(12,2) not null check (amount >= 5.00),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  status text not null default 'pending' check (status in ('pending','complete','failed','cancelled')),
  payment_mode text not null default 'sandbox' check (payment_mode = 'sandbox'),
  raw_itn jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists payment_transactions_owner_created_idx on public.payment_transactions (owner_id, created_at desc);
create index if not exists payment_transactions_booking_idx on public.payment_transactions (booking_waybill, created_at desc);
alter table public.payment_transactions enable row level security;
revoke all on public.payment_transactions from anon, authenticated;
create or replace function public.apply_payfast_payment(p_payment_id uuid,p_pf_payment_id text,p_amount numeric,p_payload jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare v_payment public.payment_transactions%rowtype; v_updated integer;
begin
  select * into v_payment from public.payment_transactions where id=p_payment_id for update;
  if not found then return false; end if;
  if v_payment.status='complete' then return v_payment.pf_payment_id=p_pf_payment_id; end if;
  if v_payment.status<>'pending' or round(v_payment.amount,2)<>round(p_amount,2) or p_pf_payment_id is null or length(p_pf_payment_id)>100 then return false; end if;
  update public.payment_transactions set status='complete',pf_payment_id=p_pf_payment_id,raw_itn=p_payload,completed_at=now(),updated_at=now()
  where id=p_payment_id and status='pending';
  get diagnostics v_updated=row_count;
  if v_updated<>1 then return false; end if;
  update public.customer_bookings set paid_at=now(),payment_source='payfast'
  where waybill=v_payment.booking_waybill and owner_hash=v_payment.owner_id::text and paid_at is null and refunded_at is null;
  get diagnostics v_updated=row_count;
  if v_updated<>1 then raise exception 'Booking is no longer eligible for payment confirmation'; end if;
  return true;
end; $$;
revoke all on function public.apply_payfast_payment(uuid,text,numeric,jsonb) from public, anon, authenticated;
grant execute on function public.apply_payfast_payment(uuid,text,numeric,jsonb) to service_role;

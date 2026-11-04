create table if not exists public.wallet_payfast_payments (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null references public.wallet_accounts(owner_hash) on delete restrict,
  loan_id uuid not null references public.wallet_loans(id) on delete restrict,
  m_payment_id text not null unique,
  pf_payment_id text unique,
  amount_cents bigint not null check (amount_cents >= 500 and amount_cents <= 50000),
  currency text not null default 'ZAR' check (currency = 'ZAR'),
  status text not null default 'pending' check (status in ('pending','complete','failed','cancelled')),
  payment_mode text not null default 'sandbox' check (payment_mode = 'sandbox'),
  raw_itn jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists wallet_payfast_owner_created_idx on public.wallet_payfast_payments(owner_hash, created_at desc);
create index if not exists wallet_payfast_loan_created_idx on public.wallet_payfast_payments(loan_id, created_at desc);
create unique index if not exists wallet_payfast_one_pending_per_loan_idx on public.wallet_payfast_payments(loan_id) where status = 'pending';
alter table public.wallet_payfast_payments enable row level security;
revoke all on public.wallet_payfast_payments from anon, authenticated;

create or replace function public.apply_payfast_wallet_repayment(
  p_payment_id uuid, p_pf_payment_id text, p_amount numeric, p_payload jsonb
) returns boolean language plpgsql security definer set search_path = public as $$
declare v_payment public.wallet_payfast_payments%rowtype; v_loan public.wallet_loans%rowtype; v_rows integer;
begin
  select * into v_payment from public.wallet_payfast_payments where id=p_payment_id for update;
  if not found then return false; end if;
  if v_payment.status='complete' then return v_payment.pf_payment_id=p_pf_payment_id; end if;
  if v_payment.status<>'pending' or p_pf_payment_id is null or length(p_pf_payment_id)>100
     or round(v_payment.amount_cents::numeric,2)<>round(p_amount*100,2) then return false; end if;
  select * into v_loan from public.wallet_loans where id=v_payment.loan_id and owner_hash=v_payment.owner_hash for update;
  if not found or v_loan.paid_at is not null or v_loan.amount_cents<>v_payment.amount_cents then return false; end if;
  update public.wallet_payfast_payments set status='complete',pf_payment_id=p_pf_payment_id,raw_itn=p_payload,completed_at=now(),updated_at=now()
    where id=p_payment_id and status='pending';
  get diagnostics v_rows=row_count;
  if v_rows<>1 then return false; end if;
  update public.wallet_loans set paid_at=now() where id=v_loan.id and owner_hash=v_payment.owner_hash and paid_at is null;
  get diagnostics v_rows=row_count;
  if v_rows<>1 then raise exception 'Wallet loan was not eligible for repayment'; end if;
  insert into public.wallet_ledger(owner_hash,event_key,refund_delta,promo_delta,description,promo_debt_delta)
    values(v_payment.owner_hash,'payfast-wallet-repayment:'||p_payment_id::text,0,0,
      'PayFast repayment received for pay-later loan '||v_loan.waybill,0)
    on conflict(event_key) do nothing;
  return true;
end; $$;
revoke all on function public.apply_payfast_wallet_repayment(uuid,text,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.apply_payfast_wallet_repayment(uuid,text,numeric,jsonb) to service_role;
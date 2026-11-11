-- Fleet owner multi-vehicle portal foundation. Staging rollout only.
create table if not exists public.fleets (
 id uuid primary key default gen_random_uuid(),
 owner_user_id uuid not null references public.user_profiles(id) on delete restrict,
 fleet_name text not null check(length(trim(fleet_name)) between 2 and 120),
 paystack_recipient_code text,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(owner_user_id,fleet_name)
);
create table if not exists public.fleet_vehicles (
 id uuid primary key default gen_random_uuid(),
 fleet_id uuid not null references public.fleets(id) on delete cascade,
 assigned_driver_id uuid references public.driver_profiles(user_id) on delete set null,
 registration_plate text not null,
 vehicle_type text not null check(vehicle_type in ('bike','bakkie','van','truck','hatchback/sedan','motorbike','4-ton','8-ton')),
 make_model text not null default '',
 licence_disc_expiry date,
 insurance_expiry date,
 verification_status text not null default 'pending' check(verification_status in ('pending','approved','rejected','expired')),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(fleet_id,registration_plate)
);
create index if not exists fleet_vehicles_fleet_active_idx on public.fleet_vehicles(fleet_id,is_active);
create index if not exists fleet_vehicles_driver_idx on public.fleet_vehicles(assigned_driver_id);
create table if not exists public.fleet_driver_contracts (
 id uuid primary key default gen_random_uuid(),
 fleet_id uuid not null references public.fleets(id) on delete cascade,
 driver_id uuid not null references public.driver_profiles(user_id) on delete restrict,
 payout_model text not null check(payout_model in ('percentage_split','weekly_rental')),
 fleet_percentage numeric(5,2),
 driver_percentage numeric(5,2),
 weekly_rental_target_zar numeric(12,2),
 current_week_collected_zar numeric(12,2) not null default 0 check(current_week_collected_zar>=0),
 week_start_date date not null default date_trunc('week',now())::date,
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check((payout_model='percentage_split' and fleet_percentage between 0 and 100 and driver_percentage between 0 and 100 and fleet_percentage+driver_percentage=100 and weekly_rental_target_zar is null)
 or (payout_model='weekly_rental' and fleet_percentage is null and driver_percentage is null and weekly_rental_target_zar>0)),
 unique(fleet_id,driver_id)
);
create index if not exists fleet_contract_driver_active_idx on public.fleet_driver_contracts(driver_id) where is_active;
alter table public.driver_profiles add column if not exists paystack_recipient_code text;

create table if not exists public.fleet_wallet_ledger (
 id uuid primary key default gen_random_uuid(),
 fleet_id uuid not null references public.fleets(id) on delete restrict,
 contract_id uuid references public.fleet_driver_contracts(id) on delete set null,
 waybill text not null references public.customer_bookings(waybill) on delete restrict,
 event_key text not null unique,
 entry_type text not null check(entry_type in ('percentage_share','weekly_rental_collection','platform_commission')),
 amount_cents bigint not null check(amount_cents>=0),
 description text not null,
 created_at timestamptz not null default now()
);
create table if not exists public.fleet_payout_transfers (
 id uuid primary key default gen_random_uuid(),
 waybill text not null references public.customer_bookings(waybill) on delete restrict,
 fleet_id uuid references public.fleets(id) on delete restrict,
 beneficiary_type text not null check(beneficiary_type in ('fleet_owner','driver')),
 beneficiary_user_id uuid not null references public.user_profiles(id) on delete restrict,
 recipient_code text,
 amount_cents bigint not null check(amount_cents>0),
 reference text not null unique,
 status text not null default 'queued' check(status in ('queued','processing','success','failed','needs_recipient')),
 transfer_code text,
 failure_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(waybill,beneficiary_type)
);
create index if not exists fleet_transfers_queued_idx on public.fleet_payout_transfers(status,created_at) where status in ('queued','failed');

alter table public.fleets enable row level security;
alter table public.fleet_vehicles enable row level security;
alter table public.fleet_driver_contracts enable row level security;
alter table public.fleet_wallet_ledger enable row level security;
alter table public.fleet_payout_transfers enable row level security;
revoke all on public.fleets,public.fleet_vehicles,public.fleet_driver_contracts,public.fleet_wallet_ledger,public.fleet_payout_transfers from anon,authenticated;
grant all on public.fleets,public.fleet_vehicles,public.fleet_driver_contracts,public.fleet_wallet_ledger,public.fleet_payout_transfers to service_role;

-- Preserve the existing 25% platform commission / 75% driver pool when no fleet contract exists.
-- A fleet contract partitions only the 75% net pool. All wallet movements are idempotent by waybill.
create or replace function public.credit_driver_earning_on_delivery()
returns trigger language plpgsql set search_path=public as $$
declare
 v_gross bigint; v_platform bigint; v_net bigint; v_fleet bigint; v_driver bigint;
 v_contract public.fleet_driver_contracts%rowtype; v_fleet_id uuid;
 v_owner uuid; v_owner_recipient text; v_driver_recipient text; v_remaining bigint;
 v_week date;
begin
 if new.status<>'delivered' or old.status is not distinct from 'delivered'
   or new.driver_user_id is null or coalesce(new.price,0)<=0 then return new; end if;
 v_gross:=round(new.price*100)::bigint;
 v_platform:=round(v_gross*0.25)::bigint;
 v_net:=v_gross-v_platform;
 select c.* into v_contract
 from public.fleet_driver_contracts c
 join public.fleet_vehicles v on v.fleet_id=c.fleet_id and v.assigned_driver_id=c.driver_id and v.is_active
 where c.driver_id=new.driver_user_id and c.is_active
 order by c.updated_at desc limit 1 for update of c;
 if not found then
   insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,description)
   values(new.driver_user_id,'delivery-earning:'||new.waybill,'earning',v_net,new.waybill,
    'Driver share after 25% SwiftHaul platform commission')
   on conflict(event_key) do nothing;
   return new;
 end if;
 select f.owner_user_id,f.paystack_recipient_code into v_owner,v_owner_recipient
 from public.fleets f where f.id=v_contract.fleet_id and f.is_active;
 select paystack_recipient_code into v_driver_recipient from public.driver_profiles where user_id=new.driver_user_id;
 if v_contract.payout_model='percentage_split' then
   v_fleet:=round(v_net*v_contract.fleet_percentage/100)::bigint;
   v_driver:=v_net-v_fleet;
   insert into public.fleet_wallet_ledger(fleet_id,contract_id,waybill,event_key,entry_type,amount_cents,description)
   values(v_contract.fleet_id,v_contract.id,new.waybill,'fleet-share:'||new.waybill,'percentage_share',v_fleet,'Fleet share after platform commission')
   on conflict(event_key) do nothing;
 else
   v_week:=date_trunc('week',now())::date;
   if v_contract.week_start_date<>v_week then
     update public.fleet_driver_contracts set current_week_collected_zar=0,week_start_date=v_week where id=v_contract.id;
     v_contract.current_week_collected_zar:=0;
   end if;
   v_remaining:=greatest(0,round((v_contract.weekly_rental_target_zar-v_contract.current_week_collected_zar)*100)::bigint);
   v_fleet:=least(v_net,v_remaining);
   v_driver:=v_net-v_fleet;
   update public.fleet_driver_contracts set current_week_collected_zar=current_week_collected_zar+(v_fleet::numeric/100),updated_at=now() where id=v_contract.id;
   if v_fleet>0 then
    insert into public.fleet_wallet_ledger(fleet_id,contract_id,waybill,event_key,entry_type,amount_cents,description)
    values(v_contract.fleet_id,v_contract.id,new.waybill,'fleet-rental:'||new.waybill,'weekly_rental_collection',v_fleet,'Weekly rental target collection')
    on conflict(event_key) do nothing;
   end if;
 end if;
 if v_driver>0 then
   insert into public.driver_earnings_ledger(driver_user_id,event_key,event_type,amount_cents,waybill,description)
   values(new.driver_user_id,'fleet-driver-share:'||new.waybill,'earning',v_driver,new.waybill,'Driver share after platform commission and fleet contract')
   on conflict(event_key) do nothing;
 end if;
 if v_fleet>0 then
   insert into public.fleet_payout_transfers(waybill,fleet_id,beneficiary_type,beneficiary_user_id,recipient_code,amount_cents,reference,status)
   values(new.waybill,v_contract.fleet_id,'fleet_owner',v_owner,v_owner_recipient,v_fleet,
    'sh-fleet-'||replace(new.waybill,' ','-'),'queued')
   on conflict(waybill,beneficiary_type) do nothing;
 end if;
 if v_driver>0 then
   insert into public.fleet_payout_transfers(waybill,fleet_id,beneficiary_type,beneficiary_user_id,recipient_code,amount_cents,reference,status)
   values(new.waybill,v_contract.fleet_id,'driver',new.driver_user_id,v_driver_recipient,v_driver,
    'sh-driver-'||replace(new.waybill,' ','-'),'queued')
   on conflict(waybill,beneficiary_type) do nothing;
 end if;
 update public.fleet_payout_transfers set status='needs_recipient',updated_at=now()
 where waybill=new.waybill and recipient_code is null and status='queued';
 return new;
end; $$;
drop trigger if exists credit_driver_earning_after_delivery on public.customer_bookings;
create trigger credit_driver_earning_after_delivery after update of status on public.customer_bookings
for each row when(new.status='delivered' and old.status is distinct from 'delivered')
execute function public.credit_driver_earning_on_delivery();
revoke all on function public.credit_driver_earning_on_delivery() from public,anon,authenticated;
grant execute on function public.credit_driver_earning_on_delivery() to service_role;

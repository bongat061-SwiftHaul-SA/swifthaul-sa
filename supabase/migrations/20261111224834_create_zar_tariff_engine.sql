-- Staging ZAR tariff configuration, quote locking and audit trail.
create table if not exists public.vehicle_tariffs (
 id uuid primary key default gen_random_uuid(), vehicle_type text not null unique check (vehicle_type in ('motorbike','hatchback_sedan','bakkie','truck')),
 base_fare_zar numeric(12,2) not null default 0 check (base_fare_zar >= 0), included_km numeric(8,2) not null default 0 check (included_km >= 0),
 tier1_max_km numeric(8,2) not null default 2 check (tier1_max_km >= included_km), tier1_rate_per_km_zar numeric(12,2) not null default 0 check (tier1_rate_per_km_zar >= 0),
 tier2_rate_per_km_zar numeric(12,2) not null default 0 check (tier2_rate_per_km_zar >= 0), minimum_fare_zar numeric(12,2) not null default 0 check (minimum_fare_zar >= 0),
 extra_stop_fee_zar numeric(12,2) not null default 0 check (extra_stop_fee_zar >= 0), platform_commission_percent numeric(5,2) not null default 25 check (platform_commission_percent between 0 and 100),
 is_active boolean not null default false, updated_at timestamptz not null default now()
);
create table if not exists public.surge_rules (
 id uuid primary key default gen_random_uuid(), name text not null, rule_type text not null check (rule_type in ('scheduled_peak','supply_demand','weather_event')),
 days_of_week integer[] not null default array[0,1,2,3,4,5,6], start_time_sast time, end_time_sast time,
 multiplier numeric(4,2) not null check (multiplier between 1.0 and 1.5), max_multiplier_cap numeric(4,2) not null default 1.5 check (max_multiplier_cap between 1.0 and 1.5),
 is_active boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check (array_length(days_of_week,1) is null or days_of_week <@ array[0,1,2,3,4,5,6])
);
create table if not exists public.tariff_settings (
 id uuid primary key default gen_random_uuid(), fuel_surcharge_percent numeric(5,2) not null default 0 check (fuel_surcharge_percent between 0 and 100),
 max_global_surge_cap numeric(4,2) not null default 1.5 check (max_global_surge_cap between 1.0 and 1.5), quote_validity_minutes integer not null default 10 check (quote_validity_minutes between 1 and 60),
 updated_by uuid, updated_at timestamptz not null default now()
);
create table if not exists public.tariff_audit_logs (
 id uuid primary key default gen_random_uuid(), changed_by uuid, entity_type text not null check (entity_type in ('vehicle_tariff','surge_rule','tariff_settings')),
 entity_id uuid not null, action text not null check (action in ('insert','update','delete')), previous_values jsonb, new_values jsonb, created_at timestamptz not null default now()
);
-- A separate table is intentional: public.delivery_quotes already exists for the legacy customer quote flow.
create table if not exists public.tariff_quotes (
 id uuid primary key default gen_random_uuid(), vehicle_type text not null, distance_km numeric(9,3) not null check (distance_km > 0), extra_stops integer not null default 0 check (extra_stops >= 0),
 gross_fare_zar numeric(12,2) not null, platform_commission_zar numeric(12,2) not null, driver_net_payout_zar numeric(12,2) not null,
 surge_multiplier numeric(4,2) not null, fuel_surcharge_percent numeric(5,2) not null, fare_breakdown jsonb not null, tariff_snapshot jsonb not null,
 expires_at timestamptz not null, status text not null default 'quoted' check (status in ('quoted','consumed','expired','cancelled')), created_at timestamptz not null default now(), consumed_at timestamptz
);
create index if not exists surge_rules_active_idx on public.surge_rules(is_active,rule_type);
create index if not exists tariff_audit_logs_created_idx on public.tariff_audit_logs(created_at desc);
create index if not exists tariff_quotes_expiry_status_idx on public.tariff_quotes(expires_at,status);
alter table public.vehicle_tariffs enable row level security;
alter table public.surge_rules enable row level security;
alter table public.tariff_settings enable row level security;
alter table public.tariff_audit_logs enable row level security;
alter table public.tariff_quotes enable row level security;
revoke all on public.vehicle_tariffs,public.surge_rules,public.tariff_settings,public.tariff_audit_logs,public.tariff_quotes from anon,authenticated;
grant all on public.vehicle_tariffs,public.surge_rules,public.tariff_settings,public.tariff_audit_logs,public.tariff_quotes to service_role;
insert into public.vehicle_tariffs(vehicle_type) values ('motorbike'),('hatchback_sedan'),('bakkie_van'),('truck') on conflict(vehicle_type) do nothing;
insert into public.tariff_settings(fuel_surcharge_percent,max_global_surge_cap,quote_validity_minutes) select 0,1.5,10 where not exists(select 1 from public.tariff_settings);

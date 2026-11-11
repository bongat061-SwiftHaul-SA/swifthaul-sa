-- SARS tax documents and current SA VAT configuration for SwiftHaul staging.
alter table public.vehicle_tariffs drop constraint if exists vehicle_tariffs_vehicle_type_check;
alter table public.vehicle_tariffs drop constraint if exists vehicle_tariffs_type_check;
delete from public.vehicle_tariffs where vehicle_type='hatchback_sedan';
alter table public.vehicle_tariffs add constraint vehicle_tariffs_vehicle_type_check check (vehicle_type in ('motorbike','bakkie','truck'));

alter table public.tariff_settings
 add column if not exists legal_entity_name text,
 add column if not exists cipc_reg_number text,
 add column if not exists is_vat_registered boolean not null default false,
 add column if not exists vat_number varchar(10),
 add column if not exists vat_rate_percent numeric(5,2) not null default 15.50,
 add column if not exists registered_address text;
alter table public.tariff_settings alter column vat_rate_percent set default 15.50;
alter table public.tariff_settings drop constraint if exists tariff_settings_vat_number_check;
alter table public.tariff_settings add constraint tariff_settings_vat_number_check check (vat_number is null or vat_number ~ '^[0-9]{10}$');
alter table public.tariff_settings add constraint tariff_settings_vat_rate_check check (vat_rate_percent between 0 and 100);

alter table public.customer_bookings add column if not exists billing_company_name text;
alter table public.customer_bookings add column if not exists billing_vat_number varchar(10);
alter table public.customer_bookings add column if not exists billing_address text;
alter table public.customer_bookings drop constraint if exists customer_bookings_billing_vat_check;
alter table public.customer_bookings add constraint customer_bookings_billing_vat_check check (billing_vat_number is null or billing_vat_number ~ '^[0-9]{10}$');

create sequence if not exists public.tax_document_number_seq start 1 increment 1;
create table if not exists public.tax_documents (
 id uuid primary key default gen_random_uuid(),
 document_number text not null unique,
 source_reference text unique,
 document_type text not null check (document_type in ('sender_tax_invoice','sender_receipt','driver_remittance','fleet_statement')),
 order_id text, driver_id uuid, fleet_id uuid,
 subtotal_excl_vat_zar numeric(12,2) not null default 0,
 vat_amount_zar numeric(12,2) not null default 0,
 total_incl_vat_zar numeric(12,2) not null default 0,
 storage_key text,
 issued_at timestamptz not null default now(),
 created_at timestamptz not null default now(),
 metadata jsonb not null default '{}'::jsonb,
 constraint tax_documents_target_check check (order_id is not null or driver_id is not null or fleet_id is not null)
);
create index if not exists tax_documents_order_idx on public.tax_documents(order_id,issued_at desc);
create index if not exists tax_documents_driver_idx on public.tax_documents(driver_id,issued_at desc);
create index if not exists tax_documents_fleet_idx on public.tax_documents(fleet_id,issued_at desc);
alter table public.tax_documents enable row level security;
revoke all on public.tax_documents from anon,authenticated;
grant all on public.tax_documents to service_role;

create or replace function public.assign_tax_document_number()
returns trigger language plpgsql set search_path=public as $$
declare prefix text; seq bigint; yr text;
begin
 if new.document_number is null or new.document_number='' then
   seq := nextval('public.tax_document_number_seq');
   yr := to_char(coalesce(new.issued_at,now()) at time zone 'Africa/Johannesburg','YYYY');
   prefix := case new.document_type when 'driver_remittance' then 'REM' when 'fleet_statement' then 'FLT' when 'sender_receipt' then 'RCT' else 'INV' end;
   new.document_number := 'SH-'||prefix||'-'||yr||'-'||lpad(seq::text,6,'0');
 end if;
 return new;
end $$;
drop trigger if exists tax_documents_number_before_insert on public.tax_documents;
create trigger tax_documents_number_before_insert before insert on public.tax_documents for each row execute function public.assign_tax_document_number();

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('swift-haul-tax-documents','swift-haul-tax-documents',false,10485760,array['application/pdf'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf'];

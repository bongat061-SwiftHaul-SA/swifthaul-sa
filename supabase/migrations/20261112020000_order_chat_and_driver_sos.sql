-- In-app order chat and driver SOS emergency response foundation.
create table if not exists public.order_messages (
 id uuid primary key default gen_random_uuid(),
 order_id text not null references public.customer_bookings(waybill) on delete cascade,
 sender_role text not null check(sender_role in ('driver','customer','recipient','admin')),
 sender_id uuid,
 message_text text,
 attachment_url text,
 is_read boolean not null default false,
 created_at timestamptz not null default now(),
 constraint order_messages_content_required check ((nullif(trim(coalesce(message_text,'')),'') is not null) or attachment_url is not null),
 constraint order_messages_text_limit check (message_text is null or length(message_text)<=2000)
);
create index if not exists order_messages_order_created_idx on public.order_messages(order_id,created_at);
create table if not exists public.sos_incidents (
 id uuid primary key default gen_random_uuid(),
 driver_id uuid not null references public.driver_profiles(user_id) on delete restrict,
 fleet_id uuid references public.fleets(id) on delete set null,
 order_id text references public.customer_bookings(waybill) on delete set null,
 lat double precision not null check(lat between -90 and 90),
 lng double precision not null check(lng between -180 and 180),
 vehicle_plate text,
 status text not null default 'active' check(status in ('active','responding','resolved')),
 triggered_at timestamptz not null default now(),
 resolved_by uuid references public.user_profiles(id) on delete set null,
 resolution_notes text,
 resolved_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists sos_incidents_active_idx on public.sos_incidents(status,triggered_at desc) where status<>'resolved';
create index if not exists sos_incidents_driver_idx on public.sos_incidents(driver_id,triggered_at desc);
create table if not exists public.sos_incident_actions (
 id uuid primary key default gen_random_uuid(),
 incident_id uuid not null references public.sos_incidents(id) on delete cascade,
 actor_user_id uuid not null references public.user_profiles(id) on delete restrict,
 action_type text not null check(action_type in ('acknowledged','contacted_driver','contacted_emergency_contact','dispatched_assistance','note','resolved')),
 notes text,
 created_at timestamptz not null default now()
);
create index if not exists sos_actions_incident_created_idx on public.sos_incident_actions(incident_id,created_at);
alter table public.driver_profiles add column if not exists emergency_contact_name text;
alter table public.driver_profiles add column if not exists emergency_contact_phone text;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='driver_emergency_phone_e164_check') then
  alter table public.driver_profiles add constraint driver_emergency_phone_e164_check
  check(emergency_contact_phone is null or emergency_contact_phone ~ '^\\+27[6-8][0-9]{8}$');
 end if;
end $$;
alter table public.order_messages enable row level security;
alter table public.sos_incidents enable row level security;
alter table public.sos_incident_actions enable row level security;
revoke all on public.order_messages,public.sos_incidents,public.sos_incident_actions from anon,authenticated;
grant all on public.order_messages,public.sos_incidents,public.sos_incident_actions to service_role;

-- Only assigned drivers, fleet owners and company responders may receive private SOS broadcasts.
-- Order chat broadcasts are restricted to the assigned driver and company responders.
drop policy if exists "swifthaul_private_order_sos_broadcast_read" on realtime.messages;
create policy "swifthaul_private_order_sos_broadcast_read" on realtime.messages for select to authenticated using (
 (realtime.topic() ~ '^sos:[0-9a-fA-F-]{36}$' and exists (
   select 1 from public.sos_incidents i where i.id=substring(realtime.topic() from 5)::uuid
   and (i.driver_id=(select auth.uid())
    or exists(select 1 from public.fleets f where f.id=i.fleet_id and f.owner_user_id=(select auth.uid()))
    or exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.role in ('admin','company_admin','dispatcher'))
   )
 ))
 or (realtime.topic() like 'order:%' and exists (
   select 1 from public.customer_bookings b where b.waybill=substring(realtime.topic() from 7)
   and (b.driver_user_id=(select auth.uid())
    or exists(select 1 from public.user_profiles p where p.id=(select auth.uid()) and p.role in ('admin','company_admin','dispatcher')))
 ))
);

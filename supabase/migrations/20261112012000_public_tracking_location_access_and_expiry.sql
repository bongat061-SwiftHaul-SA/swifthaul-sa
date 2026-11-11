alter table public.public_tracking_locations add column if not exists is_active boolean not null default true;
drop policy if exists "public active tracking location read" on public.public_tracking_locations;
create policy "public active tracking location read" on public.public_tracking_locations for select to anon,authenticated using(is_active=true);
create or replace function public.expire_public_tracking_location()
returns trigger language plpgsql security definer set search_path='public'
as $$ begin
 if new.status in('delivered','failed','cancelled') then
  update public.public_tracking_locations set is_active=false where waybill=new.waybill;
 end if;
 return new;
end $$;
drop trigger if exists expire_public_tracking_location on public.customer_bookings;
create trigger expire_public_tracking_location after update of status on public.customer_bookings for each row execute function public.expire_public_tracking_location();
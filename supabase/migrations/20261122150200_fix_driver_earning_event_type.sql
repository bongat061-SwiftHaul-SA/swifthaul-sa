create or replace function public.settle_driver_delivery_earning(p_waybill text)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  b public.customer_bookings%rowtype;
  v_gross bigint;
  v_net bigint;
  v_fleet bigint := 0;
  v_driver bigint := 0;
  v_contract public.fleet_driver_contracts%rowtype;
  v_owner uuid;
  v_owner_recipient text;
  v_driver_recipient text;
  v_remaining bigint;
  v_week date;
begin
  select * into b from public.customer_bookings
  where waybill = p_waybill for update;

  if not found or b.status <> 'delivered' or b.paid_at is null
     or b.refunded_at is not null or b.driver_user_id is null
     or coalesce(b.price, 0) <= 0
     or not exists (
       select 1 from public.proof_of_delivery p
       where p.waybill = b.waybill and p.recipient_pin_verified_at is not null
     ) then
    return;
  end if;

  if exists (
       select 1 from public.driver_earnings_ledger
       where waybill = b.waybill
         and event_key in ('paid-delivery:' || b.waybill,
                           'fleet-driver-share:' || b.waybill)
     )
     or exists (
       select 1 from public.fleet_wallet_ledger
       where waybill = b.waybill
         and event_key in ('fleet-share:' || b.waybill,
                           'fleet-rental:' || b.waybill)
     ) then
    return;
  end if;

  v_gross := round(b.price * 100)::bigint;
  v_net := round(v_gross * 0.75)::bigint;
  if v_net <= 0 then return; end if;

  select c.* into v_contract
  from public.fleet_driver_contracts c
  join public.fleet_vehicles v
    on v.fleet_id = c.fleet_id
   and v.assigned_driver_id = c.driver_id
   and v.is_active
  where c.driver_id = b.driver_user_id and c.is_active
  order by c.updated_at desc limit 1 for update of c;

  if not found then
    insert into public.driver_earnings_ledger
      (driver_user_id, event_key, event_type, amount_cents, waybill, description)
    values
      (b.driver_user_id, 'paid-delivery:' || b.waybill, 'earning',
       v_net, b.waybill,
       '75% driver share after payment and verified recipient PIN')
    on conflict (event_key) do nothing;
    return;
  end if;

  select f.owner_user_id, f.paystack_recipient_code
    into v_owner, v_owner_recipient
  from public.fleets f where f.id = v_contract.fleet_id and f.is_active;

  select dp.paystack_recipient_code into v_driver_recipient
  from public.driver_profiles dp where dp.user_id = b.driver_user_id;

  if v_contract.payout_model = 'percentage_split' then
    v_fleet := round(v_net * v_contract.fleet_percentage / 100)::bigint;
    v_driver := v_net - v_fleet;
    insert into public.fleet_wallet_ledger
      (fleet_id, contract_id, waybill, event_key, entry_type, amount_cents, description)
    values
      (v_contract.fleet_id, v_contract.id, b.waybill,
       'fleet-share:' || b.waybill, 'percentage_share', v_fleet,
       'Fleet share after 25% platform commission')
    on conflict (event_key) do nothing;
  else
    v_week := date_trunc('week', now())::date;
    if v_contract.week_start_date <> v_week then
      update public.fleet_driver_contracts
      set current_week_collected_zar = 0, week_start_date = v_week
      where id = v_contract.id;
      v_contract.current_week_collected_zar := 0;
    end if;
    v_remaining := greatest(
      0, round((v_contract.weekly_rental_target_zar -
                v_contract.current_week_collected_zar) * 100)::bigint
    );
    v_fleet := least(v_net, v_remaining);
    v_driver := v_net - v_fleet;
    update public.fleet_driver_contracts
    set current_week_collected_zar = current_week_collected_zar + (v_fleet::numeric / 100),
        updated_at = now()
    where id = v_contract.id;
    if v_fleet > 0 then
      insert into public.fleet_wallet_ledger
        (fleet_id, contract_id, waybill, event_key, entry_type, amount_cents, description)
      values
        (v_contract.fleet_id, v_contract.id, b.waybill,
         'fleet-rental:' || b.waybill, 'weekly_rental_collection', v_fleet,
         'Weekly rental target collection')
      on conflict (event_key) do nothing;
    end if;
  end if;

  if v_driver > 0 then
    insert into public.driver_earnings_ledger
      (driver_user_id, event_key, event_type, amount_cents, waybill, description)
    values
      (b.driver_user_id, 'fleet-driver-share:' || b.waybill, 'earning',
       v_driver, b.waybill,
       'Driver share after platform commission and fleet contract')
    on conflict (event_key) do nothing;
  end if;

  if v_fleet > 0 then
    insert into public.fleet_payout_transfers
      (waybill, fleet_id, beneficiary_type, beneficiary_user_id, recipient_code,
       amount_cents, reference, status)
    values
      (b.waybill, v_contract.fleet_id, 'fleet_owner', v_owner, v_owner_recipient,
       v_fleet, 'sh-fleet-' || replace(b.waybill, ' ', '-'), 'queued')
    on conflict (waybill, beneficiary_type) do nothing;
  end if;

  if v_driver > 0 then
    insert into public.fleet_payout_transfers
      (waybill, fleet_id, beneficiary_type, beneficiary_user_id, recipient_code,
       amount_cents, reference, status)
    values
      (b.waybill, v_contract.fleet_id, 'driver', b.driver_user_id, v_driver_recipient,
       v_driver, 'sh-driver-' || replace(b.waybill, ' ', '-'), 'queued')
    on conflict (waybill, beneficiary_type) do nothing;
  end if;

  update public.fleet_payout_transfers
  set status = 'needs_recipient', updated_at = now()
  where waybill = b.waybill and recipient_code is null and status = 'queued';
end;
$function$;

revoke all on function public.settle_driver_delivery_earning(text)
from public, anon, authenticated;
alter table public.customer_bookings
  add column if not exists customer_total_cents bigint,
  add column if not exists voucher_discount_cents integer not null default 0,
  add column if not exists voucher_code text;

alter table public.customer_dash_milestones
  add column if not exists voucher_applied_booking_waybill text,
  add column if not exists voucher_applied_at timestamptz;

create unique index if not exists customer_dash_milestone_voucher_booking_unique
  on public.customer_dash_milestones(voucher_applied_booking_waybill)
  where voucher_applied_booking_waybill is not null;

create or replace function public.customer_dash_claim_voucher(
  p_user_id uuid, p_voucher_code text, p_booking_waybill text, p_gross_cents bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.customer_dash_milestones%rowtype; discount integer; payable bigint;
begin
  if p_gross_cents < 20000 then raise exception 'voucher_requires_quote_of_at_least_R200'; end if;
  if length(trim(coalesce(p_voucher_code,''))) < 4 or length(p_booking_waybill) > 100 then raise exception 'invalid_voucher_request'; end if;
  select * into m from public.customer_dash_milestones
    where user_id=p_user_id and upper(voucher_code)=upper(trim(p_voucher_code))
      and status='redeemed' and voucher_applied_booking_waybill is null
    for update;
  if not found then raise exception 'voucher_invalid_already_used_or_not_redeemed'; end if;
  discount := least(m.reward_cents, greatest(0,p_gross_cents-100));
  if discount <= 0 then raise exception 'voucher_not_applicable'; end if;
  payable := p_gross_cents-discount;
  update public.customer_dash_milestones
    set voucher_applied_booking_waybill=p_booking_waybill, voucher_applied_at=now()
    where id=m.id;
  return jsonb_build_object('ok',true,'milestone_id',m.id,'voucher_code',m.voucher_code,
    'discount_cents',discount,'gross_cents',p_gross_cents,'customer_total_cents',payable);
end $$;

create or replace function public.customer_dash_release_voucher_claim(
  p_user_id uuid, p_voucher_code text, p_booking_waybill text
) returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.customer_dash_milestones
    set voucher_applied_booking_waybill=null, voucher_applied_at=null
    where user_id=p_user_id and upper(voucher_code)=upper(trim(p_voucher_code))
      and status='redeemed' and voucher_applied_booking_waybill=p_booking_waybill;
  return found;
end $$;

revoke all on function public.customer_dash_claim_voucher(uuid,text,text,bigint) from public,anon,authenticated;
revoke all on function public.customer_dash_release_voucher_claim(uuid,text,text) from public,anon,authenticated;
grant execute on function public.customer_dash_claim_voucher(uuid,text,text,bigint) to service_role;
grant execute on function public.customer_dash_release_voucher_claim(uuid,text,text) to service_role;

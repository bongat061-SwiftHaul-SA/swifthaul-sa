create or replace function public.submit_customer_eft_proof(p_waybill text,p_proof_object_path text,p_customer_reference text default null)
returns jsonb language plpgsql security definer
set search_path=public,auth,storage,pg_temp as $$
declare
  v_uid uuid:=auth.uid(); v_booking public.customer_bookings%rowtype;
  v_existing public.customer_eft_payments%rowtype; v_id uuid:=gen_random_uuid();
  v_reference text; v_amount bigint;
begin
  if v_uid is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_waybill is null or length(p_waybill)>100 or p_proof_object_path is null
    or p_proof_object_path not like v_uid::text||'/'||p_waybill||'/%'
    or p_proof_object_path ~ '(^/|\\.\\.|\\\\)'
    or length(coalesce(p_customer_reference,''))>100 then
    raise exception 'invalid_eft_proof_details' using errcode='22023';
  end if;
  if not exists(select 1 from public.user_profiles where id=v_uid and role='customer' and account_status='active') then
    raise exception 'active_customer_account_required' using errcode='42501';
  end if;
  select * into v_booking from public.customer_bookings where waybill=p_waybill and owner_hash=v_uid::text for update;
  if not found then raise exception 'booking_not_found' using errcode='P0002'; end if;
  if v_booking.paid_at is not null or v_booking.payment_source is not null or v_booking.status='cancelled' then
    raise exception 'booking_not_eligible_for_eft' using errcode='23514';
  end if;
  if v_booking.payment_method not in ('eft','dispatch') then raise exception 'booking_not_set_to_eft' using errcode='23514'; end if;
  if not exists(select 1 from storage.objects where bucket_id='customer-eft-proofs' and name=p_proof_object_path and owner_id=v_uid::text) then
    raise exception 'eft_proof_file_not_found_or_not_owned' using errcode='42501';
  end if;
  select * into v_existing from public.customer_eft_payments where waybill=p_waybill and status='submitted' for update;
  if found then return jsonb_build_object('already_submitted',true,'payment_reference',v_existing.payment_reference,'status',v_existing.status,'amount_cents',v_existing.amount_cents); end if;
  v_reference:=v_booking.waybill;
  v_amount:=round(v_booking.price*100)::bigint;
  insert into public.customer_eft_payments(id,owner_id,waybill,payment_reference,customer_reference,amount_cents,proof_object_path)
  values(v_id,v_uid,p_waybill,v_reference,nullif(trim(coalesce(p_customer_reference,'')),''),v_amount,p_proof_object_path);
  update public.customer_bookings set payment_method='eft' where waybill=p_waybill;
  return jsonb_build_object('already_submitted',false,'payment_reference',v_reference,'status','submitted','amount_cents',v_amount);
end $$;

-- Extend quick sign-in PINs to Company Admin accounts.
-- Company PINs are scoped to active admin/dispatcher profiles only.
alter table private.account_login_pins
  drop constraint if exists account_login_pins_app_type_check;
alter table private.account_login_pins
  add constraint account_login_pins_app_type_check
  check (app_type in ('customer','driver','company'));

create or replace function public.set_account_login_pin(
  p_user_id uuid,p_app_type text,p_pin text
) returns void
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions, auth
as $$
declare v_role text; v_status text;
begin
  if p_app_type not in ('customer','driver','company') or p_pin !~ '^[0-9]{6}$' then
    raise exception 'invalid_pin_request';
  end if;
  select role,account_status into v_role,v_status from public.user_profiles where id=p_user_id;
  if v_status is distinct from 'active' or
     (p_app_type='company' and v_role not in ('admin','dispatcher')) or
     (p_app_type<>'company' and v_role is distinct from p_app_type) then
    raise exception 'account_not_eligible';
  end if;
  if not exists(select 1 from auth.users where id=p_user_id and email_confirmed_at is not null) then
    raise exception 'email_not_confirmed';
  end if;
  insert into private.account_login_pins(user_id,app_type,pin_hash)
  values(p_user_id,p_app_type,extensions.crypt(p_pin,extensions.gen_salt('bf',12)))
  on conflict(user_id,app_type) do update set
    pin_hash=excluded.pin_hash,failed_attempts=0,locked_until=null,updated_at=now();
end;
$$;

create or replace function public.verify_account_login_pin(
  p_email text,p_app_type text,p_pin text
) returns table(user_id uuid,authenticated boolean,locked_until timestamptz)
language plpgsql security definer
set search_path = pg_catalog, public, private, extensions, auth
as $$
declare v_user_id uuid; v_hash text; v_attempts integer; v_locked_until timestamptz;
begin
  if p_app_type not in ('customer','driver','company') or p_pin !~ '^[0-9]{6}$'
     or length(coalesce(p_email,''))>254 then
    return query select null::uuid,false,null::timestamptz; return;
  end if;
  select u.id into v_user_id from auth.users u
  join public.user_profiles p on p.id=u.id
  where lower(u.email)=lower(trim(p_email)) and u.email_confirmed_at is not null
    and p.account_status='active'
    and ((p_app_type='company' and p.role in ('admin','dispatcher')) or
         (p_app_type<>'company' and p.role=p_app_type))
  limit 1;
  if v_user_id is null then return query select null::uuid,false,null::timestamptz; return; end if;
  select pin_hash,failed_attempts,private.account_login_pins.locked_until
    into v_hash,v_attempts,v_locked_until
  from private.account_login_pins
  where private.account_login_pins.user_id=v_user_id
    and private.account_login_pins.app_type=p_app_type for update;
  if not found then return query select null::uuid,false,null::timestamptz; return; end if;
  if v_locked_until is not null and v_locked_until>now() then
    return query select null::uuid,false,v_locked_until; return;
  end if;
  if extensions.crypt(p_pin,v_hash)=v_hash then
    update private.account_login_pins set failed_attempts=0,locked_until=null,updated_at=now()
    where private.account_login_pins.user_id=v_user_id and private.account_login_pins.app_type=p_app_type;
    return query select v_user_id,true,null::timestamptz; return;
  end if;
  v_attempts:=coalesce(v_attempts,0)+1;
  v_locked_until:=case when v_attempts>=5 then now()+interval '15 minutes' else null end;
  update private.account_login_pins set failed_attempts=v_attempts,locked_until=v_locked_until,updated_at=now()
  where private.account_login_pins.user_id=v_user_id and private.account_login_pins.app_type=p_app_type;
  return query select null::uuid,false,v_locked_until;
end;
$$;

create or replace function public.account_login_pin_status(p_user_id uuid,p_app_type text)
returns boolean language sql security definer
set search_path = pg_catalog, public, private
as $$
  select exists(
    select 1 from private.account_login_pins p
    join public.user_profiles u on u.id=p.user_id
    where p.user_id=p_user_id and p.app_type=p_app_type and u.account_status='active'
      and ((p_app_type='company' and u.role in ('admin','dispatcher')) or
           (p_app_type<>'company' and u.role=p_app_type))
  );
$$;

revoke all on function public.set_account_login_pin(uuid,text,text) from public,anon,authenticated;
revoke all on function public.verify_account_login_pin(text,text,text) from public,anon,authenticated;
revoke all on function public.account_login_pin_status(uuid,text) from public,anon,authenticated;
grant execute on function public.set_account_login_pin(uuid,text,text) to service_role;
grant execute on function public.verify_account_login_pin(text,text,text) to service_role;
grant execute on function public.account_login_pin_status(uuid,text) to service_role;

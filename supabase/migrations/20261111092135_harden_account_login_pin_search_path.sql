-- Harden SECURITY DEFINER functions against search-path object shadowing.
alter function public.set_account_login_pin(uuid,text,text)
  set search_path = pg_catalog, private, extensions, auth;
alter function public.verify_account_login_pin(text,text,text)
  set search_path = pg_catalog, private, extensions, auth;
alter function public.account_login_pin_status(uuid,text)
  set search_path = pg_catalog, private;

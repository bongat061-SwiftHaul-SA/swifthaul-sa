-- Lock down internal SECURITY DEFINER routines.
-- The auth trigger continues to run for Auth-created users; these routines are not RPC endpoints.
REVOKE ALL ON FUNCTION public.handle_new_auth_user() FROM PUBLIC, anon, authenticated;

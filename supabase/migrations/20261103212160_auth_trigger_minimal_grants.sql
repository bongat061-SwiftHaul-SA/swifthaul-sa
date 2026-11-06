-- The Auth service trigger runs as supabase_auth_admin. Grant only the inserts it needs.
GRANT INSERT ON public.user_profiles, public.driver_profiles TO supabase_auth_admin;

CREATE POLICY "auth service creates signup profiles" ON public.user_profiles
  FOR INSERT TO supabase_auth_admin WITH CHECK (true);

CREATE POLICY "auth service creates pending driver profiles" ON public.driver_profiles
  FOR INSERT TO supabase_auth_admin
  WITH CHECK (verification_status='pending' AND availability_status='offline');

GRANT EXECUTE ON FUNCTION public.handle_new_auth_user() TO supabase_auth_admin;

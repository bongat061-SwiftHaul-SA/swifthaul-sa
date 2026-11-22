-- Restrict the tracking-location cleanup trigger function to trigger execution only.
-- The function is attached to a booking status trigger and is not a public RPC.
revoke execute on function public.expire_public_tracking_location() from public, anon, authenticated;

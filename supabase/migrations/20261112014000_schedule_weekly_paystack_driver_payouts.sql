do $$ begin
 if not exists(select 1 from vault.secrets where name='paystack_weekly_payout_cron_token') then
  perform vault.create_secret(gen_random_uuid()::text,'paystack_weekly_payout_cron_token','SwiftHaul weekly Paystack payout scheduler authentication');
 end if;
end $$;
create or replace function public.verify_paystack_payout_cron_token(p_token text)
returns boolean language sql stable security definer set search_path=''
as $$ select exists(select 1 from vault.decrypted_secrets where name='paystack_weekly_payout_cron_token' and decrypted_secret=p_token) $$;
revoke all on function public.verify_paystack_payout_cron_token(text) from public,anon,authenticated;
grant execute on function public.verify_paystack_payout_cron_token(text) to service_role;
select cron.unschedule(jobid) from cron.job where jobname='swifthaul-paystack-weekly-payouts';
select cron.schedule('swifthaul-paystack-weekly-payouts','0 4 * * 1',$$
 select net.http_post(
  url:='https://tagkbropgzthsbjlhyvz.supabase.co/functions/v1/paystack-payouts',
  headers:=jsonb_build_object('Content-Type','application/json','x-payout-cron-secret',(select decrypted_secret from vault.decrypted_secrets where name='paystack_weekly_payout_cron_token')),
  body:='{"action":"weekly_batch"}'::jsonb
 );
$$);
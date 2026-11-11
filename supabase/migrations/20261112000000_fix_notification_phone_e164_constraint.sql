alter table public.notification_logs
  drop constraint if exists notification_logs_sa_phone_e164;

alter table public.notification_logs
  add constraint notification_logs_sa_phone_e164
  check (recipient_phone ~ '^\+27[6-8][0-9]{8}$');

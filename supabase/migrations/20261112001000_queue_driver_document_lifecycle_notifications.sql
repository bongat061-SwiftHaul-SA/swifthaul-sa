create or replace function public.queue_driver_onboarding_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_phone text;
  v_document_type text;
  v_rejection_reason text;
  v_event_type text;
  v_payload jsonb;
begin
  if NEW.notification_type like 'document_rejected_%' then
    v_event_type := 'document_rejected';
    select d.document_type, d.rejection_reason
      into v_document_type, v_rejection_reason
      from public.driver_documents d where d.id = NEW.document_id;
    v_payload := jsonb_build_object(
      'document_name', replace(coalesce(v_document_type, 'driver document'), '_', ' '),
      'rejection_reason', coalesce(v_rejection_reason, NEW.message, 'Please upload a replacement document'),
      'source_notification_id', NEW.id::text
    );
  elsif NEW.notification_type in ('document_expired', 'expiry_30_day', 'expiry_7_day') then
    v_event_type := 'document_expiry';
    select d.document_type into v_document_type
      from public.driver_documents d where d.id = NEW.document_id;
    v_payload := jsonb_build_object(
      'document_name', replace(coalesce(v_document_type, 'driver document'), '_', ' '),
      'expiry_message', case NEW.notification_type
        when 'expiry_30_day' then 'expires in 30 days'
        when 'expiry_7_day' then 'expires in 7 days'
        else 'has expired'
      end,
      'days_remaining', case NEW.notification_type
        when 'expiry_30_day' then 30
        when 'expiry_7_day' then 7
        else 0
      end,
      'source_notification_id', NEW.id::text
    );
  else
    return NEW;
  end if;

  select p.phone into v_phone
    from public.driver_profiles p
    where p.user_id = NEW.driver_user_id;

  v_phone := regexp_replace(coalesce(v_phone, ''), '[[:space:]().-]', '', 'g');
  if v_phone ~ '^0[6-8][0-9]{8}$' then
    v_phone := '+27' || substr(v_phone, 2);
  elsif v_phone ~ '^27[6-8][0-9]{8}$' then
    v_phone := '+' || v_phone;
  end if;
  if v_phone !~ '^\+27[6-8][0-9]{8}$' then
    return NEW;
  end if;

  if not exists (
    select 1 from public.notification_logs n
    where n.payload_json->>'source_notification_id' = NEW.id::text
  ) then
    insert into public.notification_logs (
      recipient_phone, recipient_type, channel, event_type, payload_json, status
    ) values (
      v_phone, 'driver', 'whatsapp', v_event_type, v_payload, 'queued'
    );
  end if;
  return NEW;
end;
$function$;

drop trigger if exists driver_onboarding_notification_queue on public.driver_onboarding_notifications;
create trigger driver_onboarding_notification_queue
after insert on public.driver_onboarding_notifications
for each row execute function public.queue_driver_onboarding_notification();

revoke all on function public.queue_driver_onboarding_notification() from public, anon, authenticated;
grant execute on function public.queue_driver_onboarding_notification() to service_role;

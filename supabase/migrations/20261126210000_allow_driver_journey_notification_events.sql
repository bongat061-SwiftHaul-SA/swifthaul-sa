-- Keep the milestone events used by dispatch-operations and notification-dispatch
-- valid in the staging notification queue.
ALTER TABLE public.notification_logs
  DROP CONSTRAINT IF EXISTS notification_logs_event_type_check;

ALTER TABLE public.notification_logs
  ADD CONSTRAINT notification_logs_event_type_check
  CHECK (event_type = ANY (ARRAY[
    'order_dispatched'::text,
    'delivery_otp'::text,
    'document_expiry'::text,
    'payout_success'::text,
    'document_rejected'::text,
    'sos_alert'::text,
    'driver_en_route_pickup'::text,
    'driver_arrived_pickup'::text,
    'driver_en_route_dropoff'::text,
    'driver_arrived_dropoff'::text
  ]));

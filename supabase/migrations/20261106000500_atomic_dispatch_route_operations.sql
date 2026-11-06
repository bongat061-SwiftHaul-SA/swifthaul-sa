-- Make multi-stop route creation and reordering atomic under one database transaction.
ALTER TABLE public.dispatch_route_stops
  DROP CONSTRAINT dispatch_route_stops_route_id_sequence_no_key;
ALTER TABLE public.dispatch_route_stops
  ADD CONSTRAINT dispatch_route_stops_route_id_sequence_no_key
  UNIQUE (route_id,sequence_no) DEFERRABLE INITIALLY DEFERRED;

CREATE OR REPLACE FUNCTION public.create_dispatch_route(
  p_driver_user_id uuid,
  p_created_by uuid,
  p_stops jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_route_id uuid;
  v_waybills text[];
  v_waybill text;
  v_pickup_position bigint;
  v_dropoff_position bigint;
  v_count integer;
  v_updated integer;
BEGIN
  IF p_driver_user_id IS NULL OR p_created_by IS NULL
     OR p_stops IS NULL OR jsonb_typeof(p_stops)<>'array'
     OR jsonb_array_length(p_stops)<2 OR jsonb_array_length(p_stops)>60 THEN
    RAISE EXCEPTION 'Provide a driver and between two and sixty route stops' USING errcode='22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_stops) AS e(value)
    WHERE jsonb_typeof(e.value)<>'object'
       OR COALESCE(e.value->>'waybill','')=''
       OR length(e.value->>'waybill')>100
       OR COALESCE(e.value->>'stop_type','') NOT IN ('pickup','dropoff')
  ) THEN
    RAISE EXCEPTION 'Invalid route stop' USING errcode='22023';
  END IF;

  SELECT array_agg(DISTINCT e.value->>'waybill')
    INTO v_waybills
    FROM jsonb_array_elements(p_stops) AS e(value);

  IF cardinality(v_waybills)*2<>jsonb_array_length(p_stops) THEN
    RAISE EXCEPTION 'Each delivery requires exactly one pickup and one dropoff' USING errcode='22023';
  END IF;

  FOREACH v_waybill IN ARRAY v_waybills LOOP
    SELECT
      min(e.ordinality) FILTER (WHERE e.value->>'stop_type'='pickup'),
      min(e.ordinality) FILTER (WHERE e.value->>'stop_type'='dropoff'),
      count(*) FILTER (WHERE e.value->>'stop_type'='pickup'),
      count(*) FILTER (WHERE e.value->>'stop_type'='dropoff')
    INTO v_pickup_position,v_dropoff_position,v_count,v_updated
    FROM jsonb_array_elements(p_stops) WITH ORDINALITY AS e(value,ordinality)
    WHERE e.value->>'waybill'=v_waybill;
    IF v_count<>1 OR v_updated<>1 OR v_pickup_position IS NULL
       OR v_dropoff_position IS NULL OR v_pickup_position>=v_dropoff_position THEN
      RAISE EXCEPTION 'Each pickup must appear once and before its dropoff' USING errcode='22023';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id=p_created_by AND role IN ('admin','dispatcher') AND account_status='active'
  ) THEN
    RAISE EXCEPTION 'Active dispatcher account required' USING errcode='42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.driver_profiles d
    JOIN public.user_profiles u ON u.id=d.user_id
    WHERE d.user_id=p_driver_user_id AND d.verification_status='approved'
      AND u.account_status='active' AND u.role='driver'
  ) THEN
    RAISE EXCEPTION 'Approved active driver required' USING errcode='42501';
  END IF;

  PERFORM 1 FROM public.customer_bookings
  WHERE waybill=ANY(v_waybills)
  ORDER BY waybill
  FOR UPDATE;

  SELECT count(*) INTO v_count
  FROM public.customer_bookings
  WHERE waybill=ANY(v_waybills) AND status='pending'
    AND driver_user_id IS NULL AND refunded_at IS NULL;
  IF v_count<>cardinality(v_waybills) THEN
    RAISE EXCEPTION 'All route deliveries must be unassigned pending bookings' USING errcode='55000';
  END IF;

  INSERT INTO public.dispatch_routes(driver_user_id,created_by,status)
  VALUES(p_driver_user_id,p_created_by,'assigned')
  RETURNING id INTO v_route_id;

  INSERT INTO public.dispatch_route_stops(route_id,waybill,sequence_no,stop_type)
  SELECT v_route_id,e.value->>'waybill',e.ordinality::integer,e.value->>'stop_type'
  FROM jsonb_array_elements(p_stops) WITH ORDINALITY AS e(value,ordinality);

  UPDATE public.customer_bookings
  SET driver_user_id=p_driver_user_id,assigned_driver=p_driver_user_id::text,status='assigned'
  WHERE waybill=ANY(v_waybills) AND status='pending'
    AND driver_user_id IS NULL AND refunded_at IS NULL;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>cardinality(v_waybills) THEN
    RAISE EXCEPTION 'Concurrent dispatch assignment conflict; retry route creation' USING errcode='40001';
  END IF;

  INSERT INTO public.delivery_status_events(waybill,actor_user_id,previous_status,new_status,notes)
  SELECT waybill,p_created_by,'pending','assigned','Assigned in multi-stop route '||v_route_id::text
  FROM public.customer_bookings
  WHERE waybill=ANY(v_waybills);

  RETURN jsonb_build_object(
    'route_id',v_route_id,
    'assigned_waybills',to_jsonb(v_waybills),
    'stop_count',jsonb_array_length(p_stops)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.reorder_dispatch_route(
  p_route_id uuid,
  p_actor_id uuid,
  p_stop_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_status text;
  v_count integer;
  v_updated integer;
BEGIN
  IF p_route_id IS NULL OR p_actor_id IS NULL OR p_stop_ids IS NULL
     OR cardinality(p_stop_ids)<2 OR cardinality(p_stop_ids)>60
     OR cardinality(p_stop_ids)<>(SELECT count(DISTINCT x) FROM unnest(p_stop_ids) AS x) THEN
    RAISE EXCEPTION 'Invalid route reorder request' USING errcode='22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id=p_actor_id AND role IN ('admin','dispatcher') AND account_status='active'
  ) THEN
    RAISE EXCEPTION 'Active dispatcher account required' USING errcode='42501';
  END IF;

  SELECT status INTO v_status FROM public.dispatch_routes WHERE id=p_route_id FOR UPDATE;
  IF NOT FOUND OR v_status<>'assigned' THEN
    RAISE EXCEPTION 'Editable assigned route not found' USING errcode='55000';
  END IF;

  PERFORM 1 FROM public.dispatch_route_stops WHERE route_id=p_route_id FOR UPDATE;
  SELECT count(*) INTO v_count FROM public.dispatch_route_stops WHERE route_id=p_route_id;
  IF v_count<>cardinality(p_stop_ids)
     OR EXISTS (
       SELECT 1 FROM public.dispatch_route_stops s
       WHERE s.route_id=p_route_id AND NOT (s.id=ANY(p_stop_ids))
     )
     OR EXISTS (
       SELECT 1 FROM unnest(p_stop_ids) AS requested(id)
       WHERE NOT EXISTS (
         SELECT 1 FROM public.dispatch_route_stops s
         WHERE s.route_id=p_route_id AND s.id=requested.id
       )
     ) THEN
    RAISE EXCEPTION 'Reorder must include every route stop exactly once' USING errcode='22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(p_stop_ids) WITH ORDINALITY AS dropoff(id,position)
    JOIN public.dispatch_route_stops d ON d.id=dropoff.id
    WHERE d.route_id=p_route_id AND d.stop_type='dropoff'
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(p_stop_ids) WITH ORDINALITY AS pickup(id,position)
        JOIN public.dispatch_route_stops p ON p.id=pickup.id
        WHERE p.route_id=p_route_id AND p.waybill=d.waybill
          AND p.stop_type='pickup' AND pickup.position<dropoff.position
      )
  ) THEN
    RAISE EXCEPTION 'Pickup must remain before dropoff' USING errcode='22023';
  END IF;

  SET CONSTRAINTS dispatch_route_stops_route_id_sequence_no_key DEFERRED;
  UPDATE public.dispatch_route_stops s
  SET sequence_no=requested.position::integer
  FROM unnest(p_stop_ids) WITH ORDINALITY AS requested(id,position)
  WHERE s.id=requested.id AND s.route_id=p_route_id;
  GET DIAGNOSTICS v_updated=ROW_COUNT;
  IF v_updated<>v_count THEN
    RAISE EXCEPTION 'Route reorder did not update every stop' USING errcode='40001';
  END IF;

  RETURN jsonb_build_object('reordered',true,'stop_count',v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.create_dispatch_route(uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.reorder_dispatch_route(uuid,uuid,uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_dispatch_route(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.reorder_dispatch_route(uuid,uuid,uuid[]) TO service_role;

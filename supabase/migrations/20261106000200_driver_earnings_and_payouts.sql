-- Complete the driver earnings and payout foundation used by the Driver and Company Admin portals.
-- Bank details and financial ledgers are server-only; no browser role receives table access.

CREATE TABLE public.driver_payout_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES public.driver_profiles(user_id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 1000),
  bank_name text NOT NULL CHECK (length(trim(bank_name)) BETWEEN 2 AND 100),
  account_holder text NOT NULL CHECK (length(trim(account_holder)) BETWEEN 2 AND 120),
  account_number text NOT NULL CHECK (account_number ~ '^[0-9]{6,20}$'),
  account_type text NOT NULL CHECK (account_type IN ('cheque','current','savings','transmission','other')),
  branch_code text CHECK (branch_code IS NULL OR branch_code ~ '^[0-9]{6}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','paid')),
  admin_reference text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX driver_payout_one_open_request_per_driver
  ON public.driver_payout_requests(driver_user_id)
  WHERE status IN ('pending','approved');
CREATE INDEX driver_payout_requests_created_idx
  ON public.driver_payout_requests(status,created_at DESC);

CREATE TABLE public.driver_earnings_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_user_id uuid NOT NULL REFERENCES public.driver_profiles(user_id) ON DELETE RESTRICT,
  event_key text NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type IN ('earning','payout_reserved','payout_released','admin_adjustment')),
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0),
  waybill text REFERENCES public.customer_bookings(waybill) ON DELETE RESTRICT,
  payout_request_id uuid REFERENCES public.driver_payout_requests(id) ON DELETE RESTRICT,
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_earnings_ledger_driver_created_idx
  ON public.driver_earnings_ledger(driver_user_id,created_at DESC);
CREATE INDEX driver_earnings_ledger_payout_idx
  ON public.driver_earnings_ledger(payout_request_id) WHERE payout_request_id IS NOT NULL;

ALTER TABLE public.driver_payout_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_earnings_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_payout_requests,public.driver_earnings_ledger FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.driver_payout_requests,public.driver_earnings_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.review_driver_payout(
  p_admin_id uuid,
  p_request_id uuid,
  p_action text,
  p_reference text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_request public.driver_payout_requests%rowtype;
  v_status text;
BEGIN
  IF p_admin_id IS NULL OR p_request_id IS NULL
     OR p_action NOT IN ('approve','reject','paid') THEN
    RAISE EXCEPTION 'Invalid payout review action' USING errcode='22023';
  END IF;

  SELECT * INTO v_request
  FROM public.driver_payout_requests
  WHERE id=p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found' USING errcode='P0002';
  END IF;

  IF p_action='approve' THEN
    IF v_request.status<>'pending' THEN
      RAISE EXCEPTION 'Payout request is not pending' USING errcode='55000';
    END IF;
    UPDATE public.driver_payout_requests
      SET status='approved',reviewed_by=p_admin_id,reviewed_at=now()
      WHERE id=p_request_id
      RETURNING status INTO v_status;
  ELSIF p_action='reject' THEN
    IF v_request.status NOT IN ('pending','approved') THEN
      RAISE EXCEPTION 'Payout request is not awaiting review' USING errcode='55000';
    END IF;
    UPDATE public.driver_payout_requests
      SET status='rejected',reviewed_by=p_admin_id,reviewed_at=now()
      WHERE id=p_request_id;
    INSERT INTO public.driver_earnings_ledger(
      driver_user_id,event_key,event_type,amount_cents,payout_request_id,description
    ) VALUES (
      v_request.driver_user_id,'payout-release:'||v_request.id::text,
      'payout_released',v_request.amount_cents,v_request.id,
      'Released reserved balance after payout request rejection'
    ) ON CONFLICT(event_key) DO NOTHING;
    v_status:='rejected';
  ELSE
    IF v_request.status<>'approved'
       OR p_reference IS NULL
       OR length(trim(p_reference))<3
       OR length(p_reference)>200 THEN
      RAISE EXCEPTION 'Approved payout and actual bank payment reference required' USING errcode='55000';
    END IF;
    UPDATE public.driver_payout_requests
      SET status='paid',admin_reference=trim(p_reference),paid_at=now(),
          reviewed_by=p_admin_id,reviewed_at=now()
      WHERE id=p_request_id
      RETURNING status INTO v_status;
  END IF;

  RETURN jsonb_build_object('id',p_request_id,'status',v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.review_driver_payout(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_driver_payout(uuid,uuid,text,text) TO service_role;

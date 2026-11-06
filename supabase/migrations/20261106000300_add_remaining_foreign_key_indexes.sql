-- Cover foreign keys used by dispatch, payouts, rewards and loan review.
CREATE INDEX IF NOT EXISTS dispatch_routes_created_by_idx
  ON public.dispatch_routes(created_by);
CREATE INDEX IF NOT EXISTS driver_earnings_ledger_waybill_idx
  ON public.driver_earnings_ledger(waybill) WHERE waybill IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_membership_revenue_driver_idx
  ON public.driver_membership_revenue_ledger(driver_user_id) WHERE driver_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_membership_revenue_membership_idx
  ON public.driver_membership_revenue_ledger(membership_id) WHERE membership_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_micro_loan_applications_reviewed_by_idx
  ON public.driver_micro_loan_applications(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_micro_loans_approved_by_idx
  ON public.driver_micro_loans(approved_by) WHERE approved_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_payout_requests_reviewed_by_idx
  ON public.driver_payout_requests(reviewed_by) WHERE reviewed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS driver_reward_ledger_waybill_idx
  ON public.driver_reward_ledger(waybill) WHERE waybill IS NOT NULL;
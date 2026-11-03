-- Cover foreign-key lookups used by account cleanup, wallet ownership and POD review.
CREATE INDEX IF NOT EXISTS delivery_status_events_actor_user_id_idx ON public.delivery_status_events(actor_user_id);
CREATE INDEX IF NOT EXISTS proof_of_delivery_driver_user_id_idx ON public.proof_of_delivery(driver_user_id);
CREATE INDEX IF NOT EXISTS wallet_accounts_referred_by_idx ON public.wallet_accounts(referred_by);
CREATE INDEX IF NOT EXISTS wallet_loans_owner_hash_idx ON public.wallet_loans(owner_hash);
CREATE INDEX IF NOT EXISTS wallet_payments_owner_hash_idx ON public.wallet_payments(owner_hash);
CREATE INDEX IF NOT EXISTS wallet_withdrawals_owner_hash_idx ON public.wallet_withdrawals(owner_hash);

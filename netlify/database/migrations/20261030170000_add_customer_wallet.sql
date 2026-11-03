CREATE TABLE wallet_accounts (
 owner_hash TEXT PRIMARY KEY, referral_code TEXT NOT NULL UNIQUE,
 referred_by TEXT REFERENCES wallet_accounts(owner_hash),
 refund_cents BIGINT NOT NULL DEFAULT 0 CHECK(refund_cents>=0),
 promo_cents BIGINT NOT NULL DEFAULT 0 CHECK(promo_cents>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wallet_ledger (
 id UUID PRIMARY KEY, owner_hash TEXT NOT NULL REFERENCES wallet_accounts(owner_hash),
 event_key TEXT NOT NULL UNIQUE, refund_delta BIGINT NOT NULL DEFAULT 0,
 promo_delta BIGINT NOT NULL DEFAULT 0, description TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX wallet_ledger_owner ON wallet_ledger(owner_hash,created_at DESC);
ALTER TABLE customer_bookings ADD COLUMN assigned_driver TEXT;
ALTER TABLE customer_bookings ADD COLUMN completed_at TIMESTAMPTZ;
ALTER TABLE customer_bookings ADD COLUMN paid_at TIMESTAMPTZ;
ALTER TABLE customer_bookings ADD COLUMN rewards_at TIMESTAMPTZ;
ALTER TABLE customer_bookings ADD COLUMN pin_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE customer_bookings ADD COLUMN pin_locked_until TIMESTAMPTZ;
ALTER TABLE customer_bookings ADD COLUMN payment_source TEXT CHECK(payment_source IN ('cash','wallet','paystack','pay_later'));
ALTER TABLE customer_bookings ADD COLUMN wallet_refund_used BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customer_bookings ADD COLUMN wallet_promo_used BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customer_bookings ADD COLUMN refunded_at TIMESTAMPTZ;
CREATE TABLE wallet_loans (
 id UUID PRIMARY KEY, owner_hash TEXT NOT NULL REFERENCES wallet_accounts(owner_hash),
 waybill TEXT NOT NULL UNIQUE, amount_cents BIGINT NOT NULL CHECK(amount_cents>0 AND amount_cents<=50000),
 due_at TIMESTAMPTZ NOT NULL DEFAULT (NOW()+INTERVAL '7 days'), paid_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE wallet_payments (
 reference TEXT PRIMARY KEY, owner_hash TEXT NOT NULL REFERENCES wallet_accounts(owner_hash),
 waybill TEXT, loan_id UUID REFERENCES wallet_loans(id),
 amount_cents BIGINT NOT NULL CHECK(amount_cents>0),
 state TEXT NOT NULL DEFAULT 'created' CHECK(state IN ('created','success','superseded')),
 checkout_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), CHECK((waybill IS NULL)<>(loan_id IS NULL))
);
CREATE UNIQUE INDEX wallet_active_booking_payment ON wallet_payments(waybill) WHERE state='created' AND waybill IS NOT NULL;
CREATE UNIQUE INDEX wallet_active_loan_payment ON wallet_payments(loan_id) WHERE state='created' AND loan_id IS NOT NULL;
CREATE TABLE wallet_withdrawals (
 reference TEXT PRIMARY KEY,owner_hash TEXT NOT NULL REFERENCES wallet_accounts(owner_hash),
 gross_cents BIGINT NOT NULL CHECK(gross_cents>0),fee_cents BIGINT NOT NULL CHECK(fee_cents>=0),
 net_cents BIGINT NOT NULL CHECK(net_cents>0),speed TEXT NOT NULL CHECK(speed IN ('instant','standard')),
 state TEXT NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','processing','paid','failed')),
 recipient_code TEXT NOT NULL,available_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK(net_cents+fee_cents=gross_cents)
);
ALTER TABLE wallet_accounts ADD COLUMN promo_debt_cents BIGINT NOT NULL DEFAULT 0 CHECK(promo_debt_cents>=0);
ALTER TABLE wallet_ledger ADD COLUMN promo_debt_delta BIGINT NOT NULL DEFAULT 0;
ALTER TABLE customer_bookings ADD COLUMN original_price NUMERIC(20,2);

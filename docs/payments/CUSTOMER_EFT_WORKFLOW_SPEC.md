# Customer EFT payment workflow — implementation and release specification

Status: development specification only. Not deployed. No production schema, Edge Function, booking, or payment record has been changed.

## Current behavior verified on main

- Customer booking accepts `payment_method='dispatch'` for payment arranged with dispatch.
- The Customer booking page explains that payment remains unconfirmed until arranged with dispatch.
- Customer portal booking creation accepts only `cash`, `dispatch`, and `wallet`.
- The current EFT path is a manual request for verified bank details through dispatch. It does not create an EFT-specific payment source, record a transfer reference, accept customer proof, or provide an admin payment-verification queue.
- Customer booking reads expose booking payment method/source and timestamps, but no EFT submission records.
- Driver cash collection and driver cash deposit reconciliation are separate workflows. They must not be reused as customer EFT payment evidence.

## Intended customer journey

1. Customer chooses “EFT / bank transfer” at booking. Persist a distinct `payment_method='eft'` value (or a compatible normalized value) only after the database constraints and all consumers have been updated.
2. The server returns verified company bank instructions from protected configuration. Never put bank account details in frontend source or a public repository.
3. Each booking has a unique payment reference generated server-side. The customer sees the reference and exact amount due.
4. Customer may submit transfer date, bank reference, payer name, amount, and optional proof document. Submission is evidence only, not proof of cleared funds.
5. The customer booking remains unpaid and cannot be dispatched as paid until an authorized administrator verifies the funds against the actual company bank statement.
6. Customer sees clear states: instructions issued, proof submitted, under review, confirmed, rejected, or expired. Rejected/expired submissions remain auditable.

## Proposed data model

Create a dedicated `customer_eft_submissions` table with:
- UUID primary key; booking waybill foreign key; customer owner UUID; unique server-generated payment reference.
- Expected amount in integer cents and currency fixed to ZAR.
- Customer-supplied payer name, transfer date, bank reference, submitted amount cents, optional private proof object path.
- Status constrained to `awaiting_transfer`, `proof_submitted`, `under_review`, `confirmed`, `rejected`, `expired`.
- Admin reviewer, review timestamp, actual bank statement reference, rejection reason, created/updated timestamps.
- Idempotency/uniqueness preventing multiple active submissions for the same booking and preventing duplicate confirmation.
- Immutable audit events for submission and every review decision.

Use a private Storage bucket for proof. Object paths must be scoped by authenticated customer ID. Only the owning customer and active Company Admin may access proof; use short-lived signed URLs. Enforce MIME types, size limits, and server-side path ownership checks.

## Server-side invariants

- Verify bearer token with Supabase Auth; derive customer ID from verified session, never from request body.
- Verify booking ownership, unpaid status, eligible booking status, and server-calculated amount.
- Never trust the client amount, bank reference, proof path, booking owner, or reviewer identity.
- Admin review must require active `user_profiles.role='admin'`; dispatcher/driver roles cannot confirm.
- Confirmation must be atomic and idempotent under row lock. Record `payment_source='eft'`, `paid_at`, reviewer and bank statement reference in one transaction.
- Confirmation must not create a second driver earning event or bypass the existing 75%/25% earning rules.
- A rejected submission cannot mark a booking paid. A duplicate webhook or repeated admin click cannot duplicate settlement.
- No customer-facing endpoint may disclose bank credentials or other customers' submissions.
- Keep EFT transfer proof distinct from driver cash deposit proof.

## Company Admin experience

Add an EFT review queue showing waybill, customer identity, expected amount, transfer date, payer name, bank reference, and proof link. Require the reviewer to enter the actual matching bank statement reference before confirming. Require a reason when rejecting. Show an immutable audit trail and prevent confirmation if the booking has already been paid, refunded, cancelled, or otherwise become ineligible.

## Required tests before publication

1. Customer can obtain instructions only for their own eligible unpaid booking.
2. Server-generated payment reference is unique and stable for the booking.
3. Customer cannot change owner, expected amount, payment source, status, or reviewer.
4. Missing, malformed, oversized, wrong-owner, and cross-customer proof uploads are rejected.
5. Customer cannot read another customer's submission or proof.
6. Driver and dispatcher cannot access admin review or confirm funds.
7. Admin cannot confirm without a bank statement reference.
8. Admin rejection requires a reason and leaves booking unpaid.
9. Correct admin confirmation marks booking paid exactly once with source EFT.
10. Concurrent/double confirmation is idempotent.
11. EFT confirmation integrates with existing driver earning and 75%/25% platform allocation exactly once.
12. Cancelled/refunded/paid bookings cannot be confirmed.
13. Storage signed URLs expire and evidence access is admin/customer scoped.
14. All audit events record actor, time, action, and reference without exposing secrets.
15. Regression tests confirm cash, wallet, driver cash deposits, payouts, and card-disabled behavior remain unchanged.

## Release gates

- Implement on an isolated development branch first.
- Apply schema and Edge Function changes only to an isolated staging Supabase project.
- Execute the tests above plus the existing CASH-01 through CASH-20 staging suite.
- Review RLS, Storage policies, function grants, SQL security-definer functions, and Supabase advisors.
- Only after successful staging tests, prepare a GitHub Pages release for Customer and Company Admin. Driver UI should change only if a tested driver workflow requires it.
- Production Supabase migration/function deployment and production Pages publication are separate approvals. No production backend change is authorized by this specification.
- Card payments remain disabled. EFT and cash remain separate methods.

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


## Repository-specific implementation findings (verified on main, 2026-11-08)

- The Customer Portal authenticates the bearer token with Supabase Auth, derives `owner = authData.user.id`, and requires `user_profiles.role='customer'` plus `account_status='active'`.
- Customer bookings use `customer_bookings.owner_hash` as the authenticated user's UUID. EFT ownership checks should follow this same server-derived identity.
- Company Admin cash reconciliation uses `user_profiles.role='admin'` and `account_status='active'`. The EFT admin queue should use the same active-admin gate, not user metadata.
- The current customer booking creation allow-list is exactly `cash`, `dispatch`, and `wallet`. Introducing EFT requires coordinated updates to the customer UI, customer-portal Edge Function, and database constraints; changing only the UI would fail server validation.
- The existing `customer_bookings.payment_source` check constraint currently allows null, cash, wallet, payfast, paystack, and pay_later. It does **not** allow `eft`. The EFT migration must add `eft` while preserving all existing allowed values.
- The existing cash reconciliation implementation confirms that customer cash receipt proof and driver cash deposit proof use separate private buckets and separate ledgers. Customer EFT proof must have its own private bucket and table; it must not be stored in either driver cash bucket.
- The existing customer portal currently returns booking payment metadata but has no EFT submission records or transfer-reference workflow.

## Implementation sequencing decision

Do not change the existing `customer-portal` booking method allow-list to include EFT until the matching schema migration, submission/review Edge Function, and customer/admin interfaces are committed together. Otherwise a customer could select EFT but have no reliable way to submit evidence or get the payment verified.

The implementation PR should therefore be a coordinated feature branch containing:
1. Migration: payment-source constraint update, EFT submission/audit tables, indexes, RLS, private proof bucket and narrowly scoped Storage policies.
2. Edge Function: authenticated customer submission/list actions and active-admin queue/review actions, with amount derived from the booking server-side and atomic idempotent confirmation.
3. Customer UI: EFT instructions, unique reference, transfer metadata, private proof upload and status display.
4. Company Admin UI: review queue, private evidence access, bank statement reference requirement, rejection reason and audit trail.
5. Automated tests: ownership, role separation, RLS/Storage isolation, duplicate/concurrent confirmation, amount integrity, booking eligibility and regression of cash/wallet/card-disabled paths.

No production schema or function change has been made as part of this investigation.


## Staging security review (2026-11-08)

The verified staging migration history includes `20261107235657_driver_cash_collection_reconciliation` and `20261107235704_paystack_provider_support`. Both were applied to this staging project only.

The Supabase security advisor reports 25 public tables with RLS enabled but no policies. A direct privilege audit found no `SELECT` or `INSERT` grants to either `anon` or `authenticated` on the inspected public tables. The current design uses authenticated Edge Functions with server-side service-role access and explicit role/ownership checks. Therefore, do not add broad RLS policies merely to silence the linter. Before exposing any table to the Data API, add narrowly scoped policies and grants together, and test customer/driver/admin isolation.

The advisor also reports five callable `SECURITY DEFINER` functions in the driver-cash workflow. These are intentional RPC entry points used by the authenticated driver/admin operations function; their bodies perform active-profile and role checks, and the admin balance/reconciliation functions verify the active admin role. The warning is about the callable privilege surface, not proof that these functions are exploitable. Keep the RPCs unavailable to `anon`, retain their internal authorization checks, and test each role boundary. In particular, review `submit_driver_cash_deposit_proof` for active-driver and approved-driver validation before treating the cash flow as release-ready.

The advisor also reports that leaked-password protection is disabled in Auth. This is a project-level Auth setting and should be enabled and verified separately; it is not safe to change it as a side effect of the EFT schema migration.

Staging baseline verification:
- 29 public tables were inspected; all inspected tables had RLS enabled.
- The inspected public tables had no direct `anon` or `authenticated` SELECT/INSERT grants.
- Staging had 3 Auth users and 3 profiles; no customer bookings, cash receipts, or cash deposits.
- Existing staging customer booking constraints accept `cash` and `dispatch`; the payment-source check accepts null, cash, wallet, PayFast, Paystack, and pay-later, but not EFT.
- No customer EFT schema, proof bucket, submission endpoint, or admin EFT review endpoint has been deployed.

Do not represent the security advisor warnings as fixed. Record them as reviewed with the above privilege context, and retain the remaining remediation items as release gates.


## Follow-up staging constraint verification (2026-11-08)

A direct query of the existing staging database and the `create_wallet_funded_booking` function clarified how payment methods are normalized:

- The Customer Portal request validator accepts `cash`, `dispatch`, and `wallet`.
- Ordinary cash/dispatch bookings persist the selected value in `customer_bookings.payment_method`. The database constraint permits only `cash` and `dispatch`.
- Wallet-funded bookings are created through `create_wallet_funded_booking`. That RPC deliberately persists `payment_method='dispatch'`, sets `payment_source='wallet'`, records `paid_at`, and deducts wallet balances in one transaction. This is why the database payment-method constraint does not include `wallet`.
- The staging `customer_bookings.payment_source` constraint permits null, `cash`, `wallet`, `payfast`, `paystack`, and `pay_later`, but not `eft`.
- The separate cash-distance constraint requires cash bookings to have a mapped distance below 12,000 metres.

This is an intentional distinction between the requested payment option and the persisted booking method/source pair, not evidence that the wallet flow is broken. EFT must be designed consistently with this model: use a distinct, explicit EFT payment source and a clearly defined unpaid booking state; do not copy the wallet RPC's immediate paid settlement behavior. Add transaction-level tests proving that EFT evidence submission does not set `paid_at`, and that only an authorized admin bank-statement verification settles it.

No staging schema was changed during this follow-up inspection. No production changes were made.


## Additional staging RPC authorization finding (2026-11-08)

A direct read-only inspection of the staging function definitions and grants identified one cash-workflow hardening item:

- `submit_driver_cash_deposit_proof(uuid,text,text)` is a `SECURITY DEFINER` function executable by the `authenticated` role. It verifies that the proof object belongs to the caller's UUID path, exists in the private driver-cash proof bucket, and that the deposit belongs to the caller and is awaiting proof.
- Unlike the other inspected driver cash RPCs, this function does not independently verify that the caller still has an active `user_profiles.role='driver'` profile and an approved `driver_profiles.verification_status='approved'` record.
- The current `driver-cash-operations` Edge Function checks active driver/admin role before calling it, but the RPC is also directly callable by authenticated users through the exposed `/rest/v1/rpc` surface. The Edge Function check therefore does not replace authorization inside this SECURITY DEFINER function.

Required remediation before treating driver cash proof submission as release-ready: add the same active-driver and approved-driver checks inside the RPC, retain the caller/deposit/object ownership checks, and add tests for inactive, suspended, unapproved, wrong-owner, missing-object, and already-processed cases. Keep `anon` execution revoked. This is a staging review finding only; no function or database changes were made.

The staging advisor currently reports five authenticated-callable SECURITY DEFINER driver-cash RPCs, no anon execution on the inspected functions, five unindexed foreign keys, three RLS auth-initplan performance findings, and Auth leaked-password protection disabled. These are tracked separately; unused-index notices are not treated as automatic removal instructions.


## Cash-proof RPC remediation detail (2026-11-08)

A read-only comparison of the other staging cash RPC definitions confirms the intended authorization pattern:

- `create_driver_cash_deposit` checks `user_profiles.id = auth.uid()`, `role='driver'`, `account_status='active'`, and `driver_profiles.user_id = auth.uid()` with `verification_status='approved'`.
- `record_driver_cash_receipt` applies the same two-profile checks before recording the receipt or changing the booking.
- `submit_driver_cash_deposit_proof` should apply those same checks immediately after validating that `auth.uid()` is non-null, before checking the Storage object or updating a deposit. Keep the existing UUID-prefixed object-path check, private-bucket object existence check, deposit-owner predicate, and `status='awaiting_deposit'` transition.
- Preserve the existing error contract for authorization failure (`42501`), and keep `anon` execution revoked. Verify the function's effective grants after remediation rather than relying only on the Edge Function wrapper.

The other inspected RPCs also demonstrate that the admin-only balance and reconciliation functions check `user_profiles.role='admin'` and `account_status='active'` inside the SECURITY DEFINER function itself. This comparison is evidence for the remediation pattern only; no SQL function was changed in this review.


## Follow-up RPC grant and Storage policy verification (2026-11-08)

A further read-only staging audit verified the effective function privileges and the relevant Storage policies:

- `submit_driver_cash_deposit_proof(uuid,text,text)` is owned by `postgres`, is `SECURITY DEFINER`, and has `search_path=public`.
- `anon` cannot execute it; `authenticated` and `service_role` can. The authenticated execution grant is intentional for the RPC workflow but makes the missing in-function active/approved-driver check a real authorization gap, not merely a linter concern.
- The driver cash deposit proof bucket is private by policy: authenticated users can read objects in their own UUID folder; active admins have a separate read policy; uploads are restricted to the caller's UUID folder. The receipt-signature bucket has the corresponding owner/admin read and owner-folder upload policies.
- The current proof upload Storage policy does not itself require active/approved driver status. The RPC must still enforce that status before attaching an object to a deposit. Consider adding an active/approved-driver predicate to the upload policy as defense in depth, then test that it does not block legitimate approved drivers.

The security advisor continues to report five authenticated-callable SECURITY DEFINER cash RPCs and disabled leaked-password protection. The former are intentionally callable workflow entry points but must retain strict internal authorization; the latter remains a separate Auth configuration action. No grants, policies, functions, or Auth settings were changed by this audit.


## Latest staging advisor and tooling check (2026-11-08)

A fresh advisor run against the isolated staging project returned the same outstanding security baseline and no health-advisor findings:

- Security: 25 public tables with RLS enabled and no policies (INFO); five authenticated-callable SECURITY DEFINER cash RPCs (WARN); leaked-password protection disabled (WARN).
- Performance: five unindexed foreign keys (INFO), three RLS auth-initplan findings (WARN), and 40 unused-index notices (INFO). Do not drop indexes based on the unused-index notices alone; evaluate query plans and workload first.
- Health: no findings returned in this run.
- The five unindexed foreign keys are on `driver_cash_clearing_ledger` (deposit, cash receipt, created_by), `driver_cash_deposits` (reconciled_by), and `driver_cash_receipts` (driver_user_id). The three auth-initplan findings are on the own-read policies for driver cash receipts, clearing ledger, and deposits.

No advisor finding was changed or marked fixed. In particular, the missing active/approved-driver check in `submit_driver_cash_deposit_proof` remains a code-level remediation item. The Auth leaked-password setting remains a separate security-hardening task requiring its own controlled change and verification.

Tooling guardrail for the eventual implementation workspace: Supabase CLI v3 now targets the local stack by default. Any hosted staging command must explicitly target the remote project, and unattended hosted mutations require explicit confirmation flags. Pin the intended CLI version in CI and verify the target project before any hosted operation. This audit used read-only Supabase MCP checks; it did not run a CLI migration or mutate staging or production.

This update is documentation only. No SQL, Edge Function, Storage policy, Auth setting, website, or deployment was changed.

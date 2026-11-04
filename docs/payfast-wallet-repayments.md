# PayFast wallet repayment design

## Scope

This stage covers repayment of an existing SwiftHaul pay-later loan only. It does not enable wallet top-ups, wallet-funded bookings, refunds, or withdrawals. The existing PayFast booking checkout and its booking-only payment ledger remain separate.

## Existing database facts

- `wallet_loans` stores one loan per waybill, linked to a wallet owner.
- Loan principal is stored in integer cents and constrained to R0.01–R500.00.
- Loans have a due timestamp and nullable `paid_at`.
- `wallet_ledger.event_key` is unique, supporting idempotent financial ledger entries.
- `payment_transactions.booking_waybill` is a required booking foreign key; it must not be repurposed for loan payments.

## Required implementation

1. Add a dedicated `wallet_payfast_payments` table with UUID ID, wallet owner, loan UUID, unique merchant reference, unique PayFast payment ID, amount in ZAR, sandbox mode, status, raw validated ITN payload, timestamps, and idempotency constraints.
2. Keep direct client access disabled with RLS and revoke table access from anon/authenticated roles.
3. Add a service-role-only atomic database function that:
   - Locks the payment row and corresponding loan row.
   - Confirms owner, loan, amount, pending payment status, and unpaid loan.
   - Rejects a second payment if the loan has already been paid by another attempt.
   - Marks the payment complete and sets `wallet_loans.paid_at` in one transaction.
   - Adds one unique `wallet_ledger` event keyed to the payment UUID, with zero balance deltas and a repayment description, so the wallet has a traceable audit entry without inflating refund/promotional balances.
   - Returns success for a duplicate delivery of the same already-applied PayFast ITN, but never applies a second payment.
4. Add an authenticated `payfast-wallet-checkout` Edge Function. It must verify the signed-in active customer, loan ownership, unpaid state, amount, pending attempt reuse, and use the existing PayFast sandbox credentials and hosted checkout endpoint. Use a distinct merchant reference prefix such as `SH-WALLET-PF-<uuid>`.
5. Extend the existing PayFast ITN handler to route booking and wallet references to separate confirmation RPCs. Preserve the existing PayFast source-IP, signature, server-side VALID response, merchant, payment-status, and gross-amount checks. Validate amount and payment ownership against the stored attempt, not browser return parameters.
6. Do not allow browser return/cancel pages to mark a loan paid. Only the validated ITN and atomic RPC may do so.
7. Add a customer-facing **Repay with PayFast (Sandbox)** action beside each unpaid loan. Display a pending/awaiting-confirmation state until the verified ITN updates the loan. Disable duplicate submissions while an attempt is pending.
8. Add administrator-visible reconciliation details: internal payment UUID, merchant reference, PayFast payment ID, loan/waybill, owner, amount, ITN validation timestamp, and final status. Never expose raw ITN data or another customer's details to customers.

## Security and edge cases to test

- A customer cannot pay another customer's loan by changing a waybill or UUID.
- Amount tampering is rejected.
- Two concurrent checkout attempts do not create ambiguous active payments.
- Replayed ITNs do not create duplicate ledger events or duplicate loan settlement.
- An ITN for a booking reference cannot reach the wallet repayment RPC, and vice versa.
- A loan already repaid manually or by another payment cannot be settled again.
- Invalid signature, untrusted source IP, invalid PayFast server validation, wrong merchant, wrong payment ID, and wrong amount are rejected.
- A timeout or missing ITN remains pending; a browser return is not proof of payment.
- A definitive failed/cancelled PayFast result can be retried without changing the loan amount.

## Release gate

Keep this flow disabled until schema migration, both Edge Functions, UI wiring, sandbox ITN testing, and replay/concurrency tests have all passed. No live PayFast credentials or live endpoint are permitted in this migration stage.

## Implementation status

The first implementation slice is now present on the migration branch:

- `public.wallet_payfast_payments` is a dedicated sandbox payment-attempt table; booking payment rows are not reused.
- The table has RLS enabled, no direct anon/authenticated table privileges, a unique merchant reference, a unique PayFast payment ID, and a partial unique index allowing only one pending attempt per loan.
- `public.apply_payfast_wallet_repayment` locks the payment and loan rows, validates amount/ownership/unpaid status, marks the loan paid atomically, and writes one zero-delta wallet ledger audit event. It is executable only by service_role.
- `payfast-wallet-checkout` is deployed with JWT verification enabled. It checks the signed-in active customer, profile deletion status, wallet ownership, loan ownership, and the R5–R500 supported sandbox amount.
- `payfast-itn` is deployed as version 3 with JWT verification disabled for PayFast's webhook. It retains source-IP, signature, server-side VALID, merchant, amount and payment-ID checks, then routes booking references and wallet references to different RPCs.
- `public/wallet.js` now displays a **Repay with PayFast (Sandbox)** action for eligible unpaid loans and submits only the returned signed fields to the fixed PayFast sandbox endpoint.
- Browser return/cancel query parameters do not settle a loan. The verified ITN is the only settlement path.

## Remaining validation / release gate

- No real sandbox wallet repayment has yet been completed; the GitHub Pages customer site still needs to be enabled and an authenticated test loan/customer account is required.
- A PayFast cancellation is not trusted to alter server payment state; a pending attempt is reused until an authoritative notification/reconciliation changes it.
- Amounts below R5 cannot use this PayFast sandbox checkout and must be handled through a separate approved support/manual process.
- Keep the wallet repayment button in sandbox mode. Do not configure live PayFast credentials or enable production payments from this branch.
- Before release, test successful ITN, duplicate ITN replay, wrong amount, wrong merchant, invalid signature, wrong IP, cancelled checkout, concurrent checkout attempts, already-paid loans, and attempts to access another customer's loan.

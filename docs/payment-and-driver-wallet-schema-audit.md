# SwiftHaul SA payment and driver-wallet schema audit

Audit date: 2026-11-07
Scope: read-only inspection of the linked Supabase project's live public schema and stored financial functions. No rows were changed, no migration was applied, and no Edge Function was deployed.

## Important findings from the currently linked Supabase database

### Customer booking/payment schema
- `customer_bookings.payment_method` currently allows only `cash` and `dispatch`.
- `customer_bookings.payment_source` currently allows `cash`, `wallet`, `paystack`, and `pay_later`.
- The currently inspected live booking table does not yet contain the optional handling-assistance fields introduced in the unmerged PR branch.
- `payment_transactions` is already a PayFast transaction table with unique payment reference fields, provider status, ZAR currency, sandbox/live mode, ITN payload and completion/refund timestamps.
- The live PayFast confirmation function `apply_payfast_payment` locks the transaction row, checks amount and idempotency, then marks the booking paid. This is the right general pattern for provider payment confirmation.
- The live schema inspected does not yet represent a separate customer-facing card payment method. The PR branch UI labels PayFast and card separately but routes both to PayFast hosted checkout.

### Customer wallet
- `wallet_accounts` and `wallet_ledger` represent customer wallet refund/promo funds. They are not the driver's earnings wallet.
- `create_wallet_funded_booking` atomically consumes customer refund/promo balances and creates a paid booking. It currently funds only the delivery quote amount and has no optional assistance fee argument.
- Do not reuse customer `wallet_accounts` / `wallet_ledger` as a driver cash liability ledger.

### Driver earnings and payouts
- `driver_earnings_ledger` is the driver's earnings/payout ledger. It has unique event keys, event types, amount cents, waybill and payout references.
- `credit_driver_earning_on_delivery` currently inserts the driver's 75% share when a booking status changes to `delivered`. The trigger does not check `paid_at`, `payment_source`, a signed cash receipt, or a company cash settlement.
- `request_driver_payout` calculates available balance from the sum of driver earnings and reward ledgers and reserves payout funds. It does not subtract any cash-held liability.
- `review_driver_payout` reserves, releases or marks a payout as paid using ledger entries. This should be retained and extended carefully, not bypassed.

## Critical financial issue to resolve before enabling cash

The current delivery-completion trigger credits 75% at delivery even when there is no confirmed payment. That is inconsistent with the requested policy that customer funds are received by SwiftHaul first and only then the driver wallet is updated with the driver share.

Before production cash collection is enabled, replace the implicit assumption that delivery completion means payment has been received with an explicit settlement state machine:

- Delivery completion records operational completion.
- PayFast completion is confirmed only by validated ITN.
- Cash receipt is confirmed only by the assigned driver, with amount and customer-signed receipt evidence, then becomes a company cash-clearing receivable until remitted/reconciled.
- EFT/store deposits are confirmed by company reconciliation, not by a driver-uploaded screenshot.
- The 75% driver earning is credited once only after the payment is verified/settled under the approved finance policy. For driver-collected cash, the company must account for the full cash liability before making the driver's net payable available.
- A missing or disputed payment must not become withdrawable earnings merely because the delivery status changed to delivered.

The implementation must preserve the 25% platform share and ensure the gross delivery charge is allocated exactly once. Handling assistance is a separate charge and must not accidentally inflate the 75% delivery earning base unless the business explicitly decides to share it.

## Driver cash liability model

Do not store cash owed to the company as a negative balance in the driver's earnings wallet. Add a separate driver cash-clearing ledger with append-only entries such as:

- `cash_received_from_customer` — increases driver's cash-held liability.
- `cash_deposit_initiated` — informational pending deposit; does not reduce liability.
- `cash_deposit_reconciled` — reduces cash-held liability only after company reconciliation.
- `cash_receipt_reversal` — controlled reversal for an approved error/refund.
- `cash_variance_adjustment` — admin-approved, reasoned and auditable correction.

The driver interface should show earnings, cash held for SwiftHaul, deposits awaiting reconciliation and confirmed deposits as separate balances. The payout calculation should consider only the net amount legally/contractually available after any properly authorised cash-liability offsets. Do not automatically deduct unrelated earnings without a disclosed contractual basis, notice and dispute mechanism.

## Safe implementation order

1. Create a test/staging Supabase branch or equivalent isolated environment and verify it has the same migration history as the intended code branch.
2. Design a single atomic settlement RPC/trigger path for PayFast and cash. Avoid maintaining two independent places that can credit the 75% driver share.
3. Add immutable cash receipt and driver cash-clearing ledgers, unique idempotency keys, RLS and service-role-only mutation.
4. Add driver receipt capture (actual amount, waybill, timestamp, customer signature, receipt ID and optional proof image), with strict assignment/status checks.
5. Add unique driver deposit instructions and a company-only reconciliation workflow. EFT reference and supported retail deposit provider references must be generated server-side.
6. Update the driver payout reservation function to account for eligible cash liabilities without allowing a driver to self-approve a deposit or payout.
7. Add reconciliation views and audit trails to Company Admin.
8. Add comprehensive tests for duplicate receipts, partial/mismatched cash, refunds, cancellation, driver reassignment, delivery without payment, delayed ITNs, retries, disputes and payout concurrency.
9. Review the finance policy, customer receipt terms, driver contractor agreement, POPIA evidence retention and bank/payment-provider arrangements.
10. Only after review and explicit owner approval: apply migrations, deploy Edge Functions, test sandbox end-to-end, then separately approve any production release.

## Scope boundary

This audit is informational and does not authorise production changes. The PR remains a code proposal until reviewed, tested and approved. Do not apply the migration or deploy functions merely because the documentation was committed.

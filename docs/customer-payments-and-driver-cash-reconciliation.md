# SwiftHaul SA customer payments and driver cash reconciliation

Status: implementation specification for PR #33. This document does not activate payment processing, move funds, alter production data, or apply a database migration.

## Customer payment choices

Present these as distinct customer-facing choices:

1. **PayFast online** — customer completes the hosted PayFast checkout. The server creates a pending payment reference and only marks the booking paid after a validated PayFast ITN is applied.
2. **Card** — a distinct customer label that opens the same hosted PayFast checkout. PayFast presents the supported card method; SwiftHaul must not collect or store card numbers or CVV.
3. **Cash to driver** — available only where the booking rules allow it. Booking creation is not proof of payment. The booking remains cash-pending until the assigned driver records the amount received and the customer signs the payment/delivery receipt.
4. **EFT / direct deposit** — dispatch supplies verified company banking details and a unique booking-specific reference. The booking remains unpaid until the company reconciles the deposit.
5. **SwiftHaul customer wallet** — only when sufficient available customer wallet funds exist and the trusted wallet booking RPC supports all booking extras.

The current customer app already renders separate **Pay with PayFast** and **Pay by card · PayFast** buttons on unpaid bookings. Both currently call the same hosted PayFast checkout function. The booking form's payment selector currently offers dispatch arrangement, cash (subject to its route rule), and wallet. Do not describe card as a separate acquiring integration: it is a separate customer choice using PayFast's hosted card flow.

## Cash collection lifecycle

Cash is collected by the driver on behalf of SwiftHaul, not retained as driver earnings.

1. Customer selects cash. Server creates a booking with a cash-pending payment state.
2. Dispatch assigns an approved driver. Cash collection remains disabled until the driver is assigned and the delivery reaches the configured collection stage.
3. Driver taps **Record cash received**, enters the actual amount, confirms the customer received the delivery/payment receipt, and captures the customer's signature (and optional receipt photo). Store timestamp, actor, waybill, amount, currency, and evidence reference.
4. Server validates assignment, status, expected amount, allowed variance/approval, and idempotency. It records the payment as cash received and credits the company's cash-clearing/receivable ledger. It must not credit the driver's earnings wallet with the customer's gross cash.
5. The driver dashboard shows a separate **Cash held for SwiftHaul** liability/collection balance and the delivery's **75% driver earning** as a separate pending/earned amount under the existing delivery completion rules.
6. Company Admin reconciles cash collection and records a deposit/remittance against the driver's cash liability. A confirmed deposit reduces the driver's cash-held balance. The deposit does not create a second driver earning.
7. A mismatch, missing signature, duplicate receipt, or disputed amount enters an admin review state; no automatic settlement occurs.

## Driver cash reconciliation controls

Provide two explicit driver actions:

- **I am holding cash for SwiftHaul** — records cash physically received and increases the driver's cash-held liability.
- **Make a company deposit** — creates a deposit instruction and a unique reference. The driver chooses EFT / bank transfer or a supported participating-store cash deposit. The driver submits proof; Admin reconciles against the company bank statement before the liability is reduced.

The driver's wallet must display separate figures:
- Available driver earnings (withdrawable subject to payout rules).
- Pending driver earnings.
- Cash held for SwiftHaul (not earnings; amount owed to the company).
- Deposits submitted / awaiting reconciliation.
- Confirmed deposits.
- Any approved adjustments, each with an immutable ledger entry.

If the cash-held liability exceeds available driver earnings, show the amount outstanding as a liability and block cash collection on new jobs or apply a clearly disclosed dispatch hold. Do not silently make the wallet negative or deduct money from unrelated earnings. Any recovery offset must be an explicit, auditable, contractually approved ledger transaction with notice to the driver and an admin dispute path.

## Deposit references and channels

Generate a unique, non-reusable deposit reference per driver deposit instruction, for example `SHD-<short random token>`. Do not use a booking waybill as the driver's recurring deposit reference. Store the reference, driver, expected amount, channel, creation/expiry time, status, evidence, reconciler and reconciliation time.

- **EFT / bank transfer:** show verified company bank details from a protected server-side configuration and the unique reference. Never hardcode bank account details in public JavaScript.
- **Participating-store cash deposit:** enable only after SwiftHaul has a confirmed bank/payment-provider arrangement and the specific store network supports the company account. Show the provider's accepted reference format and deposit limits.
- **PayFast:** the existing PayFast hosted checkout and ITN integration is appropriate for online customer payments. A PayFast payment request can be added as an online deposit channel only if the merchant account/provider contract supports the intended flow. A PayFast reference is not proof that a driver made a cash deposit at a retail store or bank. Store/bank deposits require bank-statement or provider reconciliation.

## Ledger and security invariants

- All money values are integer cents (ZAR); never trust client-supplied amounts or balances.
- All cash receipt, deposit, refund, fee and driver earning mutations are server-side and atomic.
- Use immutable, append-only ledger events with unique idempotency keys. Corrections are reversing/adjustment entries, not edits to historical ledger rows.
- Separate customer payment, company cash clearing, driver earnings, driver cash liability, deposits in transit and company settlement accounts.
- Customer gross payment must be confirmed once. Driver share is calculated from the eligible completed-delivery amount under the existing 75% driver / 25% platform rule. Cash receipt itself must not trigger a second driver payout.
- Never use client-side balance decrements, trust a client screenshot as settlement, expose service-role credentials, or allow a driver to confirm their own deposit.
- PayFast ITNs must be signature/provider validated and idempotent; redirects are not proof of payment.
- Admin reconciliation must record who reconciled, when, source statement/reference and any variance.
- Require customer signature and a durable receipt reference for cash acknowledgment. Apply POPIA retention and access controls to signatures and receipt images.

## Required implementation sequence

1. Inspect the existing wallet schema, ledger tables and `create_wallet_funded_booking` / `apply_payfast_payment` database functions before changing any financial code.
2. Add booking payment-state fields and a cash-receipt/receipt-evidence table with RLS and service-role-only mutation.
3. Add a server-side driver cash-receipt endpoint with assignment/status checks, expected amount checks, signature capture metadata, and idempotency.
4. Add driver cash-held and earnings ledger views; keep liability separate from earnings.
5. Add deposit instruction and reconciliation tables, unique references, admin review, and bank-statement reconciliation. Only integrate participating-store deposits after confirming the provider/network contract.
6. Extend customer and driver screens, company admin reconciliation, receipts, statements and notifications.
7. Test duplicate requests, partial payments, amount mismatch, cancelled/failed deliveries, refunds, chargebacks, driver reassignment, offline retries, and concurrent receipts.
8. Do not enable live cash collection or production payments until legal/finance review, bank details, receipt terms, provider setup and migrations/functions have been approved and deployed.

## Existing implementation facts and current limitations

- Customer booking form currently supports dispatch arrangement, cash (short-route rule), and wallet.
- PayFast and card are offered as separate unpaid-booking buttons; both use PayFast hosted checkout and are validated through the PayFast ITN.
- Cash booking is currently only a requested/unconfirmed method. The existing dispatch interface does not yet have the signed driver cash receipt workflow or the company deposit reconciliation ledger described above.
- Optional handling assistance is currently a separately recorded fee request; it is not yet included in PayFast checkout or wallet collection.
- This document is a design checkpoint only. It does not claim that any cash receipt, driver cash wallet, or deposit workflow is implemented.

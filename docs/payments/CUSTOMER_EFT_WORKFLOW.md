# Customer EFT workflow

## Payment selection
Customer checkout supports EFT bank transfer, dispatch-arranged payment, and cash only on eligible routes under 12 km. No card checkout is enabled.

The booking waybill is the unique EFT bank-transfer reference. Customers must obtain verified SwiftHaul bank details from dispatch before making a transfer.

## Proof submission
- Customer uploads a PDF, JPG, or PNG (maximum 8 MB) to the private `customer-eft-proofs` bucket.
- Storage upload paths are scoped to the authenticated customer ID and booking waybill.
- The customer submits the object path and optional bank transfer reference through `submit_customer_eft_proof`.
- The RPC checks the active customer role, booking ownership, payment state, file ownership and allowed booking state.
- Only one submission may be awaiting review for a booking. Rejected submissions may be replaced.
- The booking remains unpaid while proof is submitted or rejected.

## Company Admin verification
- `customer-eft-admin` requires a valid JWT and an active Company Admin profile.
- The queue returns temporary signed proof links (5 minutes), not public file URLs.
- An administrator must match the amount and waybill reference to the company bank statement.
- Verification requires the exact bank statement reference. The database rejects a duplicate verified bank reference.
- Rejection requires a reason and does not mark the booking paid.
- The database RPC locks the payment and booking rows, checks the amount against the booking, prevents duplicate confirmation and records reviewer and timestamp.
- A successful verification sets `paid_at` and `payment_source='eft'`. No proof upload or customer claim can set these fields directly.

## Financial rules
- EFT verification records payment only; it does not change the 75% driver / 25% SwiftHaul delivery split.
- Driver delivery earnings remain governed by the existing completed-delivery ledger.
- Cash, wallet, refunds and driver payout processing remain separate.
- EFT bank transfers are manually verified; there is no bank API integration or automated reconciliation.

## Staging and release
The database migrations and Edge Functions were applied only to the isolated SwiftHaul staging project. Do not apply them to production until the customer upload, admin review, duplicate handling, and financial reconciliation tests pass and a production release is approved.

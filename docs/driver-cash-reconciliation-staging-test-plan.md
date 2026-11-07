# Driver cash collection and reconciliation — staging test plan

Status: prepared for staging; not executed against the linked production project.

## Preconditions

- Use a separate Supabase staging project with the same migrations and Edge Function environment variables.
- Create one active, approved test driver and one active Company Admin test account.
- Create a test customer cash booking, assign it to the driver, and use a known booking amount.
- Configure private Storage buckets from migration `20261108010000_driver_cash_collection_reconciliation.sql`.
- Do not use real customer payments, bank details or production credentials.

## Test cases

| ID | Scenario | Expected result |
|---|---|---|
| CASH-01 | Assigned approved driver records exact cash amount after booking is delivered and customer signature is uploaded | One receipt, one positive cash-clearing ledger event, booking gets `paid_at` and `payment_source='cash'` |
| CASH-02 | Driver attempts receipt before delivery | Rejected; no receipt, ledger event or paid timestamp |
| CASH-03 | Different driver submits a waybill | Rejected; no state changes |
| CASH-04 | Driver submits amount below or above confirmed booking total | Rejected; no state changes |
| CASH-05 | Missing, nonexistent or another driver's signature object | Rejected |
| CASH-06 | Same waybill submitted a second time | Rejected by paid-state/unique-waybill guard; no duplicate ledger credit |
| CASH-07 | Delivered booking has cash receipt | Exactly one 75% driver earning event; 25% platform share remains unchanged |
| CASH-08 | Driver requests payout while cash is outstanding | Payout request rejected |
| CASH-09 | Driver creates EFT deposit instruction for an amount up to cash held | Unique SHD reference; liability unchanged |
| CASH-10 | Driver creates a second open deposit instruction | Rejected |
| CASH-11 | Driver uploads deposit proof | Proof visible to Admin; liability unchanged |
| CASH-12 | Non-admin attempts reconciliation | Rejected |
| CASH-13 | Admin rejects proof with reason | Deposit marked rejected; liability unchanged |
| CASH-14 | Admin reconciles proof with actual bank statement reference | Deposit marked reconciled; negative cash-clearing event offsets the deposit amount |
| CASH-15 | Admin attempts reconciliation above remaining liability | Rejected; no negative balance |
| CASH-16 | Driver requests payout after all cash is reconciled | Normal payout eligibility checks apply |
| CASH-17 | Ordinary driver tries to read another driver's receipts or storage evidence | Denied |
| CASH-18 | Company dispatcher (not admin) attempts cash reconciliation | Denied |
| CASH-19 | PayFast ITN applies payment source `payfast` | Booking payment source constraint accepts the value; PayFast amount/merchant validation still required |
| CASH-20 | Simultaneous receipt creation and payout approval | Per-driver advisory lock ensures payout cannot pass while new cash liability remains |

## Evidence to retain

- Test booking waybill and expected amount.
- Receipt reference and signed customer receipt.
- Cash-clearing ledger before and after deposit.
- SHD deposit reference, proof object path, bank statement reference.
- Driver earning ledger event and payout request status.
- Edge Function logs with secrets and personal information removed.

## Release gate

All cases must pass in staging. Also verify Storage signed URLs expire, admin-only evidence access works, and no user can list other drivers' evidence. SQL migration execution and RLS behavior are not covered by GitHub JavaScript/Deno CI alone.

No migration, Edge Function, APK, Pages site or production service should be deployed until staging passes and the owner approves the release.

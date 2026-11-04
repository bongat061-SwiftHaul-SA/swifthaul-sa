# Premium driver membership and rewards

## Membership and checkout
- Monthly membership: R250.
- Annual membership: R1,800 prepaid for 12 months; automatic renewal is off.
- Driver UI offers both plans. Only active, approved drivers can start checkout.
- Checkout uses PayFast sandbox and creates a pending membership. The PayFast ITN verifies source, signature, merchant and provider validation before calling the database activation RPC.
- Membership activation is idempotent and records subscription revenue separately. Browser return/cancel is not payment proof.
- No active member is charged again by the checkout flow; a second active membership is blocked.

## Premium delivery priority
Priority dispatch must mean early offer visibility for suitable available drivers, with vehicle fit, distance, capacity, response timeout and fair rotation preserved. Do not guarantee a job or prevent dispatchers from assigning the best operational match. The UI describes this accurately. The actual ranked offer queue still requires implementation.

## Fuel rebate and milestone
- R15 per completed delivery while premium is active at completion, capped at R450 per South African calendar month.
- Fuel rebate is limited to the remaining 25% platform share on a small order so Swift Haul's share never becomes negative.
- At 10 delivered orders in the current SA calendar month, award R500 once per driver/month if the accumulated subscription revenue pool (net of recorded milestone awards) can fund it.
- Reward ledger entries are unique/idempotent and separate from the 75% base earnings ledger.
- Payout availability combines earnings and rewards. Payout reservation is applied to the combined wallet balance.

## Availability bonuses
Availability bonus entries have a dedicated reward-ledger event type but no amount or qualification schedule has been configured. Admin must define a funded time window and award amount before automated availability bonuses are issued.

## Micro-loans
- UI reports 45-day tenure, 15 completed delivery thresholds, 25% of 14-day earnings formula and R1,500 cap.
- Request button remains disabled; no application or disbursement endpoint is enabled.
- This is deliberate pending South African National Credit Act / NCR, affordability, disclosures and consumer-protection review.

## Deployment
Driver UI files: `apps/driver/public/index.html`, `apps/driver/public/premium.js`.
Functions: `driver-membership-checkout` (JWT required), `driver-premium` (JWT required), `payfast-itn` v4 (provider webhook, JWT disabled and independently validates), `driver-payouts` v3 (combined rewards and earnings balance).
PayFast sandbox only. No production release, live payment or live driver payout is implied.

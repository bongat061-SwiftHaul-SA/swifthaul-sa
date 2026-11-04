# South African driver earnings and payouts

## Scope

The first payout backend is deployed in sandbox/development only. It uses ZAR cents (R100.00 = 10000 cents) and separates driver earnings from customer PayFast collections.

## Driver payout flow

- Only active, approved drivers can request payouts.
- Minimum payout request is R10.00.
- Drivers submit their own beneficiary bank name, account holder, account number, account type and optional six-digit branch code.
- The payout request immediately reserves the requested balance in the immutable-style earnings ledger, preventing a second request from spending the same earnings.
- Only one pending or approved payout request per driver is allowed at a time.
- An administrator can approve or reject. Rejection releases the reservation back to the driver's available balance.
- After an actual EFT has been made, an administrator records the bank's real payment reference. Only then is the payout marked paid.
- Account numbers are never returned by the API; administrators receive only the last four digits. Driver bank details are stored server-side and are not directly readable through the Data API.

## Important current limitations

- No bank transfer is initiated automatically. This release is a controlled manual EFT workflow, not a bank API integration.
- No bank name, account holder, branch code, or verified company banking credentials were supplied for a company payout rail. The previously supplied Startup Bundle account details have not been inserted as a driver beneficiary or exposed in the application.
- Driver earnings are automatically credited when a booking transitions to `delivered` with an assigned driver and a positive recorded delivery charge. The initial rule is 75% of the final booking `price` (in ZAR); SwiftHaul retains the remaining 25% before other operating costs.
- The ledger credit is calculated in cents, tied to the waybill, and idempotent: the unique event key prevents duplicate earnings if a completion update is retried. Failed, cancelled, unassigned, or zero-priced bookings do not generate earnings.
- Vehicle-specific earning rates are deliberately deferred until operating costs have been measured. The 75% rule currently applies equally across vehicle types.
- Bank-account ownership verification and proof-of-account checks are not integrated.
- No live transfers or payouts have been made.

## Security

Both payout tables have RLS enabled and no direct anon/authenticated grants. All access goes through the JWT-authenticated `driver-payouts` Edge Function. Database payout RPCs are SECURITY INVOKER and service-role-only. The review RPC independently checks that the reviewer is an active admin. Payout account numbers are masked in administrator list responses.

## Verification

- Database tables, payout reservation/release/paid ledger operations and indexes applied.
- `driver-payouts` Edge Function deployed with JWT verification enabled.
- No payout requests or driver earnings exist in the project at verification time.
- This is not enabled on the production Netlify site or main branch.

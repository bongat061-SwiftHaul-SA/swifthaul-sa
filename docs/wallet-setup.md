# Customer wallet migration

The customer wallet now reads from Supabase through the authenticated `wallet-operations` Edge Function. The function verifies the Supabase access token, requires an active customer account, checks for a pending profile deletion, and uses the server-side service role only after those checks.

## Current status

- Wallet accounts are initialized on first access with a unique referral code.
- Refund and promotional balances, promotional debt, the latest 100 ledger entries, pay-later loans, withdrawal history and completed-delivery eligibility are displayed.
- Wallet tables remain protected by row-level security; the browser does not read wallet tables directly.
- Existing wallet actions are intentionally disabled during migration. PayFast loan repayment, wallet-funded booking payments, withdrawals, refunds and profile banking workflows must be migrated and verified before being re-enabled.
- The wallet migration uses the authenticated Supabase user UUID as `owner_hash`. Legacy Netlify wallet records are not imported or rewritten. No production customer records were copied.

## Verification

The `wallet-operations` Edge Function is deployed with JWT verification enabled. The customer wallet JavaScript parses successfully and calls the function instead of the legacy `/api/wallet` Netlify endpoint. No authenticated end-to-end wallet session has been tested yet because no test customer account/session was provisioned.

## Remaining work

1. Add PayFast ITN support for pay-later repayment and apply repayment atomically to the loan and booking.
2. Migrate wallet-funded booking payments and refund ledger operations with idempotent database transactions.
3. Select and configure a supported South African payout provider before enabling withdrawals. PayFast hosted checkout is not itself a bank-transfer/payout API.
4. Complete profile/banking settings migration and add admin refund controls.
5. Run sandbox payment and failure/reversal tests before enabling any wallet action.

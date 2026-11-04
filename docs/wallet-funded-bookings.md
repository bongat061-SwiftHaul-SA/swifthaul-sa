# Wallet-funded delivery bookings

## Customer flow

Customers with sufficient eligible wallet credit can select **Pay with wallet balance** at booking checkout. The customer portal reports the signed-in customer's own balance only:
- Refund credits are spendable first.
- Promotional credits are spendable only after subtracting outstanding promotional debt.
- If the eligible total is less than the current quote, the wallet option is disabled.
- Wallet bookings cannot include a counteroffer because a counteroffer changes the amount due after company review.

## Atomic settlement

The customer portal Edge Function verifies the Supabase session, active customer role, quote ownership/expiry, recipient, route, timing and location pins. It then calls `public.create_wallet_funded_booking` using its server-side service-role client.

The database function uses SECURITY INVOKER and is executable only by `service_role`. Within one database transaction it:
1. Locks the customer's quote and wallet account.
2. Checks the quote is still valid and unused.
3. Computes the booking price in cents from the saved quote, not the browser.
4. Deducts refund credit first, then eligible promotional credit.
5. Inserts a paid booking with `payment_source='wallet'` and records the exact split in `wallet_refund_used` and `wallet_promo_used`.
6. Writes one unique wallet-ledger event with negative balance deltas.

The balance deduction, booking insertion, and ledger event commit or roll back together. Concurrent requests serialize on the wallet row. The quote's unique booking constraint and existing-booking check prevent double deduction for retries.

## Current deployment

- Database function deployed.
- Customer portal Edge Function deployed as version 3 with JWT verification enabled.
- Customer page has the wallet payment option and shows the exact refund/promotional split on paid wallet bookings.
- No wallet account, customer booking, or wallet ledger rows existed in the Supabase project at verification time, so no live customer balance was changed.
- No end-to-end wallet purchase could be run without an authenticated test customer, wallet credits, a fresh quote, and GitHub Pages enabled.

## Important limitations

- This only spends existing refund/promotional wallet balances. It does not enable wallet top-ups, loan credit, PayFast wallet top-ups, refunds, or withdrawals.
- The database transaction does not create an external payment. It only settles a booking against already-available internal wallet credits.
- Customer counteroffers are disabled for wallet-funded bookings.
- PayFast sandbox booking payments and pay-later loan repayments remain separate flows.
- Production Netlify and the main Git branch remain unchanged.

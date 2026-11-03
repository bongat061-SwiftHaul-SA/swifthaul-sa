# PayFast sandbox checkout

## What is implemented

SwiftHaul customer bookings can be paid using PayFast's hosted sandbox checkout. The integration is deliberately sandbox-only:

- Checkout POST target: `https://sandbox.payfast.co.za/eng/process`
- ITN validation target: `https://sandbox.payfast.co.za/eng/query/validate`
- Supabase functions: `payfast-checkout` (JWT required) and `payfast-itn` (public webhook, independently validates source IP, signature, merchant, PayFast validation response and amount)
- Database ledger: `public.payment_transactions`
- A booking is marked paid only after a valid `COMPLETE` ITN is verified and atomically applied by `public.apply_payfast_payment`.
- Returning from the PayFast page is not proof of payment.
- One pending payment attempt is allowed per booking. Failed/cancelled attempts can be retried.
- Minimum booking amount is R5.00. Wallet top-ups, wallet repayments and withdrawals are not part of this booking checkout integration yet.

## Official test credentials

PayFast publishes these shared sandbox test values in its developer documentation:

| Setting | Sandbox value |
|---|---|
| Merchant ID | `10000100` |
| Merchant Key | `46f0cd694581a` |
| Passphrase | `jt7NOE43FZPn` |
| Sandbox buyer username | `sbtu01@payfast.io` |
| Sandbox buyer password | `clientpass` |

These are public test credentials, not live merchant credentials. The Edge Functions use them only as sandbox defaults. If you create your own sandbox merchant account, override them in Supabase Dashboard → Edge Functions → Secrets:

- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`

Never put a live credential in this project branch, browser JavaScript, or GitHub. Do not switch the function to the live PayFast host without a separate reviewed production migration.

## Sandbox account and test flow

1. Open [PayFast Sandbox](https://sandbox.payfast.co.za/) and create/sign in to a sandbox account if you want account-specific credentials.
2. In the customer app, create a booking with a fare of at least R5.
3. Choose **Pay securely with PayFast (Sandbox)** on the booking.
4. PayFast's sandbox provides a dummy wallet for once-off payments. Use the documented sandbox buyer details above if prompted.
5. PayFast sends its ITN to `https://jikstpnvsdjhcibtjilp.supabase.co/functions/v1/payfast-itn`.
6. Check the booking after returning to the customer app. It is only marked paid after ITN verification succeeds.

PayFast sandbox does not connect to live banking/payment rails. Its available once-off test payment method is the sandbox wallet.

## Supabase Auth redirect configuration

Add this customer callback to Supabase Dashboard → Authentication → URL Configuration:

`https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/customer.html`

Keep the driver and company redirect URLs already configured. The customer return/cancel URL uses the same GitHub Pages customer path and query parameters `payment=return` or `payment=cancel`.

## Security and verification notes

- The browser receives a short-lived form payload for the hosted sandbox, but never receives the PayFast passphrase or Supabase service-role key.
- The ITN handler checks PayFast's documented source IP ranges, the custom payment signature, merchant ID, PayFast's server-to-server `VALID` response, payment reference and gross amount.
- The database function locks the payment row and updates the payment ledger and booking in one transaction.
- The current integration is test-only. No live PayFast endpoint or live credential is configured.

## Outstanding payment work

The existing wallet UI still references the legacy Paystack service. PayFast is currently connected to delivery booking payments only. Wallet top-ups, pay-later repayments, refunds and withdrawals need their own migration and reconciliation design before being enabled.

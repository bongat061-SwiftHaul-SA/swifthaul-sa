# Yoco Checkout Integration and Merchant Onboarding

Status: server-side integration draft committed for review. It is not deployed, configured with merchant secrets, sandbox-tested end to end, or enabled in the customer interface. No production payment routing is changed.

## Decision

Prepare Yoco Checkout API as the South African hosted-card provider while Paystack approval remains pending. Keep EFT and eligible cash available throughout onboarding. PayFast remains a backup only after its credentials and operation are independently verified.

Yoco hosts the secure payment page; SwiftHaul must never receive or store card details. Yoco's official flow is server-created checkout, customer redirect to the hosted page, and signed webhook confirmation. A success redirect is not proof of payment.

## Merchant onboarding checklist

1. Complete the SwiftHaul SA business profile and payout verification in the Yoco App / Business Portal.
2. Open Sales → e-Commerce integrations → Checkout API → How to connect.
3. Copy the Test secret key privately (starts with `sk_test_`). Never put it in GitHub, source code, issue comments, screenshots, or chat.
4. Add the customer website domain to Verified Domains and submit it for review. Yoco says live keys unlock after domain approval.
5. Configure test secrets privately in Supabase Edge Function Secrets.
6. Register the Yoco Checkout API webhook using the Yoco API and save the one-time `whsec_` signing secret privately.
7. Run sandbox tests and verify the resulting transactions in Yoco and SwiftHaul.
8. Only after domain approval and explicit SwiftHaul production approval may live credentials be configured and production payment activation considered.

Official references:
- Yoco Checkout API onboarding: https://support.yoco.help/en/articles/739322-yoco-checkout-api
- Accepting a payment: https://developer.yoco.com/guides/online-payments/accepting-a-payment
- Create checkout API: https://developer.yoco.com/api-reference/checkout-api/checkout/create-checkout
- Listen for webhook events: https://developer.yoco.com/guides/online-payments/webhooks/listen-for-events
- Verify webhook events: https://developer.yoco.com/guides/online-payments/webhooks/verifying-the-events
- Payment notification payload: https://developer.yoco.com/api-reference/checkout-api/webhook-events/payment-notification

## Supabase secrets

Set these only in Supabase Dashboard → Edge Functions → Secrets. Do not send secrets in chat.

- `YOCO_SECRET_KEY`: test key during development; live key only after domain approval and explicit production approval.
- `YOCO_MODE`: `test` or `live`; must match the key prefix.
- `YOCO_WEBHOOK_SECRET`: one-time webhook signing secret returned by Yoco.
- `YOCO_CALLBACK_URL`: HTTPS customer return URL. The return URL is informational only and never settles a booking.

Never put a Yoco secret in public/customer.js, HTML, Android assets, GitHub Actions logs, or a public repository.

## Implementation currently committed in this draft

- `supabase/functions/yoco-checkout/index.ts`
  - Requires a valid Supabase bearer session and active customer profile.
  - Resolves the booking by waybill and authenticated owner.
  - Calculates the amount from the server-side booking and accepted assistance fee.
  - Rejects paid, refunded, ineligible bookings and amounts below Yoco's documented R2 minimum.
  - Creates a pending Yoco transaction, then creates a hosted checkout using integer cents, ZAR, and an idempotency key.
  - Validates the returned amount, currency, processing mode and HTTPS Yoco redirect host before returning the redirect URL.
  - Fails closed when secrets are missing or key/mode do not match.

- `supabase/functions/yoco-webhook/index.ts`
  - Public webhook endpoint; JWT verification is disabled only for this route in Supabase config.
  - Verifies the raw body using Yoco's documented `webhook-id.webhook-timestamp.body` HMAC-SHA256 signature format.
  - Enforces Yoco's recommended three-minute timestamp window and constant-time signature comparison.
  - Processes only `payment.succeeded`; checks the signed event's checkout ID, ZAR amount and configured test/live mode.

- `supabase/migrations/20261108060000_yoco_checkout_support.sql`
  - Adds Yoco to the provider and booking payment-source allow-lists.
  - Adds a unique provider checkout ID and a service-role-only atomic booking settlement function.
  - Does not alter existing payment rows or switch the default payment method.

The customer card button remains disabled/Coming soon. The migration is committed only to this development branch and has NOT been applied to production. The functions have NOT been deployed. No merchant secrets have been configured. This draft does not yet include customer UI activation or Company Admin reconciliation screens.

## Required validation before any activation

- [ ] Yoco merchant profile and payout details approved.
- [ ] Test key and webhook secret configured privately in a non-production test environment.
- [ ] Function compilation and static checks pass.
- [ ] Successful, failed, cancelled, duplicate, invalid-signature, stale-timestamp, wrong-amount, wrong-currency, wrong-mode and wrong-owner cases pass.
- [ ] Yoco dashboard and SwiftHaul transaction records reconcile.
- [ ] Customer UI and Company Admin reconciliation are implemented and tested.
- [ ] Production customer domain approved by Yoco.
- [ ] Live key and webhook secret configured privately.
- [ ] Explicit SwiftHaul owner approval to merge, deploy and activate live payments.

Until all gates are satisfied, the card option stays disabled and EFT/cash remain the available customer payment arrangements. No live card payment is accepted and no production payment routing is changed.

# Yoco Checkout Integration and Merchant Onboarding

Status: preparation only. This document does not enable card payments, create a Yoco merchant account, or change production payment routing.

## Decision

Prepare Yoco Checkout API as the next South African hosted-card provider for SwiftHaul SA. Keep existing Paystack work intact as a future/alternate provider. Keep EFT and cash available throughout onboarding.

Yoco's official Checkout API uses a server-created hosted checkout session, redirects the customer to Yoco's hosted payment page, and confirms the result through status verification and/or webhooks. Card details must never pass through SwiftHaul browser code or Supabase tables.

## Merchant onboarding checklist

1. Create or sign in to the SwiftHaul SA business profile in the Yoco App / Business Portal.
2. Complete Yoco's business and payout verification (including requested company, owner, FICA and bank-account information).
3. Open Sales / e-Commerce integrations / Checkout API / How to connect.
4. Copy the Test secret key (starts with `sk_test_`) privately. Never put it in GitHub, source code, issue comments, screenshots, or this document.
5. Add the exact production customer website domain to Verified Domains and submit it for review. Yoco states live keys remain locked until at least one domain is approved.
6. While domain review is pending, configure test credentials in Supabase Edge Function Secrets and complete sandbox tests.
7. After domain approval, retrieve the Live secret key privately, configure it in Supabase secrets, and only activate after explicit SwiftHaul production approval.
8. Register the Checkout API webhook from the server-side integration and store the one-time webhook signing secret in Supabase secrets.

Official references:
- Checkout API overview: https://developer.yoco.com/docs/checkout-api
- Authentication and domain verification: https://developer.yoco.com/docs/checkout-api/authentication
- Testing and going live: https://developer.yoco.com/docs/checkout-api/testing
- Yoco onboarding guide: https://support.yoco.help/en/articles/739322-yoco-checkout-api

## Planned Supabase secrets

Use Supabase Dashboard → Edge Functions → Secrets. Do not send secrets in chat.

- `YOCO_SECRET_KEY`: test key during development; live key only after Yoco domain approval and explicit production approval.
- `YOCO_MODE`: `test` or `live`.
- `YOCO_WEBHOOK_SECRET`: one-time webhook signing secret returned by Yoco when the webhook is registered.
- `YOCO_CALLBACK_URL`: HTTPS customer return URL on the production customer website.

Never store a Yoco secret key in public/customer.js, HTML, Android assets, GitHub Actions logs, or a public repository. Never ask a customer to enter card details into SwiftHaul forms.

## Planned implementation

1. Add an authenticated `yoco-checkout` Supabase Edge Function.
   - Validate the Supabase customer session and active customer profile.
   - Resolve booking by waybill and authenticated owner.
   - Calculate the payable amount from the server-side booking and accepted assistance fee only.
   - Require an unpaid, unrefunded, eligible booking.
   - Create a pending `payment_transactions` row with provider `yoco`, currency `ZAR`, explicit sandbox/live mode, and unique provider reference.
   - Create the hosted checkout session from the Supabase server using the Yoco secret key.
   - Return only the hosted redirect URL and internal reference to the customer app.
   - Fail closed if credentials are missing or key prefix does not match mode.

2. Add a public `yoco-webhook` Edge Function with JWT verification disabled only for the webhook route.
   - Verify the exact raw request body using Yoco's documented webhook signature scheme and the stored webhook secret.
   - Enforce timestamp/replay protection.
   - Independently retrieve/verify checkout status with Yoco before settlement.
   - Check processing mode, currency, exact amount, reference, and transaction ownership.
   - Settle atomically through a service-role-only database RPC; reject duplicate or mismatched events.
   - Never trust the browser return URL as proof of payment.

3. Extend the payment provider enum/check constraints and settlement RPC for Yoco without changing existing Paystack, PayFast, EFT, or cash records.
4. Add a provider-neutral customer checkout UI. Show a card option only when a provider is configured and explicitly enabled; otherwise keep the existing disabled/coming-soon state. EFT and cash choices remain available under existing eligibility rules.
5. Add admin reconciliation visibility for provider, provider reference, amount, mode, status, and webhook settlement time. Do not let admin mark an online transaction paid solely from a customer screenshot.
6. Add tests for successful payment, failed/cancelled checkout, duplicate webhook, invalid signature, stale timestamp, wrong amount/currency/mode, wrong booking owner, refunded/completed booking, and provider API outage.

## Manual payment-link fallback during onboarding

If Yoco enables Payment Links before API credentials/domain verification are complete, an authorised admin may create a Yoco payment link from the Yoco App and send it to the customer. The link should include the exact SwiftHaul waybill as its reference and the correct server-calculated ZAR amount where supported.

A customer screenshot or redirect is not proof of payment. Admin must reconcile the payment against Yoco's Sales History / transaction record before changing the booking's payment state. Keep EFT and cash as separate payment methods.

## Release gates

- [ ] Yoco merchant profile and payout details approved.
- [ ] Test key configured privately in Supabase.
- [ ] Checkout and webhook functions implemented and reviewed.
- [ ] Sandbox tests pass, including negative and duplicate cases.
- [ ] Production customer domain approved by Yoco.
- [ ] Live key and webhook secret configured privately.
- [ ] Admin reconciliation tested.
- [ ] Explicit SwiftHaul owner approval to merge/deploy and activate live payments.

Until all gates are satisfied, no live card payment is accepted and no production payment routing is changed.

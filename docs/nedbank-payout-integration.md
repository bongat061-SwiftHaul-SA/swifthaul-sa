# Nedbank payout integration

## Intended payout destination

The business has supplied a Nedbank account as its intended settlement destination. Its account number is deliberately **not stored in this repository, browser code, migration files, or public documentation**. The supplied “Startup Bundle” wording identifies the banking package, not necessarily the bank's technical account subtype. Before any payout configuration is activated, an administrator must verify the account-holder/beneficiary name, account number, account subtype, branch/routing details (if required), and ownership using Nedbank's official channels.

## Recommended provider

Use the **Nedbank Payments API** as the preferred direct-bank payout integration, subject to Nedbank approving SwiftHaul's API application and payment permissions. Nedbank's API Marketplace documents a Payments API for sending and receiving money and tracking payment status. The API Marketplace requires subscription to the Nedbank Authorisation API; the app must also be subscribed to the Payments API and use OAuth 2.0 credentials.

Official resources:
- [Nedbank API Marketplace](https://apim.nedbank.co.za/)
- [Nedbank Payments API overview](https://apim.nedbank.co.za/static/payment)
- [Nedbank API getting started](https://apim.nedbank.co.za/static/docs/start)
- [Nedbank Payments API setup guide](https://apim.nedbank.co.za/static/docs/payments-postman)
- [Nedbank Corporate Payments System](https://www.nedbank.co.za/content/dam/nedbank/site-assets/Business/Brochure/Corporate%20Payment%20Systems.pdf)

The Nedbank PayShap API may also be evaluated for real-time beneficiary payouts if Nedbank enables it for this business and use case. Do not assume personal PayShap app functionality grants API access.

## Required onboarding before automated transfers

1. Register SwiftHaul on the Nedbank API Marketplace.
2. Create a SwiftHaul application and a registered HTTPS redirect URI.
3. Subscribe to the Authorisation API and Payments API; obtain written confirmation of the applicable payment scopes, beneficiary rules, limits, fees, settlement times, and sandbox/live availability.
4. Obtain separate sandbox and production client credentials from Nedbank.
5. Verify the business settlement account and beneficiary ownership through Nedbank. The banking package name alone is not sufficient to identify the account subtype.
6. Complete sandbox tests for beneficiary validation, payment submission, duplicate/idempotent requests, rejected payments, timeouts, status enquiries, and reconciliation.
7. Obtain business approval before adding production credentials or enabling live payouts.

## SwiftHaul payout controls

The wallet withdrawal workflow must remain disabled until the following controls are implemented and tested:

- Reserve the customer's eligible refund balance atomically when a withdrawal is accepted; never let concurrent requests spend the same balance.
- Use a unique idempotency/reference key for each payout instruction.
- Require an authorized administrator to approve the payout amount and beneficiary before submission.
- Validate the beneficiary and account ownership where Nedbank's Account Verification Services are available.
- Submit payment instructions only from a server-side Supabase Edge Function. Never put bank API credentials or settlement account details in browser JavaScript.
- Store only a masked beneficiary display in customer-facing history.
- Treat network timeouts and unknown bank responses as `pending_reconciliation`; do not release the reserved balance or automatically resubmit until Nedbank status is checked.
- Mark a payout `paid` only after a verified bank status or reconciled statement confirms settlement. Record the bank reference and timestamps.
- Keep a complete immutable audit trail for approvals, requests, status changes, reversals, and reconciliation.
- Refund/release a reservation only after a definitive rejected/cancelled bank result.

## Safe interim operation

Until Nedbank API access is approved, the supported fallback is **manual bank EFT by an authorized administrator** using Nedbank Business Banking, followed by recording the bank's confirmed payment reference and evidence in the private admin workflow. The app must not claim an automatic transfer occurred, and a submitted withdrawal request must remain pending until an administrator reconciles it.

## Current status

- Nedbank is the proposed payout bank.
- The supplied business account number is not committed to GitHub or exposed to the client.
- No Nedbank API application, OAuth credentials, payment permission, or sandbox access has been supplied or verified.
- No automated payout has been submitted.
- PayFast remains sandbox-only and is currently used for customer booking checkout, not bank payouts.

# Booking cancellations and refunds

## Customer requests

The signed-in customer can request cancellation for bookings in `pending`, `assigned`, or `accepted` states. Cancellation immediately changes the booking to `cancelled` and creates a pending admin review record. The customer can request a refund for a booking in `failed` or `cancelled` state. Requests are tied to the authenticated Supabase user and the booking owner hash.

A booking can have only one open request. Refund amounts are calculated server-side:
- Unpaid bookings: no refund amount.
- Wallet-paid bookings: the original refund-credit and promotional-credit split is restored exactly.
- PayFast-paid bookings: the amount is recorded for a manual external provider refund.

## Administrator workflow

The company workspace now includes a **Cancellations & refunds** panel. Only active users with the `admin` role can access the refund-admin Edge Function and approve or reject requests.

- Approving an unpaid cancellation closes the request without a monetary refund.
- Approving a wallet-paid cancellation/refund atomically restores the original refund and promotional wallet credits and writes a unique wallet-ledger event.
- Approving a PayFast/external-provider refund moves it to `provider_pending`. An administrator must complete the refund in the actual payment provider dashboard, then enter the real provider refund reference to mark it complete.
- Rejecting a pending request records the administrator and review timestamp.

The database review function independently checks that the reviewer is an active administrator. Both database functions are SECURITY INVOKER and executable only by `service_role`. The refund request table has RLS enabled and no direct anonymous/authenticated grants or policies; the Edge Functions perform the ownership and role checks.

## PayFast limitation

This release does **not** call a PayFast refund API and does not transfer money to a bank account. The PayFast sandbox integration currently supports checkout and verified payment notifications, not automated refunds. An administrator must perform any external refund through the provider's supported merchant process before recording its reference in Swift Haul. A browser return or an admin click alone is not proof that money was refunded.

## Verification status

- Refund request table, indexes, and RPC functions applied to Supabase.
- `customer-portal` deployed as v5 with JWT verification.
- `refund-admin` deployed as v1 with JWT verification.
- Customer cancellation/refund controls and company admin review panel committed to the migration branch.
- Database functions are SECURITY INVOKER and service-role-only.
- No end-to-end request or refund was processed: the Supabase project had no test bookings, wallet accounts, or refund requests at verification time.
- Production Netlify and the `main` branch remain unchanged.

# Customer wallet connections

The wallet ledger, delivery completion, rewards and loans use the Customer site's Netlify Database. The Driver and Company sites keep their own Identity accounts and forward authenticated operations through their own Netlify Functions. They do not share browser sessions or access the database directly.

## Connect the sites

Set `CUSTOMER_API_ORIGIN` on the Driver and Company sites to the Customer site's HTTPS origin. On the Customer site, set `DRIVER_SITE_ORIGIN` and `COMPANY_SITE_ORIGIN` to the respective HTTPS origins. Use an origin only, without a path. The Customer backend verifies the forwarded Identity token against that exact configured site's Identity user endpoint; it does not trust browser-supplied roles or identities.

Approved Driver Identity accounts need the `driver` role on the Driver site. Company accounts need the `admin` role on the Company site. Assign roles in the corresponding site's Identity dashboard. A driver sees their account ID in the Driver account panel; Company uses that ID to assign a booking. The driver enters the recipient PIN on delivery and records eligible cash receipt. Neither operations API exposes the PIN.

## Connect Paystack

Use a South African Paystack account enabled for ZAR collections and bank transfers. Configure `PAYSTACK_SECRET_KEY` securely in the Customer site's Netlify environment settings; never place its value in source code or chat. Use Paystack test credentials for preview/testing and live credentials only for production.

Set the Paystack webhook URL to the Customer origin followed by `/api/paystack-webhook`. Enable charge-success and transfer-success/failure/reversal notifications. Configure automatic transfers in Paystack; accounts requiring manual transfer OTP approval cannot provide unattended payouts. The integration uses South African `basa` transfer recipients and the provider's ZAR bank list.

Online checkout, borrowing and withdrawals remain unavailable when the provider is not configured. The wallet can still show its balances and activity. Card checkouts redirect to Paystack; only server-side verification marks them paid. An open checkout reserves that booking's payment method until reconciliation, preventing a second wallet, cash or loan payment racing the card checkout.

A scheduled Netlify Function reconciles provider transactions and submits due payouts every five minutes in production. Instant requests are eligible immediately; standard requests are submitted the next business day. Transfer timing is an estimate, not a guaranteed bank settlement time. Failed or reversed payouts restore the reserved gross amount once. Uncertain outcomes retain the reservation and are retried with the same unique provider reference.

Refunds issued in Company return the paid fare to the customer wallet, rather than also refunding the card. Avoid separately refunding the same charge in the provider dashboard: that would be a different financial operation outside this wallet workflow.

## Verify

Run `node --test tests/*.mts tests/wallet.integration.mjs`. Integration checks use an isolated PostgreSQL-compatible test database and mocked Identity/Paystack responses; they do not send real payments, transfers or account requests. Live provider behavior and the cross-site connections require the configuration above.

# Customer portal Supabase migration

This migration is staged on `migration/supabase-github-pages`. It does not change `main`, the live Netlify deployment, or migrate production records.

## Implemented in this stage

- Customer sign-up, sign-in, password recovery and session validation now use Supabase Auth in `public/auth.js`.
- The browser uses the public Supabase publishable key from `public/supabase-config.js`. No service-role key is shipped to the browser.
- Authenticated customer quote creation and booking listing/creation use the `customer-portal` Edge Function.
- The function requires a valid Supabase JWT, checks that the account is an active customer, and uses a server-side service role for database operations.
- Quote calculation preserves the current South African pricing rules, mapped route calculation, exact map pins, Plus Codes and Geohashes.
- New Supabase customer records use the Auth UUID as `owner_hash`. Existing Netlify customer hashes are not rewritten or guessed.

## Required Supabase Auth URL configuration

In Supabase Dashboard → Authentication → URL Configuration, add the exact customer callback URLs used by the app:

- `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/customer.html`
- `https://swifthaul-sa.netlify.app/customer.html`

Keep the existing driver and company redirect URLs. The GitHub Pages project root remains:
`https://bongat061-swifthaul-sa.github.io/swifthaul-sa/`

## Not yet migrated

- Customer wallet, referral credits, pay-later, withdrawals and Paystack checkout/webhooks still depend on the legacy Netlify endpoints.
- Customer profile settings, photo storage and account deletion still depend on Netlify Identity/Netlify services.
- Legacy browser-booking import is not connected to the new customer identity.
- Existing Netlify customer accounts and booking ownership hashes have not been imported or linked to Supabase Auth.
- No Paystack secrets have been added to Supabase.
- No production cutover has occurred.

Until these remaining services are migrated and end-to-end tested, treat this as a staged customer booking migration, not a complete production replacement. Do not merge this branch into `main` or switch the live customer site yet.

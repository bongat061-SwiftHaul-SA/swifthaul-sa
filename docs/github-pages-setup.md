# GitHub Pages migration preview

The migration branch contains the driver and company apps under:

- `apps/driver/public/`
- `apps/company/public/`

The root `index.html` links to both apps and to the existing customer production website. The customer website remains on Netlify and is not switched by this preview.

## Enable GitHub Pages

In the GitHub repository:

1. Open **Settings → Pages**.
2. Under **Build and deployment**, choose **Deploy from a branch**.
3. Select branch `migration/supabase-github-pages`.
4. Select folder `/(root)`, then save.

GitHub Pages will publish commits from that branch automatically. Expected landing URL:

`https://bongat061-swifthaul-sa.github.io/swifthaul-sa/`

The driver and company portals will be available at:

- `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/driver/public/`
- `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/company/public/`

## Configure Supabase Auth redirects

In the Supabase project, open **Authentication → URL Configuration**.

Set the Site URL to:

`https://bongat061-swifthaul-sa.github.io/swifthaul-sa/`

Add these additional redirect URLs:

`https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/driver/public/**`

`https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/company/public/**`

These allow email confirmation and password recovery to return to the correct app.

## First company administrator

Company registration is intentionally disabled. A trusted administrator must be provisioned by changing an existing, verified Supabase Auth user's profile role to `admin`. Do not expose a public admin signup or store a service-role key in the browser.

## Current migration limits

This is a driver/company preview, not a production cutover. No Netlify production data has been copied. Customer booking, wallet, Paystack, refund, counter-offer and earnings flows still need their Supabase backend migration and testing before the customer site can move.

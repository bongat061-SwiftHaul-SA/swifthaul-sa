# SwiftHaul SA platform publication and financial dashboard

## GitHub Pages browser-test addresses

This repository publishes three separate platform entry points from one GitHub Pages project:

- Platform directory: `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/`
- Customer website: `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/customer.html`
- Driver app: `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/driver/public/`
- Company/Admin app: `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/company/public/`

They share one repository and deployment but have independent page entry points and platform-specific assets. They are not three separately registered GitHub Pages sites or custom domains.

## Enable GitHub Pages

1. Open repository Settings → Pages.
2. Under Build and deployment, select **GitHub Actions** as the source.
3. The workflow `.github/workflows/pages.yml` deploys the repository root whenever the `migration/supabase-github-pages` branch changes, and can also be started manually from Actions.
4. Wait for the Pages workflow to complete successfully. GitHub may require Pages to be enabled once before the first deployment.

The workflow verifies that all three platform entry files exist before publishing. It does not deploy Netlify and does not merge this branch into `main`.

## Administrator financial dashboard

The Company app includes a Financial dashboard panel. It invokes the `admin-financials` Supabase Edge Function. The function validates the caller's Supabase JWT and independently checks that `user_profiles.role = admin` and `account_status = active`. It does not expose service credentials or permit direct browser reads of financial tables.

The summary reports customer payment receipts and recorded cash refunds, completed booking charges, the 75/25 delivery split, verified Premium membership payments, reward ledger awards, payout request states, and current micro-loan balances.

### Accounting caveats

- Booking charges and PayFast receipts are deliberately displayed separately and are never added together.
- Customer payment receipts use completed payment transaction rows; refunds use completed/refunded records, excluding wallet-only refunds and pending external refund requests.
- Membership revenue is inferred from membership records with a provider payment ID and a paid lifecycle status. Membership chargebacks/refunds are not yet reconciled.
- Driver liability is an operational estimate from positive delivery and reward credits less paid payout requests. Pending and approved requests are shown separately.
- A dedicated driver-loan repayment ledger is not yet available; the loan panel shows recorded loan principal and current outstanding balances only.
- Figures are operational estimates, not audited financial statements. No test payments, refunds, rewards, loans or payouts have been processed.

## Security and release status

The financial endpoint requires an active administrator account. No administrator account has yet been provisioned, so the dashboard will correctly deny access until one is securely created and assigned the admin role.

This is a migration/testing publication branch. The Netlify production customer website and repository `main` branch remain unchanged.

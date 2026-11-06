# Google and Apple sign-in setup

This change adds Supabase OAuth entry points to the Customer, Driver and Company web apps. It does not enable providers or publish the change by itself.

## Platform behaviour

- **Customer:** Google/Apple can sign in existing customer accounts or create a customer account. During social registration, the customer supplies their name and accepts the current terms. Referral-code attribution remains on the email/password registration path.
- **Driver:** existing driver accounts can sign in with a linked Google/Apple identity. New social registrations collect the same required phone, licence and vehicle details as the regular Driver application. The `social-onboard` Edge Function creates a pending driver profile and sets the role to `driver`; it cannot grant admin or dispatcher roles.
- **Company:** Google/Apple are sign-in options only. Company access remains invitation-only and the existing `account-me` role check must return `admin` or `dispatcher`. An OAuth identity by itself never grants Company access.
- Email/password sign-in and password recovery remain available.

Driver social registration temporarily keeps the completed application fields in the current browser tab's `sessionStorage` during the provider redirect. The app removes that entry after onboarding succeeds. A driver created this way remains **pending verification** and cannot receive delivery offers until approved by Company Admin.

## Supabase Auth URL configuration

In the Supabase dashboard for project `jikstpnvsdjhcibtjilp`:

1. Open **Authentication → URL Configuration**.
2. Set the Site URL to the Customer page:
   `https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/customer.html`
3. Add the exact app callback pages below to **Redirect URLs**. Include both directory and explicit-file forms because GitHub Pages may be opened either way.

```text
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/customer.html
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/public/index.html
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/driver/public/
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/driver/public/index.html
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/company/public/
https://bongat061-swifthaul-sa.github.io/swifthaul-sa/apps/company/public/index.html
```

Use these exact GitHub Pages URLs in the Supabase allow-list. Do not use a broad wildcard when exact paths are available.

## Google provider

1. In Google Cloud Console, create an OAuth Client ID with application type **Web application**.
2. Add this Authorized JavaScript origin:
   `https://bongat061-swifthaul-sa.github.io`
3. Add this Authorized redirect URI:
   `https://jikstpnvsdjhcibtjilp.supabase.co/auth/v1/callback`
4. In Supabase **Authentication → Providers → Google**, enable Google and enter the Client ID and Client Secret.
5. Save the settings. Keep the Client Secret in Supabase only; never commit it to GitHub or place it in browser code.

## Apple provider

1. An active Apple Developer Program account is required.
2. Create a Sign in with Apple **Services ID** associated with a primary Apple App ID that has the Sign in with Apple capability enabled.
3. In the Services ID's **Website URLs**, register the Supabase project domain `jikstpnvsdjhcibtjilp.supabase.co` (not the GitHub Pages hostname).
4. Register this Return URL:
   `https://jikstpnvsdjhcibtjilp.supabase.co/auth/v1/callback`
5. Create the Sign in with Apple key and note the Services ID, Team ID and Key ID.
6. In Supabase **Authentication → Providers → Apple**, enable Apple and enter the Services ID, Team ID, Key ID and private key.
7. Keep the Apple private key in the Supabase dashboard only. Do not commit it or paste it into chat.

Apple's web OAuth flow may not return a person's name. SwiftHaul collects the name in the Customer or Driver registration form instead.

## Deploying the onboarding function

The repository change adds `supabase/functions/social-onboard/index.ts`. It must be deployed to the Supabase project before testing first-time social registration:

```bash
supabase functions deploy social-onboard --project-ref jikstpnvsdjhcibtjilp
```

The function validates the caller's bearer token and uses the server-side service-role key only inside the Edge Function. It never accepts a user ID or role from the browser. Customer onboarding can only update a new customer profile; Driver onboarding can only turn a newly-created customer profile into a pending driver profile. It explicitly rejects admin/dispatcher role changes.

**Do not deploy this function to the live project until the pull request has been reviewed and you approve the deployment.**

## Test checklist after provider configuration and approved deployment

1. Customer: new Google sign-up, new Apple sign-up, existing email/password sign-in, existing Google/Apple sign-in.
2. Driver: new Google/Apple application includes all required fields and creates a pending/offline driver profile; existing linked driver can sign in; expired licence, missing terms and invalid vehicle data are rejected.
3. Company: authorised existing admin and dispatcher can sign in; a normal customer account and a new unapproved Google/Apple identity cannot enter the Company workspace.
4. Confirm that no social flow creates or changes an admin/dispatcher role.
5. Confirm email/password recovery still works after custom SMTP is configured. Social login does not remove the need for email delivery for password recovery and other account notices.

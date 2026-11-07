# Driver application notifications and document verification

## Edge Function secrets

Configure these secrets in Supabase before deploying the new functions:

- RESEND_API_KEY — Resend API key.
- DRIVER_EMAIL_FROM — verified sender, e.g. SwiftHaul SA <noreply@your-verified-domain>.
- DRIVER_APPLICATION_NOTIFY_EMAIL — `centurionfleetweb@gmail.com` (administrator inbox for new driver applications).
- WHATSAPP_ACCESS_TOKEN — Meta WhatsApp Cloud API access token.
- WHATSAPP_PHONE_NUMBER_ID — WhatsApp Business phone-number ID.
- WHATSAPP_ADMIN_RECIPIENT — administrator WhatsApp destination in international format, digits only.
- DRIVER_APP_URL — public Driver app URL.

Supabase supplies SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY to Edge Functions. Never put these secrets in browser code or APKs.

## Driver onboarding behavior

Drivers create accounts with their own password. They can sign in while driver_profiles.verification_status is pending; the Driver app displays a pending-approval notice and online availability remains disabled until an administrator approves the application. The user account remains active so authentication is not blocked by application review.

The welcome email confirms the registered email address and explains that approval is pending. Passwords are never emailed or sent over WhatsApp. Drivers sign in with the email and password they chose, or use password recovery.

The administrator email and WhatsApp destination are preconfigured in the function defaults from the details supplied by the account owner. The notification function is invoked after an authenticated driver session exists. If email confirmation is enabled, welcome and administrator notifications are sent on the driver's first successful sign-in after confirming their email. Configure Supabase Auth's normal confirmation email separately.

## Documents

The migration creates a private Storage bucket and metadata table. The Edge Function accepts PDF/JPEG/PNG/WebP files up to 10 MB: ID document, proof of address, bank confirmation, driver's licence and vehicle document. Uploads are private; administrators receive short-lived signed viewing links through the protected driver-admin function. Do not send identity documents, ID numbers, bank statements or account numbers in WhatsApp notifications.

Do not request card numbers, PINs, passwords or one-time passcodes.

## WhatsApp setup

The WhatsApp notification uses Meta WhatsApp Cloud API. A production sender may require Meta business verification and approved templates for business-initiated messages outside the customer-service window. Confirm the applicable Meta account setup and messaging permissions before enabling it.

## Deployment order (approval required)

1. Review and apply the migration.
2. Configure the secrets above.
3. Deploy driver-documents, driver-application-notify, and the updated driver-admin Edge Function.
4. Publish the updated Driver and Company preview sites.
5. Test with a dedicated test driver: signup, email confirmation, sign-in while pending, upload documents, admin signed-link access, approve, and verify that online availability unlocks only after approval.

No production deploy, database migration, or Edge Function deployment is performed by this branch change.

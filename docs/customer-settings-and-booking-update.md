# Customer settings and booking UI update

## Customer settings backend

The GitHub Pages customer app now calls the Supabase Edge Function `customer-settings` instead of the Netlify-only `/api/customer-profile` route. The function authenticates the Supabase bearer token and checks that the caller is an active customer. Profile rows use the authenticated Supabase user UUID in the existing `customer_profiles.owner_hash` field. The private `customer-photos` bucket stores resized JPEG profile photos; the function returns short-lived signed URLs.

Apply migration `20261107210000_customer_settings_private_photos.sql` and deploy `customer-settings` before publishing the updated customer site. The function uses the standard Supabase-provided URL, anon key and service-role key; never expose the service-role key in browser code.

Profile data includes name, phone, delivery notes and optional bank name/account holder/account number/branch code. The interface only shows the last four digits of a saved account number. Password changes use Supabase Auth directly. Profile deletion remains a support-assisted operation because open bookings, wallet balances and financial records must be reconciled before deletion.

## Customer welcome email

The `customer-welcome-notify` Edge Function sends a welcome email only after the customer has an authenticated Supabase session and `account-me` has confirmed an active customer role. If email confirmation is enabled, the function is called on the first successful sign-in after confirmation. The email contains an app link and account guidance, never a password. Successful delivery is recorded in `customer_welcome_notifications` so normal subsequent sign-ins do not resend it.

Configure:
- `RESEND_API_KEY` — Resend API key.
- `CUSTOMER_EMAIL_FROM` — verified sender (or reuse `DRIVER_EMAIL_FROM`).
- `CUSTOMER_APP_URL` — customer app URL (defaults to the current preview URL).

Apply migration `20261107213000_customer_welcome_notifications.sql` and deploy `customer-welcome-notify` before publishing the updated customer site. Provider credentials are not included in the repository. If the email provider is not configured or delivery fails, the app remains usable and logs that the welcome email is pending; the function does not mark an undelivered email as sent.

## Customer booking improvements

- OSM raster tiles replace the CARTO tile endpoint that displayed the API-key-required watermark. OpenStreetMap attribution is retained. The public OSM tile service has a usage policy and is suitable for preview/light usage, not a high-volume production SLA.
- Furniture selection now includes single, double, queen and king beds, mattress sets, disassembled king frames and bunk beds.
- The primary booking action only creates the booking. WhatsApp sharing is now a separate action on the booking card.
- After booking, customers can choose PayFast hosted checkout, card checkout through PayFast, or EFT instructions. The card action uses PayFast's hosted sandbox checkout; the customer chooses the card option on the PayFast page. The EFT flow asks customers to request verified bank details from dispatch and use the waybill as reference. It does not falsely mark a transfer as paid.

## Administrator driver application notifications

The administrator notification destination supplied for setup is:
- Email: `centurionfleetweb@gmail.com`
- WhatsApp: `+27 61 508 3880` (configure as `27615083880`)

Set these values as Supabase Edge Function secrets/configuration:
- `DRIVER_APPLICATION_NOTIFY_EMAIL=centurionfleetweb@gmail.com`
- `WHATSAPP_ADMIN_RECIPIENT=27615083880`

Also configure `RESEND_API_KEY`, `DRIVER_EMAIL_FROM`, `WHATSAPP_ACCESS_TOKEN`, and `WHATSAPP_PHONE_NUMBER_ID`. The last four are provider configuration/credentials and must be supplied by the account owner. Meta WhatsApp Cloud API business messaging may require a verified sender and approved templates. Do not commit tokens or secrets to GitHub.

## Preview verification checklist

1. Apply the customer settings migration and deploy `customer-settings`.
2. Deploy `driver-documents`, `driver-application-notify`, and updated `driver-admin` functions after setting the notification secrets.
3. Publish the preview only after review.
4. Test customer profile read/save, masked banking details, photo upload and password update.
5. Test the map tile rendering, address lookup, manual pin movement and route preview on an Android device and desktop browser.
6. Test bed selection, combined cargo estimates, booking creation and separate payment actions.
7. Verify PayFast card selection remains in PayFast hosted checkout and only a verified ITN marks payment as paid.
8. Test EFT with dispatch; never treat an uploaded proof or customer statement as payment confirmation.
9. Test driver signup, pending-approval login, document uploads, admin document review, email/WhatsApp delivery and approval unlock.

No Supabase migration, Edge Function deployment, merge, Pages publication or production deployment is performed by this branch update.


## Goods-in-transit protection and optional handling (draft terms)

The customer booking form now requires an explicit acknowledgement checkbox linked to the goods-in-transit and optional-handling terms. The checkbox is enforced in the browser before the booking request is sent. The terms explain the proposed R50,000 per-waybill maximum, the intended active-dispatch custody period, exclusions outside dispatch custody, prompt damage reporting, and separately quoted loading/unloading assistance. The acknowledgement expressly preserves non-excludable consumer rights.

Suggested pilot assistance prices shown in the draft terms:
- Van: one helper, first 30 minutes R180; each additional 30 minutes R100.
- Truck: two helpers, first 30 minutes R350; each additional 30 minutes R180.
- Bike: no lifting assistance included.

These are provisional commercial assumptions, not verified market tariffs. Final prices should be tested against driver/helper pay, travel time, waiting time, labour compliance, VAT treatment and operating costs. The customer must receive and accept the exact assistance scope and fee before dispatch. Stairs, long carries, heavy/oversized goods, equipment, dismantling and assembly require a separate quote.

**Production gate:** the R50,000 protection is draft customer-facing wording only. Do not represent cover as active until an insurer has issued the policy, SwiftHaul has confirmed the insured party/interest, per-waybill limit, declared-value process, excess, exclusions, custody start/end, claims deadlines, subcontractor/driver cover and claims procedure. South African legal review is required, especially to ensure the terms do not purport to exclude statutory consumer rights or liability for the company's negligence. No migration, deployment or production publication is included in this change.

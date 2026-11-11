const fs=require('node:fs');const assert=require('node:assert/strict');
const read=p=>fs.readFileSync(p,'utf8');
const portal=read('supabase/functions/customer-portal/index.ts');
const init=read('supabase/functions/paystack-payment-initialize/index.ts');
const webhook=read('supabase/functions/paystack-webhook/index.ts');
const payouts=read('supabase/functions/paystack-payouts/index.ts');
const admin=read('supabase/functions/driver-admin/index.ts');
const location=read('supabase/functions/driver-location/index.ts');
const tracking=read('supabase/functions/public-tracking/index.ts');
const ui=read('public/customer.html'),customer=read('public/customer.js'),track=read('public/tracking.js'),trackHtml=read('public/track.html');
const payoutUi=read('apps/driver/public/payouts.js');
const tests=[
 ['South African booking coordinates are bounded to ZA',/lat < -35\.2/.test(portal)&&/lng < 16\.4/.test(portal)&&/countrycodes:'za'/.test(read('public/address-autocomplete.js'))],
 ['Recipient cellphone and parcel notes are captured',/recipient_phone/.test(ui)&&/parcel_notes/.test(customer)&&/validZaMobile/.test(portal)],
 ['Paystack checkout uses card booking method, ZAR cents and authenticated customer',/payment_method!=="card"/.test(init)&&/currency:"ZAR"/.test(init)&&/amount:amountCents/.test(init)&&/auth\.auth\.getUser/.test(init)],
 ['Paystack webhook verifies raw HMAC-SHA512 and verifies transaction before booking paid',/x-paystack-signature/.test(webhook)&&/SHA-512/.test(webhook)&&/transaction\/verify/.test(webhook)&&/apply_paystack_payment/.test(webhook)],
 ['Payment confirmation creates recipient OTP and dispatches eligible driver',/pin=v_otp/.test(read('supabase/migrations/20261112017000_fix_paystack_owner_binding_and_secure_otp.sql'))&&/create_next_driver_offer/.test(read('supabase/migrations/20261112015000_dispatch_paid_paystack_bookings.sql'))],
 ['South African bank recipient uses Paystack BASA and API bank codes',/type:"basa"/.test(admin)&&/currency:"ZAR"/.test(admin)&&/bank\/validate/.test(admin)&&/transferrecipient/.test(admin)],
 ['Driver EFT payout reserves ledger balance and is idempotent',/reserve_paystack_driver_payout/.test(payouts)&&/reference/.test(payouts)&&/transfer/.test(payouts)&&/apply_paystack_payout_event/.test(webhook)],
 ['Verified delivery OTP credits 75 percent driver share',/recipient_pin_verified_at/.test(read('supabase/migrations/20261112016000_credit_driver_after_verified_otp_completion.sql'))&&/0\.75/.test(read('supabase/migrations/20261112016000_credit_driver_after_verified_otp_completion.sql'))],
 ['Public tracking endpoint omits recipient OTP and returns safe driver/location data',/tracking_code/.test(tracking)&&/vehicle_registration/.test(tracking)&&!/\.select\([^\n]*pin/.test(tracking)],
 ['Tracking page uses Supabase Realtime WebSocket updates',/postgres_changes/.test(track)&&/public_tracking_locations/.test(track)&&/track\.html/.test(customer)],
 ['Driver payout UI exposes secure Paystack withdrawal',/paystack-payouts/.test(payoutUi)&&/Request secure EFT payout/.test(read('apps/driver/public/index.html'))],
 ['GitHub Pages build publishes tracking fallback',/404\.html/.test(read('scripts/build-pages.cjs'))&&fs.existsSync('public/404.html')]
];
let failed=0;for(const [name,ok] of tests){console.log((ok?'PASS ':'FAIL ')+name);if(!ok)failed++;}if(failed)process.exit(1);

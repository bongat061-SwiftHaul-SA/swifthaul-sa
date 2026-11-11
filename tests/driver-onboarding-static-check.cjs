const fs=require('node:fs');
const js=fs.readFileSync('apps/driver/public/driver-onboarding.js','utf8');
const edge=fs.readFileSync('supabase/functions/driver-onboarding/index.ts','utf8');
const admin=fs.readFileSync('supabase/functions/driver-admin/index.ts','utf8');
const dashboard=fs.readFileSync('apps/company/public/driver-admin.js','utf8');
const driverPages=fs.readFileSync('apps/driver/public/section-pages.js','utf8');
const adminRoute=fs.readFileSync('apps/company/public/admin/drivers/index.html','utf8');
const schema=fs.readFileSync('supabase/migrations/20261111190000_driver_verification_expiry_and_pii_protection.sql','utf8');
const workGuard=fs.readFileSync('supabase/migrations/20261111191000_driver_work_eligibility_guard.sql','utf8');
const dateSchema=fs.readFileSync('supabase/migrations/20261111192000_enforce_driver_document_date_requirements.sql','utf8');
const licenceSchema=fs.readFileSync('supabase/migrations/20261111193000_require_current_driver_profile_licence.sql','utf8');
const bankSchema=fs.readFileSync('supabase/migrations/20261111194000_encrypt_complete_driver_bank_details.sql','utf8');
const offers=fs.readFileSync('supabase/functions/dispatch-offers/index.ts','utf8');
const secureDocs=fs.readFileSync('supabase/functions/driver-secure-documents/index.ts','utf8');
const earnings=fs.readFileSync('supabase/functions/driver-earnings-dashboard/index.ts','utf8');
const availability=fs.readFileSync('apps/driver/public/availability.js','utf8');
const operations=fs.readFileSync('apps/driver/public/operations.js','utf8');
const earningsUi=fs.readFileSync('apps/driver/public/driver-earnings.js','utf8');
const storageSchema=fs.readFileSync('supabase/migrations/20261111230000_driver_secure_storage_aes_gcm_and_access_audit.sql','utf8');
const tripSchema=fs.readFileSync('supabase/migrations/20261111232000_driver_trip_arrival_checkpoints.sql','utf8');
const payoutSchema=fs.readFileSync('supabase/migrations/20261111234000_secure_driver_payout_bank_details.sql','utf8');
const payoutEdge=fs.readFileSync('supabase/functions/driver-payouts/index.ts','utf8');
const payoutUi=fs.readFileSync('apps/driver/public/payouts.js','utf8');
const liveLocation=fs.readFileSync('apps/driver/public/live-location.js','utf8');
const locationGuard=fs.readFileSync('supabase/functions/driver-location/index.ts','utf8');
const dispatch=fs.readFileSync('supabase/functions/dispatch-operations/index.ts','utf8');
const checks=[
 ['four-step South African onboarding',/Personal & identity verification[\s\S]*Driver licence & PrDP[\s\S]*Vehicle & compliance documents[\s\S]*Banking & background check/.test(js)],
 ['dedicated driver onboarding page and /admin/drivers route',/onboarding: \{ title: 'Driver onboarding\.'/.test(driverPages)&&/page=drivers/.test(adminRoute)],
 ['South African cellphone format validation',/\+27/.test(js)&&/valid_sa_mobile_required/.test(edge)],
 ['South African ID Luhn checksum and DOB age validation',/function luhn\(v\)/.test(js)&&/luhn\(idNumber\)/.test(edge)&&/applicantAge<18/.test(edge)],
 ['citizen and foreign national document branches',/sa_citizen/.test(js)&&/foreign_national/.test(js)&&/passport_expiry/.test(js)&&/work_permit_expiry/.test(js)],
 ['licence code, expiry and document uploads',/EC1/.test(js)&&/licence_expiry/.test(edge)&&/licence_front/.test(edge)],
 ['PrDP required for trucks and heavy bakkies',/vehicle_gvm_kg/.test(js)&&/gvm>3500/.test(edge)],
 ['vehicle, eNaTIS, insurance and residence expiry checks',/registration_document_expiry/.test(js)&&/vehicle_disc_expiry/.test(edge)&&/proof_of_address/.test(edge)],
 ['bank details encrypted and universal branch codes',/bankCodes/.test(js)&&/encrypt_driver_pii/.test(edge)&&/bank_account_encrypted/.test(edge)],
 ['ID, passport and banking PII encrypted at rest',/identity_details_encrypted/.test(schema)&&/banking_details_encrypted/.test(schema)&&/pgp_sym_encrypt/.test(schema)],
 ['complete banking profile encrypted',/bank_details_encrypted/.test(bankSchema)],
 ['driver profile eligibility and document review schema',/onboarding_status/.test(schema)&&/can_go_online/.test(schema)&&/expiry_date/.test(schema)&&/rejection_reason/.test(schema)],
 ['current document and proof-of-residence dates required',/issued_at/.test(dateSchema)&&/expiry_date is not null/.test(dateSchema)&&/license_expiry>=v_today/.test(licenceSchema)],
 ['daily 06:00 SAST expiry cron and warning audit',/driver-document-expiry-0600-sast/.test(schema)&&/0 4 \* \* \*/.test(schema)&&/expiry_30_day/.test(schema)&&/expiry_7_day/.test(schema)&&/document_expired/.test(schema)],
 ['admin dashboard has review filters and split workspace',/Pending Review/.test(dashboard)&&/Expiring Soon/.test(dashboard)&&/Rejected/.test(dashboard)&&/Approved/.test(dashboard)&&/dv-split/.test(dashboard)],
 ['admin workspace verifies ID and age',/SA ID Luhn/.test(dashboard)&&/Age 18\+/.test(dashboard)],
 ['admin document previews and required rejection reason',/signed_url/.test(dashboard)&&/dv-zoom-image/.test(dashboard)&&/rejection_reason/.test(dashboard)],
 ['driver activation requires background clearance and approved documents',/criminal_background_clearance/.test(admin)&&/required_documents_not_approved/.test(admin)&&/action==="activate"/.test(admin)],
 ['central work eligibility guard is service-role only',/driver_can_accept_work/.test(workGuard)&&/revoke all on function public\.driver_can_accept_work/.test(workGuard)],
 ['go-online and offer acceptance enforce eligibility',/driver_can_accept_work/.test(offers)&&/driver_can_accept_work/.test(dispatch)],
 ['AES-256-GCM ID, passport and account encryption with duplicate ID hash',/AES-GCM/.test(edge)&&/sa_id_number_aesgcm/.test(edge)&&/passport_number_aesgcm/.test(edge)&&/account_number_aesgcm/.test(edge)&&/sa_id_hash/.test(edge)&&/create unique index.*sa_id_hash/.test(storageSchema)],
 ['private driver document bucket and short-lived one-use upload tickets',/driver-application-documents','driver-application-documents',false/.test(storageSchema)&&/driver_upload_tickets/.test(storageSchema)&&/Date.now\(\)\+5\*60\*1000/.test(secureDocs)&&/upload_ticket_expired_or_used/.test(secureDocs)],
 ['ten-minute admin read URLs are audited',/createSignedUrl\(doc.storage_path,600\)/.test(secureDocs)&&/document_access_logs/.test(secureDocs)&&/admin_id/.test(storageSchema)&&/createSignedUrl\(doc.storage_path,600\)/.test(admin)],
 ['30-second dispatch offers show driver net payout and distance',/Date.now\(\)\+30_000/.test(offers)&&/net_payout_zar/.test(offers)&&/30 SEC/.test(availability)&&/net payout/i.test(availability)],
 ['go-online UI blocks uncleared drivers and links to onboarding',/can_go_online/.test(availability)&&/Review onboarding documents/.test(availability)&&/driver-online-label/.test(fs.readFileSync('apps/driver/public/index.html','utf8'))&&/insertAdjacentElement\('afterend', availability\)/.test(driverPages)],
 ['active trip has pickup and drop-off arrival checkpoints',/arrive_pickup/.test(dispatch)&&/arrive_dropoff/.test(dispatch)&&/arrived_pickup_at/.test(tripSchema)&&/Arrived at pickup/.test(operations)&&/Arrived at drop-off/.test(operations)],\n ['live GPS is blocked unless driver is approved, eligible and online',/can_go_online/.test(locationGuard)&&/is_online/.test(locationGuard)&&/driver_not_eligible_or_online_for_live_location/.test(locationGuard)&&/driver-offline/.test(liveLocation)&&/driver-offline/.test(availability)],
 ['driver dashboard and earnings tab render daily, weekly, trip and EFT data',/dashboard: \{ title: 'Live trip dashboard\.'/.test(driverPages)&&/earnings: \{ title: 'Your earnings\.'/.test(driverPages)&&/today_net_cents/.test(earnings)&&/weekly_net_cents/.test(earnings)&&/Gross fare/.test(earningsUi)&&/payout_status/.test(earnings)],
 ['dashboard route and earnings script are wired',/page=dashboard/.test(fs.readFileSync('apps/driver/public/index.html','utf8'))&&/driver-earnings.js/.test(fs.readFileSync('apps/driver/public/index.html','utf8'))],
 ['verified payout account is used without sending plaintext bank details from client',/account_type/.test(js)&&/account_number_aesgcm/.test(payoutEdge)&&/request_driver_payout_secure/.test(payoutEdge)&&/account_number_aesgcm/.test(payoutSchema)&&/account_number:undefined/.test(payoutEdge)&&/amount_cents:amount/.test(payoutUi)]
];
let failed=false;
for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed=true;}
if(failed)process.exit(1);

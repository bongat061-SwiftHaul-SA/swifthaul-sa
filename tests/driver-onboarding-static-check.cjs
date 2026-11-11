const fs=require('node:fs');
const js=fs.readFileSync('apps/driver/public/driver-onboarding.js','utf8');
const edge=fs.readFileSync('supabase/functions/driver-onboarding/index.ts','utf8');
const admin=fs.readFileSync('supabase/functions/driver-admin/index.ts','utf8');
const dashboard=fs.readFileSync('apps/company/public/driver-admin.js','utf8');\nconst driverPages=fs.readFileSync('apps/driver/public/section-pages.js','utf8');\nconst adminRoute=fs.readFileSync('apps/company/public/admin/drivers/index.html','utf8');
const schema=fs.readFileSync('supabase/migrations/20261111190000_driver_verification_expiry_and_pii_protection.sql','utf8');
const workGuard=fs.readFileSync('supabase/migrations/20261111191000_driver_work_eligibility_guard.sql','utf8');
const dateSchema=fs.readFileSync('supabase/migrations/20261111192000_enforce_driver_document_date_requirements.sql','utf8');
const licenceSchema=fs.readFileSync('supabase/migrations/20261111193000_require_current_driver_profile_licence.sql','utf8');
const bankSchema=fs.readFileSync('supabase/migrations/20261111194000_encrypt_complete_driver_bank_details.sql','utf8');
const offers=fs.readFileSync('supabase/functions/dispatch-offers/index.ts','utf8');
const dispatch=fs.readFileSync('supabase/functions/dispatch-operations/index.ts','utf8');
const checks=[
 ['four-step South African onboarding',/Personal & identity verification[\s\S]*Licence & PrDP[\s\S]*Vehicle & documents[\s\S]*Banking & checks/.test(js)],
 ['South African cellphone format validation',/\+27/.test(js)&&/valid_sa_mobile_required/.test(edge)],
 ['SA ID Luhn checksum and DOB age validation',/function luhn\(v\)/.test(js)&&/function luhn\(const/.test(edge)===false&&/luhn\(idNumber\)/.test(edge)&&/applicantAge<18/.test(edge)],
 ['citizen and foreign national document branches',/sa_citizen/.test(js)&&/foreign_national/.test(js)&&/passport_expiry/.test(js)&&/work_permit_expiry/.test(js)],
 ['licence code, expiry and document uploads',/EC1/.test(js)&&/licence_expiry/.test(edge)&&/licence_front/.test(edge)],
 ['PrDP required for trucks and heavy bakkies',/vehicle_gvm_kg/.test(js)&&/gvm>3500/.test(edge)],
 ['vehicle, eNaTIS, insurance and residence expiry checks',/registration_document_expiry/.test(js)&&/vehicle_disc_expiry/.test(edge)&&/proof_of_address/.test(edge)],
 ['bank details encrypted and universal branch codes',/bankCodes/.test(js)&&/encrypt_driver_pii/.test(edge)&&/bank_account_encrypted/.test(edge)],
 ['ID, passport and banking PII encrypted at rest',/identity_details_encrypted/.test(schema)&&/banking_details_encrypted/.test(schema)&&/pgp_sym_encrypt/.test(schema)],
 ['driver profile eligibility and document review schema',/onboarding_status/.test(schema)&&/can_go_online/.test(schema)&&/expiry_date/.test(schema)&&/rejection_reason/.test(schema)],\n ['encrypted banking profile and dated document requirements',/bank_details_encrypted/.test(bankSchema)&&/issued_at/.test(dateSchema)&&/expiry_date is not null/.test(dateSchema)&&/license_expiry>=v_today/.test(licenceSchema)],
 ['daily 06:00 SAST expiry cron and warning audit',/driver-document-expiry-0600-sast/.test(schema)&&/0 4 \* \* \*/.test(schema)&&/expiry_30_day/.test(schema)&&/expiry_7_day/.test(schema)&&/document_expired/.test(schema)],
 ['admin dashboard has review filters and split workspace',/Pending Review/.test(dashboard)&&/Expiring Soon/.test(dashboard)&&/Rejected/.test(dashboard)&&/Approved/.test(dashboard)&&/dv-split/.test(dashboard)],
 ['admin workspace verifies ID and age',/SA ID Luhn/.test(dashboard)&&/Age 18\+/.test(dashboard)],
 ['admin document previews and required rejection reason',/signed_url/.test(dashboard)&&/dv-zoom-image/.test(dashboard)&&/rejection_reason/.test(dashboard)],
 ['driver activation requires background clearance and approved documents',/criminal_background_clearance/.test(admin)&&/required_documents_not_approved/.test(admin)&&/action==="activate"/.test(admin)],
 ['central work eligibility guard is service-role only',/driver_can_accept_work/.test(workGuard)&&/revoke all on function public\.driver_can_accept_work/.test(workGuard)],
 ['go-online and offer acceptance enforce eligibility',/driver_can_accept_work/.test(offers)&&/driver_can_accept_work/.test(dispatch)]
];
let failed=false;for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed=true;}if(failed)process.exit(1);

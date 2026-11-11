const fs=require('node:fs');
const js=fs.readFileSync('apps/driver/public/driver-onboarding.js','utf8');
const edge=fs.readFileSync('supabase/functions/driver-onboarding/index.ts','utf8');
const admin=fs.readFileSync('supabase/functions/driver-admin/index.ts','utf8');
const migration=fs.readFileSync('supabase/migrations/20261111180000_south_african_driver_onboarding.sql','utf8');
const checks=[
 ['four onboarding steps',/Personal & identity verification[\s\S]*Licence & PrDP[\s\S]*Vehicle & documents[\s\S]*Banking & checks/.test(js)],
 ['South African Luhn checksum',/function luhn\(v\)/.test(js)&&/function luhn\(v:string\)/.test(edge)],
 ['age 18 validation',/age\(d\)<18/.test(js)&&/applicantAge<18/.test(edge)],
 ['citizen and foreign national paths',/sa_citizen/.test(js)&&/foreign_national/.test(js)],
 ['licence codes and expiry',/EC1/.test(js)&&/licence_expiry/.test(edge)],
 ['PrDP heavy vehicle rules',/vehicle_gvm_kg/.test(js)&&/gvm>3500/.test(edge)],
 ['vehicle and residence documents',/vehicle_licence_disc/.test(js)&&/proof_of_address/.test(edge)],
 ['bank account and universal branch codes',/bankCodes/.test(js)&&/banking_details/.test(edge)],
 ['secure pending application table',/driver_onboarding_applications/.test(migration)&&/revoke all on public\.driver_onboarding_applications from public,anon,authenticated/.test(migration)],
 ['server-side private document uploads',/driver-application-documents/.test(edge)&&/createSignedUrl/.test(admin)===false],
 ['admin approval requires reviewed documents',/required_documents_not_approved/.test(admin)&&/review_status==="accepted"/.test(admin)],
 ['driver online requires approval',/verification_status!==\"approved\"/.test(fs.readFileSync('apps/driver/public/availability.js','utf8'))&&/approved_driver_required/.test(fs.readFileSync('supabase/functions/dispatch-offers/index.ts','utf8'))]
];
let failed=false;for(const [name,ok] of checks){console.log((ok?'PASS':'FAIL')+' '+name);if(!ok)failed=true;}if(failed)process.exit(1);

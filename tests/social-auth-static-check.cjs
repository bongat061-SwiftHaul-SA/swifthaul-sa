const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = (path) => fs.readFileSync(path, 'utf8');
const htmlFiles = [
  'public/customer.html',
  'public/index.html',
  'apps/driver/public/index.html',
  'apps/company/public/index.html',
];
for (const path of htmlFiles) {
  const html = read(path);
  assert.match(html, /data-social-provider="google"/, path + ' is missing Google sign-in');
  assert.match(html, /data-social-provider="apple"/, path + ' is missing Apple sign-in');
}

const customer = read('public/auth.js');
const driver = read('apps/driver/public/auth.js');
const company = read('apps/company/public/auth.js');
for (const [name, source] of [['customer', customer], ['driver', driver], ['company', company]]) {
  assert.match(source, /signInWithOAuth\(/, name + ' OAuth handler is missing');
  assert.match(source, /redirectTo: location\.origin \+ location\.pathname/, name + ' redirect target is not app-local');
}
assert.match(customer, /social-onboard/, 'Customer social signup must complete its profile');
assert.match(driver, /social-onboard/, 'Driver social signup must complete its profile');
assert.match(driver, /license_number:[\s\S]*license_expiry:[\s\S]*vehicle_type:[\s\S]*vehicle_registration:/, 'Driver onboarding must preserve required licence and vehicle fields');
assert.match(company, /\['admin','dispatcher'\]/, 'Company OAuth must retain the admin/dispatcher role gate');
assert.doesNotMatch(company, /signUp\(/, 'Company platform must not expose public account creation');

const onboard = read('supabase/functions/social-onboard/index.ts');
assert.match(onboard, /authClient\.auth\.getUser\(match\[1\]\)/, 'Onboarding must validate the caller bearer token');
assert.match(onboard, /google_or_apple_identity_required/, 'Onboarding must require Google or Apple identity');
assert.match(onboard, /profile\.role !== "customer"/, 'Driver onboarding must not elevate an admin/dispatcher role');
assert.match(onboard, /verification_status: "pending"/, 'New drivers must start pending verification');
assert.match(onboard, /SUPABASE_SERVICE_ROLE_KEY/, 'Privileged writes must remain server-side');

for (const path of ['public/auth.js', 'apps/driver/public/auth.js', 'apps/company/public/auth.js']) {
  assert.doesNotMatch(read(path), /SUPABASE_SERVICE_ROLE_KEY/, path + ' must not expose service-role credentials');
}
assert.match(read('docs/google-apple-social-auth.md'), /auth\/v1\/callback/, 'Provider callback setup is missing');
process.stdout.write('Social authentication static checks passed.\n');

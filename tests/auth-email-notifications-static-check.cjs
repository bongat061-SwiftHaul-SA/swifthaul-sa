const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');
const customer = read('public/auth.js');
const driver = read('apps/driver/public/auth.js');
const company = read('apps/company/public/auth.js');
const notifier = read('supabase/functions/account-signin-notify/index.ts');
const customerWelcome = read('supabase/functions/customer-welcome-notify/index.ts');
const driverWelcome = read('supabase/functions/driver-application-notify/index.ts');
const migration = read('supabase/migrations/20261111155000_account_signin_notifications.sql');
const companyConfig = read('apps/company/public/supabase-config.js');

for (const [name, source] of [['Customer', customer], ['Driver', driver], ['Company Admin', company]]) {
  assert.match(source, /async function sendSignInNotification\(session\)/, name + ' has a sign-in notification helper');
  assert.match(source, /account-signin-notify/, name + ' calls the authenticated notification endpoint');
  assert.match(source, /sendSignInNotification\(sessionData\.session\)/, name + ' sends a notification after PIN sign-in');
  assert.match(source, /sendSignInNotification\(data\.session\)/, name + ' sends a notification after password sign-in');
}
assert.match(notifier, /auth\.getUser\(token\)/, 'sign-in endpoint verifies the caller');
assert.match(notifier, /session_id/, 'sign-in notifications are deduplicated per auth session');
assert.match(notifier, /account_signin_notifications/, 'sign-in notification status is persisted');
assert.match(notifier, /Idempotency-Key/, 'email provider retries are idempotent');
assert.match(notifier, /RESEND_API_KEY/, 'email provider key is server-side only');
assert.match(customerWelcome, /New SwiftHaul Customer sign-up/, 'new Customer registration alerts Company Admins');
assert.match(customerWelcome, /SWIFTHAUL_SIGNUP_NOTIFY_EMAILS/, 'Customer signup recipients are configurable');
assert.match(customerWelcome, /admin_email_sent_at/, 'Customer admin notification delivery is tracked');
assert.match(driverWelcome, /New SwiftHaul driver application/, 'new Driver registration alerts Company Admins');
assert.match(driverWelcome, /SWIFTHAUL_SIGNUP_NOTIFY_EMAILS/, 'Driver signup recipients are configurable');
assert.match(companyConfig, /isGitHubPagesStagingPreview/, 'Company Admin GitHub Pages preview is detected');
assert.match(companyConfig, /tagkbropgzthsbjlhyvz\.supabase\.co/, 'Company Admin preview uses staging Supabase');
assert.match(companyConfig, /jikstpnvsdjhcibtjilp\.supabase\.co/, 'Company Admin production host retains production Supabase');
assert.match(migration, /enable row level security/i, 'notification records are protected by RLS');
assert.match(migration, /revoke all on public\.account_signin_notifications from anon,authenticated/i, 'notification records are not client-accessible');
console.log('Auth email notification checks passed.');

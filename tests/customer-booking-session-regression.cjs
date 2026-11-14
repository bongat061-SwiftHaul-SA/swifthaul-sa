const fs = require('node:fs');
const assert = require('node:assert/strict');
const read = path => fs.readFileSync(path, 'utf8');

const customer = read('public/customer.js');
const auth = read('public/auth.js');
const portal = read('supabase/functions/customer-portal/index.ts');
const customerHtml = read('public/customer.html');
const indexHtml = read('public/index.html');
const estimatorTheme = read('public/customer-simple-estimator.css');
const prepareSites = read('scripts/prepare-sites.cjs');
const pagesBuilder = read('scripts/build-pages.cjs');
const companyOperations = read('apps/company/public/operations.js');
const companyDrivers = read('apps/company/public/driver-admin.js');
const companyRefunds = read('apps/company/public/refund-admin.js');

for (const field of ['pickup_plus_code','pickup_geohash','dropoff_plus_code','dropoff_geohash']) {
  assert.ok(customer.includes(field + ':data.' + field), 'Customer booking submission must send ' + field + '.');
}
assert.match(portal, /typeof code !== "string"[\s\S]*?typeof hash !== "string"/, 'Booking API must validate both Plus Code and Geohash metadata.');
assert.doesNotMatch(auth, /await supabase\.functions\.invoke\('customer-welcome-notify'/, 'Email notification must not block Customer workspace restoration.');
assert.ok(auth.indexOf('workspace.hidden = false') < auth.indexOf("void supabase.functions.invoke('customer-welcome-notify'"), 'Customer workspace must be shown before best-effort welcome notification starts.');
assert.ok(auth.includes('AbortSignal.timeout(12000)'), 'Account validation must have a bounded network wait.');
assert.ok(auth.includes('form.elements.namedItem(name)') && auth.includes("field('acceptTerms')"), 'Customer auth mode switching must safely resolve named form controls.');
assert.match(auth, /catch \(error\) \{[\s\S]*?showSignIn\(error\?\.message/, 'Failed session restoration must return customers to a usable sign-in screen.');
assert.match(auth, /withTimeout\([\s\S]*?supabase\.auth\.getSession\(\)[\s\S]*?12000/, 'Session restoration must recover from a stalled local session check.');
assert.match(prepareSites, /if \(!fs\.existsSync\(target\)\) fs\.copyFileSync/, 'Site preparation must preserve platform-specific auth, theme and configuration files.');
assert.ok(prepareSites.includes("const chatSource = path.join(root, 'public', 'order-chat.js')") && prepareSites.includes("const chatTarget = path.join(publicDir, 'order-chat.js')"), 'Driver bundle must include the shared delivery chat asset.');
for (const [name, source] of [['operations',companyOperations],['driver admin',companyDrivers],['refund admin',companyRefunds]]) assert.ok(source.startsWith('(() => {') && source.trimEnd().endsWith('})();'), 'Company ' + name + ' script must isolate its top-level variables.');
assert.equal(indexHtml, customerHtml, 'Customer directory default and dedicated entry must remain identical.');
const wizardJs = 'booking-wizard.js?v=20261114-customer-wizard-flow2';
const wizardCss = 'booking-wizard.css?v=20261114-customer-wizard-flow2';
for (const [name, html] of [['Customer default entry', indexHtml], ['Customer dedicated entry', customerHtml]]) {
  assert.ok(html.includes(wizardJs), name + ' must load the current booking wizard script.');
  assert.ok(html.includes(wizardCss), name + ' must load the current booking wizard stylesheet.');
  assert.ok(html.indexOf('customer-simple-estimator.css') < html.indexOf(wizardCss), name + ' must load wizard CSS after estimator CSS.');
}
assert.ok(pagesBuilder.includes("if (app === 'customer')") && pagesBuilder.includes("fs.copyFileSync(path.join(source, 'customer.html'), path.join(target, 'index.html'))"), 'GitHub Pages build must generate its Customer directory default from customer.html.');
assert.ok(customerHtml.includes('customer-simple-estimator.css?v=20261113-compact-estimator'), 'Dedicated Customer entry must load the current compact estimator styling.');
assert.ok(indexHtml.includes('customer-simple-estimator.css?v=20261113-compact-estimator'), 'Root Customer entry must load the same current estimator styling.');
assert.ok(indexHtml.includes('name="city"') && indexHtml.includes('name="province"'), 'Root Customer entry must preserve required signup location fields.');
assert.ok(!/#(?:69d2f4|102b3a|65d1f2|72d4f3)/i.test(estimatorTheme), 'Customer estimator must use neutral graphite/silver accents, not the old blue accent.');
assert.ok(estimatorTheme.includes('#dce2e9') && estimatorTheme.includes('#f4f6f8'), 'Customer estimator must use silver/white highlights.');
console.log('Customer session restoration, booking pin metadata and graphite theme regression checks passed.');

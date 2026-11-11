const fs = require('node:fs');
const assert = require('node:assert/strict');

const customer = fs.readFileSync('public/customer.html', 'utf8');
const customerRoot = fs.readFileSync('public/index.html', 'utf8');
const customerWallet = fs.readFileSync('public/wallet.html', 'utf8');
const customerSettings = fs.readFileSync('public/settings.html', 'utf8');
const customerPages = fs.readFileSync('public/customer-pages.js', 'utf8');
const customerAuth = fs.readFileSync('public/auth.js', 'utf8');
const driverAuth = fs.readFileSync('apps/driver/public/auth.js', 'utf8');
const companyAuth = fs.readFileSync('apps/company/public/auth.js', 'utf8');
const driverPages = fs.readFileSync('apps/driver/public/section-pages.js', 'utf8');
const companyPages = fs.readFileSync('apps/company/public/section-pages.js', 'utf8');
const driver = fs.readFileSync('apps/driver/public/index.html', 'utf8');
const company = fs.readFileSync('apps/company/public/index.html', 'utf8');
const driverMap = fs.readFileSync('apps/driver/public/map.html', 'utf8');
const companyMap = fs.readFileSync('apps/company/public/map.html', 'utf8');
const companyTheme = fs.readFileSync('apps/company/public/unified-workspace-dark.css', 'utf8');

for (const [name, html, app] of [
  ['Customer', customer, 'customer'],
  ['Customer root', customerRoot, 'customer'],
  ['Customer wallet', customerWallet, 'customer'],
  ['Customer settings', customerSettings, 'customer'],
  ['Driver', driver, 'driver'],
  ['Company Admin', company, 'company']
]) {
  assert.ok(html.includes(`<body data-app="${app}"`), `${name} must declare its app theme scope`);
  assert.match(html, /unified-workspace-dark\.css/, `${name} must load the unified dark workspace stylesheet`);
}

assert.match(customer, /dark-premium\.css/);
assert.match(customerRoot, /dark-premium\.css/);
assert.match(customerWallet, /dark-premium\.css/);
assert.match(customerWallet, /premium-shell\.css/);
assert.doesNotMatch(customerWallet, /social-auth|Continue with Google|Continue with Apple/);
assert.match(customerWallet, /Submit deletion request/);
assert.match(driver, /dark-premium\.css/);
assert.match(driver, /premium-shell\.css/);
assert.match(driverMap, /unified-workspace-dark\.css/);
assert.match(company, /unified-workspace-dark\.css/);
assert.match(companyMap, /unified-workspace-dark\.css/);
assert.match(companyTheme, /body\[data-app="company"\] #auth-screen/);
assert.match(companyTheme, /body\[data-app="company"\] #workspace/);


const customerTheme = fs.readFileSync('public/unified-workspace-dark.css', 'utf8');
const driverTheme = fs.readFileSync('apps/driver/public/unified-workspace-dark.css', 'utf8');
for (const [name, css] of [['Customer', customerTheme], ['Driver', driverTheme], ['Company Admin', companyTheme]]) {
  assert.match(css, /Consistent action layout across Customer, Driver and Company Admin/, `${name} must include the shared action-layout rules`);
  assert.match(css, /\.order-actions/, `${name} must align grouped order actions`);
  assert.match(css, /flex-wrap:wrap!important/, `${name} must allow action buttons to wrap on narrow screens`);
  assert.match(css, /auth-panel form>button\.primary/, `${name} must align sign-in actions`);
}


for (const [name, html] of [
  ['Customer', customer], ['Customer root', customerRoot], ['Customer wallet', customerWallet],
  ['Customer settings', customerSettings], ['Driver', driver], ['Company Admin', company]
]) {
  assert.match(html, /<section id="auth-screen" hidden>/, `${name} must not flash the sign-in page during session restoration`);
  assert.match(html, /id="session-restore"/, `${name} must show a session restoration state`);
  assert.match(html, /class="workspace-navigation"/, `${name} must use the focused workspace navigation menu`);
}
for (const [name, auth] of [['Customer', customerAuth], ['Driver', driverAuth], ['Company Admin', companyAuth]]) {
  assert.match(auth, /persistSession:\s*true/, `${name} must persist its authenticated session`);
  assert.match(auth, /function showSessionRestore/, `${name} must restore the session before showing sign-in`);
  assert.match(auth, /function showSignIn/, `${name} must show sign-in only when needed`);
  assert.doesNotMatch(auth, /addEventListener\(['"]visibilitychange['"]/, `${name} must not revalidate and bounce users to sign-in on every page focus`);
}
for (const key of ['book','activity','wallet','account']) assert.ok(customerPages.includes(key), `Customer navigation must include ${key}`);
assert.match(customer, /customer-pages\.js/);
assert.match(customerWallet, /customer-pages\.js/);
assert.match(customerSettings, /customer-pages\.js/);
assert.match(driverPages, /removeAttribute\('open'\)/);
assert.ok(driver.includes('href="?page=availability" data-page="availability"'));
assert.ok(driverPages.includes("root.querySelectorAll('a[data-page]')"));
assert.match(companyPages, /removeAttribute\('open'\)/);

process.stdout.write('Customer, Driver and Company Admin dark-premium theme wiring and focused workspace page routing checks passed.\\n');

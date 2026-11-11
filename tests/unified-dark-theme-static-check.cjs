const fs = require('node:fs');
const assert = require('node:assert/strict');

const customer = fs.readFileSync('public/customer.html', 'utf8');
const customerRoot = fs.readFileSync('public/index.html', 'utf8');
const customerWallet = fs.readFileSync('public/wallet.html', 'utf8');
const driver = fs.readFileSync('apps/driver/public/index.html', 'utf8');
const company = fs.readFileSync('apps/company/public/index.html', 'utf8');
const driverMap = fs.readFileSync('apps/driver/public/map.html', 'utf8');
const companyMap = fs.readFileSync('apps/company/public/map.html', 'utf8');
const companyTheme = fs.readFileSync('apps/company/public/unified-workspace-dark.css', 'utf8');

for (const [name, html, app] of [
  ['Customer', customer, 'customer'],
  ['Customer root', customerRoot, 'customer'],
  ['Customer wallet', customerWallet, 'customer'],
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

process.stdout.write('Customer, Driver and Company Admin dark-premium theme wiring checks passed.\\n');

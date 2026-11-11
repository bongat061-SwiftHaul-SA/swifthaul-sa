const fs = require('node:fs');
const assert = require('node:assert/strict');

const read = path => fs.readFileSync(path, 'utf8');
const authFiles = [
  ['Customer', 'public/auth.js'],
  ['Driver', 'apps/driver/public/auth.js'],
  ['Company Admin', 'apps/company/public/auth.js']
];
const pageFiles = [
  ['Customer', 'public/customer-pages.js'],
  ['Driver', 'apps/driver/public/section-pages.js'],
  ['Company Admin', 'apps/company/public/section-pages.js']
];

for (const [name, path] of authFiles) {
  const auth = read(path);
  assert.match(auth, /persistSession:\s*true/, name + ' must persist Supabase sessions across page loads.');
  assert.match(auth, /autoRefreshToken:\s*true/, name + ' must refresh expiring sessions.');
  assert.match(auth, /async function init\s*\([\s\S]*?getSession\(\)/, name + ' must check the saved session before presenting sign-in.');
  assert.match(auth, /if\s*\(session\)\s*\{[\s\S]*?validateAccount\(session\)/, name + ' must validate and restore an existing session.');
  assert.match(auth, /auth\.signOut\(\)/, name + ' must provide an explicit sign-out action.');
  assert.match(auth, /event === 'SIGNED_OUT'[\s\S]*?authScreen\.hidden = false/, name + ' may return to sign-in after an actual signed-out event.');
  assert.match(auth, /event === 'TOKEN_REFRESHED'[\s\S]*?currentUser[\s\S]*?validateAccount\(session\)\.catch/, name + ' must not hide the workspace when background account revalidation is temporarily unavailable.');
}

for (const [name, path] of pageFiles) {
  const pages = read(path);
  assert.match(pages, /history\.pushState/, name + ' section changes must use in-app history, not full page navigation.');
  assert.match(pages, /addEventListener\(['"]popstate['"]/, name + ' must restore the selected section when browser Back/Forward is used.');
  assert.match(pages, /preventDefault\(\)/, name + ' section links must prevent full page reloads.');
  assert.doesNotMatch(pages, /location\.(?:assign|replace|reload)\s*\(/, name + ' section controller must not force a reload or redirect to sign-in.');
  assert.match(pages, /navCurrent\.textContent/, name + ' navigation summary must match the selected workspace page.');
}

const driverShell = read('apps/driver/public/premium-shell.js');
const customerShell = read('public/premium-shell.js');
assert.doesNotMatch(driverShell, /premium-bottom-nav|Move anything\.|Your day\. Your deliveries\./, 'Driver shell must not inject a competing navigation or overwrite page-controller headings.');
assert.doesNotMatch(customerShell, /premium-bottom-nav|Welcome to SwiftHaul\./, 'Customer shell must not inject a competing navigation or overwrite page-controller headings.');
const driverMap = read('apps/driver/public/map.html');
const companyMap = read('apps/company/public/map.html');
assert.match(driverMap, /href="index\.html\?page=deliveries"/, 'Driver map must return to the Driver workspace and its deliveries section.');
assert.match(companyMap, /href="index\.html\?page=dispatch"/, 'Company map must return to the Company workspace and its dispatch section.');

process.stdout.write('Customer, Driver and Company Admin session restoration, in-app navigation and map-return regression checks passed.\\n');

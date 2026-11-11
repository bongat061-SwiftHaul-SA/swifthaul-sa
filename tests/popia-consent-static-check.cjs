const fs = require('node:fs');
const assert = require('node:assert/strict');

const cases = [
  { app: 'Customer', html: 'public/index.html', auth: 'public/auth.js', purpose: 'customer account administration, delivery booking, trip dispatch, and regulatory compliance.' },
  { app: 'Driver', html: 'apps/driver/public/index.html', auth: 'apps/driver/public/auth.js', purpose: 'driver onboarding, trip dispatch, and regulatory compliance.' }
];

for (const item of cases) {
  const html = fs.readFileSync(item.html, 'utf8');
  const auth = fs.readFileSync(item.auth, 'utf8');
  const section = html.match(/<section id="terms-acceptance"[\s\S]*?<\/section>/)?.[0] || '';
  assert.ok(section, item.app + ': consent section exists');
  assert.match(section, /type="checkbox" name="acceptTerms"[^>]*required/, item.app + ': required service consent');
  assert.match(section, /Privacy Policy/, item.app + ': Privacy Policy link label');
  assert.match(section, /href="privacy-policy\.html"/, item.app + ': Privacy Policy link target');
  assert.match(section, /Terms of Service/, item.app + ': Terms of Service link label');
  assert.match(section, /href="terms\.html"/, item.app + ': Terms link target');
  assert.ok(section.includes(item.purpose), item.app + ': consent purpose disclosed');
  assert.match(section, /id="marketing-consent"[\s\S]*?name="acceptMarketing"/, item.app + ': separate marketing checkbox');
  assert.match(auth, /submit\.disabled = (?:signup|mode === 'signup') && !serviceConsent\\.checked/, item.app + ': signup disabled until consent');
  assert.match(auth, /serviceConsent\.addEventListener\('change', syncSignupConsent\)/, item.app + ': checkbox updates button state');
  assert.match(auth, /privacy_consent_at: new Date\(\)\.toISOString\(\)/, item.app + ': consent timestamp recorded');
  assert.match(auth, /marketing_consent: Boolean\(marketingConsent\?\.checked\)/, item.app + ': marketing choice recorded separately');
  assert.match(auth, /if \(mode === 'signup' && !form\.elements\.acceptTerms\.checked\)/, item.app + ': server request guard');
  const policy = fs.readFileSync(item.html.startsWith('apps/') ? 'apps/driver/public/privacy-policy.html' : 'public/privacy-policy.html', 'utf8');
  assert.match(policy, /Protection of Personal Information Act|POPIA/, item.app + ': privacy policy covers POPIA');
  console.log(item.app + ' POPIA signup consent: OK');
}

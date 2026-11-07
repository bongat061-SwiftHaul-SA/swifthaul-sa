// Prepare a self-contained web asset directory for one Capacitor Android app.
// Run prepare:sites first so shared files and platform-specific functions are current.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const app = process.argv[2];
const configs = {
  customer: { source: path.join(root, 'public'), target: path.join(root, 'android-customer', 'www') },
  driver: { source: path.join(root, 'apps/driver/public'), target: path.join(root, 'apps/driver/android-wrapper/www') },
  company: { source: path.join(root, 'apps/company/public'), target: path.join(root, 'apps/company/android-wrapper/www') },
};
if (!configs[app]) throw new Error('Usage: node scripts/copy-android-web.cjs customer|driver|company');
const { source, target } = configs[app];
if (!fs.existsSync(path.join(source, 'index.html')) && !fs.existsSync(path.join(source, 'customer.html'))) {
  throw new Error(`Platform web entry point not found in ${source}`);
}
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });
// The customer app's canonical entry file is customer.html; Capacitor expects index.html.
if (app === 'customer') fs.copyFileSync(path.join(target, 'customer.html'), path.join(target, 'index.html'));
console.log(`Prepared ${app} Android web assets at ${path.relative(root, target)}`);

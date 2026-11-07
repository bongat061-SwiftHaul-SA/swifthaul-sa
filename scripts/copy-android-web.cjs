// Stage the matching SwiftHaul preview-site web assets for one Capacitor Android app.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const sourceRoot = path.resolve(process.env.SWIFTHAUL_SOURCE_DIR || root);
const app = process.argv[2];
const configs = {
  customer: { source: path.join(sourceRoot, 'public'), target: path.join(root, 'android-customer', 'www') },
  driver: { source: path.join(sourceRoot, 'apps/driver/public'), target: path.join(root, 'apps/driver/android-wrapper', 'www') },
  company: { source: path.join(sourceRoot, 'apps/company/public'), target: path.join(root, 'apps/company/android-wrapper', 'www') },
};
if (!configs[app]) throw new Error('Usage: node scripts/copy-android-web.cjs customer|driver|company');
const { source, target } = configs[app];
if (!fs.existsSync(path.join(source, 'index.html')) && !fs.existsSync(path.join(source, 'customer.html'))) {
  throw new Error(`Platform preview entry point not found in ${source}`);
}
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true });

// The preview pages share selected assets from the source repository root.
if (app !== 'customer') {
  const sharedAssets = [
    { from: path.join(sourceRoot, 'public/map-core.js'), to: path.join(target, 'map-core.js') },
    { from: path.join(sourceRoot, 'public/live-location-view.js'), to: path.join(target, 'live-location-view.js') },
  ];
  for (const asset of sharedAssets) {
    if (fs.existsSync(asset.from)) fs.copyFileSync(asset.from, asset.to);
  }

  // Preserve the preview-site asset relationships when the app is hosted at the WebView root.
  const htmlFiles = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile() && file.endsWith('.html')) htmlFiles.push(file);
    }
  };
  walk(target);
  for (const file of htmlFiles) {
    const html = fs.readFileSync(file, 'utf8')
      .replaceAll('../../../public/map-core.js', 'map-core.js')
      .replaceAll('../../../live-location-view.js', 'live-location-view.js');
    fs.writeFileSync(file, html);
  }
}

// Capacitor expects index.html at the configured webDir root.
if (app === 'customer') fs.copyFileSync(path.join(target, 'customer.html'), path.join(target, 'index.html'));
console.log(`Prepared ${app} preview web assets from ${sourceRoot} at ${path.relative(root, target)}`);

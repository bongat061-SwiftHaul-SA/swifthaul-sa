const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });

// Materialise shared assets into each app before creating its independent web bundle.
execFileSync(process.execPath, [path.join(__dirname, 'prepare-sites.cjs')], { cwd: root, stdio: 'inherit' });
fs.mkdirSync(output, { recursive: true });
for (const app of ['customer', 'driver', 'company']) {
  const source = app === 'customer'
    ? path.join(root, 'public')
    : path.join(root, 'apps', app, 'public');
  const target = path.join(output, app);
  fs.cpSync(source, target, { recursive: true });
}
 
// Driver and Company retain root-relative shared map modules in their HTML entry points.
fs.cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
const sharedLiveLocation = path.join(root, 'public', 'live-location-view.js');
if (fs.existsSync(sharedLiveLocation)) fs.copyFileSync(sharedLiveLocation, path.join(output, 'live-location-view.js'));
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080a0e"><title>SwiftHaul SA · Platforms</title><style>:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#f4f5f7;background:#080a0e}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}main{width:min(900px,100%)}.eyebrow{letter-spacing:.16em;color:#9da4af;font-size:.75rem}h1{font-size:clamp(2rem,6vw,4rem);margin:.35em 0}p{line-height:1.65;color:#b6bdc7}.apps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:32px 0}a.card{display:block;padding:24px;border:1px solid #343a44;border-radius:18px;background:#11151b;color:inherit;text-decoration:none;min-height:130px}a.card:hover{border-color:#c3cad4}a.card strong{font-size:1.2rem}small{color:#9da4af}</style></head><body><main><p class="eyebrow">SWIFTHAUL SOUTH AFRICA</p><h1>Three platforms.<br>One delivery network.</h1><p>Choose the workspace you need. Each platform is packaged separately for browser testing.</p><div class="apps"><a class="card" href="./customer/customer.html"><strong>Customer platform</strong><p>Book and track deliveries, manage your customer account.</p><small>Open Customer →</small></a><a class="card" href="./driver/"><strong>Driver workspace</strong><p>Manage dispatches, delivery progress and earnings.</p><small>Open Driver →</small></a><a class="card" href="./company/"><strong>Company Admin</strong><p>Manage dispatch, drivers, payouts and financial operations.</p><small>Open Company Admin →</small></a></div></main></body></html>`;
fs.writeFileSync(path.join(output, 'index.html'), landing);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
fs.copyFileSync(path.join(root, 'public', '404.html'), path.join(output, '404.html'));
console.log('Three independent SwiftHaul web bundles assembled in dist/customer, dist/driver and dist/company.');

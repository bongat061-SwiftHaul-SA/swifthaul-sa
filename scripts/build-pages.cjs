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
  // Driver and Company were originally hosted three directory levels below
  // the site root. In the GitHub Pages preview they live one level below it,
  // so normalize their root-shared asset and landing-page links in the output.
  if (app !== 'customer') {
    const rewriteNestedPaths = (directory) => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name);
        if (entry.isDirectory()) rewriteNestedPaths(file);
        else if (entry.isFile() && entry.name.endsWith('.html')) {
          const html = fs.readFileSync(file, 'utf8');
          fs.writeFileSync(file, html.replaceAll('../../../', '../'));
        }
      }
    };
    rewriteNestedPaths(target);
  }
  // GitHub Pages hosts this project below a repository prefix. Rewrite legacy
  // domain-root URLs so offline, terms and fallback pages stay inside each app.
  const rewriteRootUrls = (directory, bundleRoot) => {
    const visit = (folder) => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(file);
        else if (entry.isFile() && entry.name.endsWith('.html')) {
          let html = fs.readFileSync(file, 'utf8');
          html = html.replace(/\b(href|src)\s*=\s*(["'])\/(?!\/)([^"']*)\2/gi, (match, attribute, quote, tail) => {
            const split = tail.search(/[?#]/);
            const pathname = split < 0 ? tail : tail.slice(0, split);
            const suffix = split < 0 ? '' : tail.slice(split);
            const target = pathname ? path.join(bundleRoot, pathname) : bundleRoot;
            let relative = path.relative(path.dirname(file), target).split(path.sep).join('/');
            if (!relative) relative = './';
            else if (!relative.startsWith('.')) relative = './' + relative;
            return attribute + '=' + quote + relative + suffix + quote;
          });
          fs.writeFileSync(file, html);
        }
      }
    };
    visit(directory);
  };
  rewriteRootUrls(target, target);
  // The Customer app has a dedicated customer.html entry point. Keep the
  // directory default (index.html) identical so browser visitors cannot land
  // on an older booking form when they open /customer/ instead.
  if (app === 'customer') {
    fs.copyFileSync(path.join(source, 'customer.html'), path.join(target, 'index.html'));
  }
}
 
// Build three dedicated full-featured websites alongside the focused mobile app bundles.
for (const app of ['customer', 'driver', 'company']) {
  const source = path.join(output, app);
  const portal = path.join(output, app + '-portal');
  fs.cpSync(source, portal, { recursive: true });
  const htmlPath = path.join(portal, 'index.html');
  let html = fs.readFileSync(htmlPath, 'utf8');
  html = html.replace(/<body([^>]*)>/i, (match, attrs) => '<body' + attrs + ' data-portal="true">');
  html = html.replace(/<title>SwiftHaul SA · [^<]+<\/title>/, '<title>SwiftHaul SA · ' + app + ' Portal</title>');
  fs.writeFileSync(htmlPath, html);
}
// Driver and Company retain root-relative shared map modules in their HTML entry points.
fs.cpSync(path.join(root, 'public'), path.join(output, 'public'), { recursive: true });
const sharedLiveLocation = path.join(root, 'public', 'live-location-view.js');
if (fs.existsSync(sharedLiveLocation)) fs.copyFileSync(sharedLiveLocation, path.join(output, 'live-location-view.js'));
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#080a0e"><title>SwiftHaul SA · Platforms</title><style>:root{font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#f4f5f7;background:#080a0e}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}main{width:min(900px,100%)}.eyebrow{letter-spacing:.16em;color:#9da4af;font-size:.75rem}h1{font-size:clamp(2rem,6vw,4rem);margin:.35em 0}p{line-height:1.65;color:#b6bdc7}.apps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:32px 0}a.card{display:block;padding:24px;border:1px solid #343a44;border-radius:18px;background:#11151b;color:inherit;text-decoration:none;min-height:130px}a.card:hover{border-color:#c3cad4}a.card strong{font-size:1.2rem}small{color:#9da4af}</style></head><body><main><p class="eyebrow">SWIFTHAUL SOUTH AFRICA</p><h1>Three platforms.<br>One delivery network.</h1><p>Choose the workspace you need. Each platform is packaged separately for browser testing.</p><div class="apps"><a class="card" href="./customer/customer.html"><strong>Customer platform</strong><p>Book and track deliveries, manage your customer account.</p><small>Open Customer →</small></a><a class="card" href="./driver/"><strong>Driver workspace</strong><p>Manage dispatches, delivery progress and earnings.</p><small>Open Driver →</small></a><a class="card" href="./company/"><strong>Company Admin</strong><p>Manage dispatch, drivers, payouts and financial operations.</p><small>Open Company Admin →</small></a></div></main></body></html>`;
fs.writeFileSync(path.join(output, 'index.html'), landing);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('Three independent SwiftHaul web bundles assembled in dist/customer, dist/driver and dist/company.');

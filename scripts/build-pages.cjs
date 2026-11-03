const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist');
fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });
for (const app of ['driver', 'company']) {
  fs.cpSync(path.join(root, 'apps', app, 'public'), path.join(output, app), { recursive: true });
}
const landing = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#173d31"><title>SwiftHaul SA · Apps</title><style>:root{font-family:system-ui;color:#18382e;background:#f3f5f0}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}main{width:min(760px,100%)}h1{font-size:clamp(2rem,6vw,3.5rem);margin:.3em 0}p{line-height:1.6;color:#52645b}.apps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:32px 0}a.card{display:block;padding:24px;border:1px solid #d6dfd8;border-radius:18px;background:#fff;color:inherit;text-decoration:none}a.card:hover{border-color:#527a68}a.card strong{font-size:1.2rem}small{color:#66786d}</style></head><body><main><p>SWIFTHAUL SOUTH AFRICA</p><h1>Move work forward.</h1><p>Choose your SwiftHaul workspace. The customer booking website remains on its existing production address while this migration is tested.</p><div class="apps"><a class="card" href="./driver/"><strong>Driver workspace</strong><p>Driver registration, verification status and delivery progress.</p><small>Open driver app →</small></a><a class="card" href="./company/"><strong>Company workspace</strong><p>Dispatch operations and driver application review.</p><small>Open company app →</small></a></div><p><a href="https://swifthaul-sa.netlify.app">Customer booking website ↗</a></p></main></body></html>`;
fs.writeFileSync(path.join(output, 'index.html'), landing);
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('GitHub Pages site assembled in dist/.');

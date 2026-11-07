// Build a safe, three-platform Netlify Deploy Preview without changing production output.
const fs = require('node:fs');
const path = require('node:path');

const root = process.cwd();
const output = path.join(root, 'preview-dist');
const copy = (source, destination) => {
  const from = path.join(root, source);
  if (!fs.existsSync(from)) throw new Error('Required preview source is missing: ' + source);
  const target = path.join(output, destination);
  if (!destination) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      fs.cpSync(path.join(from, entry.name), path.join(target, entry.name), { recursive: true });
    }
  } else {
    fs.cpSync(from, target, { recursive: true });
  }
};

fs.rmSync(output, { recursive: true, force: true });
fs.mkdirSync(output, { recursive: true });

// Customer assets are served from the preview root.
copy('public', '');
// Driver and Company Admin use the shared core through /public/map-core.js.
copy('public', 'public');
copy('apps/driver/public', 'apps/driver/public');
copy('apps/company/public', 'apps/company/public');

for (const file of [
  'customer.html',
  'map-core.js',
  'apps/driver/public/index.html',
  'apps/company/public/index.html'
]) {
  if (!fs.existsSync(path.join(output, file))) {
    throw new Error('Preview output is incomplete: ' + file);
  }
}
process.stdout.write('Prepared Customer, Driver and Company Admin preview entry points.\\n');

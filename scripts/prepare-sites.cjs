// Copy shared static assets and the account-validation function into each independent site.
// No compilation or build artifacts are involved.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
for (const app of ['customer', 'driver', 'company']) {
  const base = app === 'customer' ? root : path.join(root, 'apps', app);
  const publicDir = path.join(base, 'public');
  for (const name of fs.readdirSync(path.join(root, 'shared'))) {
    fs.copyFileSync(path.join(root, 'shared', name), path.join(publicDir, name));
  }
  if (app !== 'customer') {
    const functions = path.join(base, 'netlify', 'functions');
    fs.mkdirSync(functions, {recursive:true});
    let session = fs.readFileSync(path.join(root, 'netlify/functions/session.mts'), 'utf8');
    if (app === 'company') session = session.replace('  return Response.json({user:', "  if (!user.roles?.includes('admin')) return Response.json({error:'Company administrator access required.'},{status:403,headers});\n  return Response.json({user:");
    fs.writeFileSync(path.join(functions, 'session.mts'), session);
    fs.copyFileSync(path.join(root, 'netlify/functions/identity.mts'), path.join(functions, 'identity.mts'));
    const sharedIdentityFeature = path.join(root, '.netlify/features/netlify-identity');
    if (fs.existsSync(sharedIdentityFeature)) {
      const features = path.join(base, '.netlify', 'features');
      fs.mkdirSync(features, {recursive:true});
      fs.copyFileSync(sharedIdentityFeature, path.join(features, 'netlify-identity'));
    }
  }
}
console.log('Shared assets and account validation copied to all three sites.');

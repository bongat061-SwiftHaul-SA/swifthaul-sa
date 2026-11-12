const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'dist');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json'};
const server = http.createServer((req,res)=>{
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root,'.'+pathname);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target,'index.html'); } catch {}
  fs.readFile(target,(err,body)=>{
    if(err){res.writeHead(404).end('Not found');return;}
    res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'});res.end(body);
  });
});
(async()=>{
  assert.ok(fs.existsSync(root),'Run npm run build:pages before browser smoke tests.');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  const failures=[];
  try {
    const landing=await browser.newPage();
    const landingResponse=await landing.goto(base+'/',{waitUntil:'domcontentloaded'});
    assert.equal(landingResponse.status(),200,'Platform landing page should load');
    for (const href of ['./customer/customer.html','./driver/','./company/']) assert.equal(await landing.locator('a[href="'+href+'"]').count(),1,'Landing page link '+href);
    await landing.close();
    for (const app of [
      {name:'Customer',path:'/customer/customer.html',id:'customer',signup:true},
      {name:'Driver',path:'/driver/',id:'driver',signup:true},
      {name:'Company Admin',path:'/company/',id:'company',signup:false}
    ]) {
      const page=await browser.newPage();
      page.on('pageerror',e=>{failures.push(app.name+' JavaScript: '+e.message);console.error('PAGE ERROR '+app.name+': '+e.stack);});
      page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE ERROR '+app.name+': '+m.text());});
      const badLocal=[];
      page.on('response',r=>{if(r.status()>=400 && new URL(r.url()).origin===base)badLocal.push(r.status()+' '+r.url());});
      // Keep this UI smoke test deterministic and offline: auth backend behavior is
      // covered separately; here a no-session Supabase client lets the real app
      // initialize and exposes the actual sign-in controls without credentials.
      await page.route('**/supabase-js@2.49.1*',route=>route.fulfill({
        status:200,
        contentType:'application/javascript',
        body:`export function createClient(){
          const auth={
            getSession:async()=>({data:{session:null},error:null}),
            onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
            signOut:async()=>({error:null}),
            signInWithPassword:async()=>({data:{session:null},error:new Error('Mock auth only')}),
            signUp:async()=>({data:{session:null},error:new Error('Mock auth only')}),
            setSession:async()=>({data:{session:null},error:new Error('Mock auth only')}),
            resetPasswordForEmail:async()=>({error:null}),
            updateUser:async()=>({error:null})
          };
          return {auth,functions:{invoke:async()=>({data:null,error:null})}};
        }`
      }));
      const response=await page.goto(base+app.path,{waitUntil:'domcontentloaded'});
      assert.equal(response.status(),200,app.name+' page should return HTTP 200');
      await page.waitForFunction(()=>document.body.dataset.authState!=='checking',null,{timeout:20000}).catch(async error=>{
        const details=await page.evaluate(()=>({state:document.body.dataset.authState,authHidden:document.querySelector('#auth-screen')?.hidden,title:document.title}));
        throw new Error(app.name+' auth initialization did not finish: '+JSON.stringify(details)+'; '+error.message);
      });
      assert.equal(await page.locator('body').getAttribute('data-app'),app.id,app.name+' app identity');
      assert.ok((await page.title()).toLowerCase().includes(app.name==='Company Admin'?'company':app.name.toLowerCase()),app.name+' document title');
      assert.equal(await page.locator('#auth-form').count(),1,app.name+' sign-in form');
      assert.equal(await page.locator('#workspace').count(),1,app.name+' workspace shell should be present');
      assert.equal(await page.locator('#auth-screen').isVisible(),true,app.name+' should show the sign-in screen without an existing session');
      assert.equal(await page.locator('#auth-form input[name="email"]').count(),1,app.name+' email sign-in field');
      assert.equal(await page.locator('#auth-form input[name="password"]').count(),1,app.name+' password sign-in field');
      const pinButton=page.getByRole('button',{name:/6-digit PIN/i});
      assert.equal(await pinButton.count(),1,app.name+' quick PIN sign-in control');
      await pinButton.click();
      await page.locator('#auth-form input[name="loginPin"]').waitFor({state:'visible'});
      assert.equal(await page.locator('#auth-form input[name="loginPin"]').getAttribute('pattern'),'[0-9]{6}',app.name+' six-digit PIN validation');
      assert.equal(await page.locator('#auth-form input[name="email"]').isVisible(),false,app.name+' PIN sign-in must not ask for email');
      assert.equal(await page.locator('#auth-form input[name="password"]').isVisible(),false,app.name+' PIN sign-in must not ask for password');
      await page.getByRole('button',{name:/password instead/i}).click();
      assert.equal(await page.locator('#auth-form input[name="email"]').isVisible(),true,app.name+' password sign-in can be restored');
      if(app.signup){
        await page.locator('[data-auth-mode="signup"]').click();
        await page.locator('#auth-form input[name="city"]').waitFor({state:'visible'});
        await page.locator('#auth-form [name="province"]').waitFor({state:'visible'});
        assert.equal(await page.locator('#auth-form input[name="city"]').getAttribute('required'),'');
        assert.equal(await page.locator('#auth-form [name="province"]').getAttribute('required'),'');
        await page.locator('[data-auth-mode="login"]').click();
        assert.equal(await page.locator('#auth-form input[name="city"]').isVisible(),false);
      } else {
        assert.equal(await page.locator('body').getAttribute('data-app'),'company');
        assert.equal(await page.locator('#auth-form input[name="email"]').isVisible(),true,'Company Admin password sign-in remains available');
      }
      await page.waitForTimeout(800);
      assert.deepEqual(badLocal,[],app.name+' should not have missing local assets');
      await page.close();
      console.log('PASS '+app.name+' browser smoke test');
    }
    assert.deepEqual(failures,[],'No uncaught JavaScript errors: '+failures.join('; '));
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

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
      {name:'Customer',path:'/customer/',id:'customer',signup:true},
      {name:'Driver',path:'/driver/',id:'driver',signup:true},
      {name:'Company Admin',path:'/company/',id:'company',signup:false}
    ]) {
      const page=await browser.newPage();
      page.on('pageerror',e=>{failures.push(app.name+' JavaScript: '+e.message);console.error('PAGE ERROR '+app.name+': '+e.message+' '+(e.stack||''));});
      page.on('console',m=>{if(m.type()==='error')console.error('CONSOLE ERROR '+app.name+': '+m.text());});
      page.on('request',r=>{if(/bootstrap\\.js|auth\\.js|supabase-config\\.js|supabase-js/i.test(r.url()))console.error('MODULE REQUEST '+app.name+': '+r.url());});
      page.on('response',r=>{if(/bootstrap\\.js|auth\\.js|supabase-config\\.js|supabase-js/i.test(r.url()))console.error('MODULE RESPONSE '+app.name+': '+r.status()+' '+r.url());});
      page.on('requestfailed',r=>console.error('REQUEST FAILED '+app.name+': '+r.url()+' '+r.failure()?.errorText));
      const badLocal=[];
      page.on('response',r=>{if(r.status()>=400 && new URL(r.url()).origin===base)badLocal.push(r.status()+' '+r.url());});
      await page.addInitScript(()=>{window.__smokeLocalFailures=[];window.__smokePageErrors=[];window.addEventListener('error',event=>window.__smokePageErrors.push({message:event.message,filename:event.filename,lineno:event.lineno,colno:event.colno}));});
      // Keep this UI smoke test deterministic and offline: auth backend behavior is
      // covered separately; here a no-session Supabase client lets the real app
      // initialize and exposes the actual sign-in controls without credentials.
      await page.route('**/*',async route=>{
        const url=route.request().url();
        if(url.includes('supabase-js@2.49.1')) return route.fulfill({
          status:200,contentType:'application/javascript',
          headers:{'access-control-allow-origin':'*'},
          body:`export function createClient(){
            const auth={
              getSession:async()=>{window.__smokeGetSessionCalled=true;const result={data:{session:null},error:null};window.__smokeGetSessionResolved=true;return result;},
              onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
              signOut:async()=>({error:null}),
              signInWithPassword:async()=>({data:{session:null},error:new Error('Mock auth only')}),
              signUp:async()=>({data:{session:null},error:new Error('Mock auth only')}),
              setSession:async()=>({data:{session:null},error:new Error('Mock auth only')}),
              resetPasswordForEmail:async()=>({error:null}),
              updateUser:async()=>({error:null})
            };
            window.__smokeSupabaseClientCreated=true;\n            return {auth,functions:{invoke:async()=>({data:null,error:null})}};
          }`
        });
        if(url.includes('openlocationcode/1.0.5/openlocationcode.min.js')) return route.fulfill({status:200,contentType:'application/javascript',body:'window.OpenLocationCode = window.OpenLocationCode || {};'});
        return route.continue();
      });
      const response=await page.goto(base+app.path,{waitUntil:'domcontentloaded'});
      assert.equal(response.status(),200,app.name+' page should return HTTP 200');
      await page.waitForFunction(()=>document.body.dataset.authState!=='checking',null,{timeout:20000}).catch(async error=>{
        const details=await page.evaluate(()=>({
          state:document.body.dataset.authState,
          mockClientCreated:window.__smokeSupabaseClientCreated||false,
          getSessionCalled:window.__smokeGetSessionCalled||false,
          getSessionResolved:window.__smokeGetSessionResolved||false,
          authHidden:document.querySelector('#auth-screen')?.hidden,
          title:document.title,
          authStatus:document.querySelector('#auth-status')?.textContent,
          restoreMessage:document.querySelector('[data-session-message]')?.textContent,
          scripts:[...document.scripts].map(s=>({src:s.src,type:s.type,ready:s.readyState||null})),
          resources:performance.getEntriesByType('resource').map(r=>r.name).filter(n=>/bootstrap|auth\.js|supabase|openlocationcode/i.test(n)),
          localFailures:window.__smokeLocalFailures||[]
        }));
        throw new Error(app.name+' auth initialization did not finish: '+JSON.stringify(details)+'; '+error.message);
      });
      assert.equal(await page.locator('body').getAttribute('data-app'),app.id,app.name+' app identity');
      if(app.name==='Customer'){
        const wizard=page.locator('#booking-form .booking-wizard');
        assert.equal(await wizard.count(),1,'Customer default route must initialise the booking wizard.');
        const steps=page.locator('#booking-form .booking-step');
        assert.equal(await steps.count(),4,'Customer booking wizard must render four separate steps.');
        assert.equal(await wizard.locator('[data-wizard-count]').textContent(),'STEP 1 OF 4','Customer booking must start at step one.');
        assert.equal(await steps.nth(0).getAttribute('hidden'),null,'Customer first booking step must be visible.');
        assert.notEqual(await steps.nth(1).getAttribute('hidden'),null,'Customer later booking steps must start hidden.');
      }
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
      if(app.name==='Customer'){
        // Exercise the real four-step guest preview navigation, not just the
        // presence of four hidden sections. Use synthetic pin metadata so the
        // test does not depend on GPS or third-party map tile availability.
        await page.locator('#continue-as-guest').click();
        await page.locator('#workspace').waitFor({state:'visible'});
        // Guest preview opens on Home; explicitly enter the dedicated booking page.
        await page.locator('.customer-book-cta').click();
        await page.locator('#new-delivery').waitFor({state:'visible'});
        await page.evaluate(()=>{
          const form=document.querySelector('#booking-form');
          const values={
            pickup:'1 Main Road, Sandton, Johannesburg',
            dropoff:'10 Rivonia Road, Sandton, Johannesburg',
            recipient:'Test recipient · 071 000 0000',
            pickup_latitude:'-26.1076',pickup_longitude:'28.0567',pickup_plus_code:'5G5C+X8 Sandton',
            dropoff_latitude:'-26.1022',dropoff_longitude:'28.0586',dropoff_plus_code:'5G5C+W9 Sandton',
            weight:'3'
          };
          for(const [name,value] of Object.entries(values)){
            let input=form.querySelector('[name="'+name+'"]');
            if(!input && name.endsWith('_latitude') || !input && name.endsWith('_longitude') || !input && name.endsWith('_plus_code')){
              input=document.createElement('input');
              input.type='hidden';
              input.name=name;
              form.append(input);
            }
            if(!input)throw new Error('Missing Customer booking field: '+name);
            input.value=value;
            input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new Event('change',{bubbles:true}));
          }
          document.dispatchEvent(new CustomEvent('swift-haul:locations-confirmed'));
        });
        await page.locator('[data-wizard-count]').waitFor();
        await page.waitForFunction(()=>document.querySelector('[data-wizard-count]')?.textContent==='STEP 2 OF 4');
        assert.equal(await page.locator('#cargo-estimator').count(),1,'Customer booking must retain the parcel and vehicle estimator');
        assert.equal(await page.locator('#cargo-vehicle-tag').count(),1,'Customer booking must show its recommended vehicle selector');
        assert.equal(await page.locator('#quote-breakdown .fare-row').count(),5,'Customer quote must show base fare, included distance, distance adjustment, weight charge and fuel adjustment');
        assert.match(await page.locator('#quote-breakdown').textContent(),/Base fare[\\s\\S]*Included distance[\\s\\S]*Distance band adjustment[\\s\\S]*Weight charge[\\s\\S]*Fuel adjustment/,'Customer quote breakdown must retain the reference line items');
        const next=page.locator('[data-wizard-next]');
        await page.locator('[name="length"]').fill('30');
        await page.locator('[name="width"]').fill('20');
        await page.locator('[name="height"]').fill('15');
        await next.click();
        await page.waitForFunction(()=>document.querySelector('[data-wizard-count]')?.textContent==='STEP 3 OF 4');
        assert.equal(await page.locator('#booking-form .booking-step').nth(2).isVisible(),true,'Customer must advance to assistance and protection');
        await page.locator('#booking-terms-accepted').check();
        await next.click();
        await page.waitForFunction(()=>document.querySelector('[data-wizard-count]')?.textContent==='STEP 4 OF 4');
        assert.equal(await page.locator('#booking-form .booking-step').nth(3).isVisible(),true,'Customer must advance to final review');
        assert.match(await page.locator('[data-review-pickup]').textContent(),/Main Road/,'Review must show the entered pickup');
        assert.match(await page.locator('[data-review-dropoff]').textContent(),/Rivonia Road/,'Review must show the entered drop-off');
        assert.equal(await page.locator('#submit').isDisabled(),true,'Guest preview must not submit a live booking');
        await page.locator('[data-wizard-back]').click();
        await page.waitForFunction(()=>document.querySelector('[data-wizard-count]')?.textContent==='STEP 3 OF 4');
        await page.locator('#exit-guest').click();
        await page.locator('#auth-screen').waitFor({state:'visible'});
      }
      await page.waitForTimeout(800);
      const scriptErrors=await page.evaluate(()=>window.__smokePageErrors||[]);
      if(scriptErrors.length) failures.push(app.name+' script locations: '+JSON.stringify(scriptErrors));
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

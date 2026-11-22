const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..', 'dist');
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.png':'image/png', '.webmanifest':'application/manifest+json' };
const server = http.createServer((req,res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
  catch { res.writeHead(400).end(); return; }
  const file = path.resolve(root,'.'+pathname);
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403).end(); return; }
  let target = file;
  try { if (fs.statSync(target).isDirectory()) target = path.join(target,'index.html'); } catch {}
  fs.readFile(target,(err,body) => {
    if (err) { res.writeHead(404).end('Not found'); return; }
    res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream','cache-control':'no-store'}).end(body);
  });
});

function mockSupabase(role) {
  const profile = role === 'driver' ? "{verification_status:'pending',onboarding_status:'incomplete',vehicle_type:'bike'}" : 'null';
  return [
    'export function createClient(){',
    "const session={access_token:'mock-staging-browser-token',refresh_token:'mock-refresh',token_type:'bearer',expires_in:3600,user:{id:'00000000-0000-4000-8000-000000000001',email:'" + role + "-preview@example.test'}};",
    "const user={id:session.user.id,email:session.user.email,name:'Staging Preview',role:'" + role + "',accountStatus:'active'};",
    'const auth={getSession:async()=>({data:{session},error:null}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),signOut:async()=>({error:null}),signInWithPassword:async()=>({data:{session},error:null}),signUp:async()=>({data:{session,user:session.user},error:null}),setSession:async()=>({data:{session},error:null}),resetPasswordForEmail:async()=>({error:null}),updateUser:async()=>({error:null})};',
    'const functions={invoke:async(name,options={})=>{window.__mockInvocations=window.__mockInvocations||[];window.__mockInvocations.push({name,method:options.method||"POST"});',
    'if(name==="account-me")return {data:{user,driverProfile:' + profile + '},error:null};',
    'if(name==="account-pin")return {data:{has_pin:false},error:null};',
    'if(name==="driver-application-notify")return {data:{success:true},error:null};',
    'if(name==="driver-onboarding")return {data:{application:null,rejected_documents:[],notifications:[],draft:null},error:null};',
    'if(name==="driver-admin")return {data:{drivers:[]},error:null};',
    'if(name==="dispatch-operations")return {data:{orders:[],driverProfile:' + profile + ',approvedDrivers:[],driverOrderCounts:{},fleetRouteStops:[],qualityAlerts:[],driverScores:[],ratingBreakdown:{}},error:null};',
    'if(name==="admin-financials")return {data:{summary:{},metrics:{},transactions:[],payouts:[]},error:null};',
    'return {data:{},error:null};}};',
    'return {auth,functions};',
    '}'
  ].join('\n');
}

(async()=>{
  assert.ok(fs.existsSync(root),'Run npm run build:pages before this browser test.');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  try {
    const driver=await browser.newPage();
    const driverErrors=[];
    driver.on('pageerror',e=>driverErrors.push(e.message));
    await driver.route('**/*',async route=>{
      const url=route.request().url();
      if(url.includes('supabase-js@2.49.1'))return route.fulfill({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:mockSupabase('driver')});
      if(/^https?:/.test(url)&&!url.startsWith(base)&&!url.includes('esm.sh'))return route.abort();
      return route.continue();
    });
    await driver.goto(base+'/driver/',{waitUntil:'domcontentloaded'});
    await driver.waitForFunction(()=>document.body.dataset.authState==='authenticated');
    await driver.locator('#driver-onboarding-form').waitFor({state:'attached',timeout:15000});
    const onboarding=driver.locator('#driver-onboarding-form');
    const vehicle=onboarding.locator('[name="vehicle_type"]');
    const options=await vehicle.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent.trim()})).filter(n=>n.value));
    assert.deepEqual(options.map(o=>o.value),['motorbike','light_commercial','one_ton_bakkie','closed_truck'],'Driver application vehicle choices must match the active customer fleet. Actual: '+JSON.stringify(options));
    const groups=['identity_documents','driving_documents','vehicle_documents','proof_of_address_document'];
    for(const name of groups){
      const input=onboarding.locator('input[name="'+name+'"]');
      assert.equal(await input.count(),1,'One '+name+' upload slot must exist.');
      assert.equal(await input.getAttribute('multiple')!==null,true,name+' must accept multiple files.');
    }
    assert.equal(await onboarding.locator('#driver-onboarding-files input[type="file"]').count(),4,'Driver onboarding must use exactly four grouped upload slots.');
    await vehicle.evaluate(el=>{el.value='closed_truck';el.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await onboarding.locator('[name="prdp_holder"]').getAttribute('required'),'','H1 Truck onboarding must require a PrDP.');
    await vehicle.evaluate(el=>{el.value='one_ton_bakkie';el.dispatchEvent(new Event('change',{bubbles:true}));});
    await onboarding.locator('[name="vehicle_gvm_kg"]').evaluate(el=>{el.value='4000';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await onboarding.locator('[name="prdp_holder"]').getAttribute('required'),'','A 1-Ton Bakkie declared above 3,500 kg GVM must require a PrDP.');
    await onboarding.locator('[name="vehicle_gvm_kg"]').evaluate(el=>{el.value='3000';el.dispatchEvent(new Event('input',{bubbles:true}));});
    assert.equal(await onboarding.locator('[name="prdp_holder"]').getAttribute('required'),null,'A 1-Ton Bakkie at or below 3,500 kg GVM does not require a PrDP under this form rule.');
    await onboarding.locator('[name="identity_type"]').evaluate(el=>{el.value='sa_citizen';el.dispatchEvent(new Event('change',{bubbles:true}));});
    await onboarding.locator('input[name="identity_documents"]').setInputFiles([
      {name:'id-front.pdf',mimeType:'application/pdf',buffer:Buffer.from('test document')},
      {name:'id-back.pdf',mimeType:'application/pdf',buffer:Buffer.from('test document')},
      {name:'profile-selfie.pdf',mimeType:'application/pdf',buffer:Buffer.from('test document')}
    ]);
    const identityTypes=await onboarding.locator('input[name="identity_documents"]').evaluate(input=>[...input.parentElement.querySelectorAll('.document-file-type-map select')].map(s=>[...s.options].map(o=>o.value)));
    assert.equal(identityTypes.length,3,'Each identity file must have its own document type selector.');
    assert.ok(identityTypes.every(values=>['id_front','id_back','profile_selfie'].every(value=>values.includes(value))),'South African identity files must map to ID front, ID back and profile selfie.');
    await onboarding.locator('[name="prdp_holder"]').check();
    await onboarding.locator('input[name="driving_documents"]').setInputFiles([
      {name:'licence-front.pdf',mimeType:'application/pdf',buffer:Buffer.from('test document')},
      {name:'licence-back.pdf',mimeType:'application/pdf',buffer:Buffer.from('test document')},
      {name:'prdp.pdf',mimeType:'application/pdf',buffer:Buffer.from('test document')}
    ]);
    const drivingTypes=await onboarding.locator('input[name="driving_documents"]').evaluate(input=>[...input.parentElement.querySelectorAll('.document-file-type-map select')].map(s=>[...s.options].map(o=>o.value)));
    assert.equal(drivingTypes.length,3,'Each driving credential file must have its own document type selector.');
    assert.ok(drivingTypes.every(values=>values.includes('prdp')),'PrDP document type must be available when the driver declares a PrDP.');
    assert.deepEqual(driverErrors,[],'Driver onboarding screen must not throw uncaught JavaScript errors.');
    await driver.close();

    const company=await browser.newPage();
    const companyErrors=[];
    company.on('pageerror',e=>companyErrors.push(e.message));
    await company.route('**/*',async route=>{
      const url=route.request().url();
      if(url.includes('supabase-js@2.49.1'))return route.fulfill({status:200,contentType:'application/javascript',headers:{'access-control-allow-origin':'*'},body:mockSupabase('admin')});
      if(/^https?:/.test(url)&&!url.startsWith(base)&&!url.includes('esm.sh'))return route.abort();
      return route.continue();
    });
    await company.goto(base+'/company/',{waitUntil:'domcontentloaded'});
    await company.waitForFunction(()=>document.body.dataset.authState==='authenticated');
    await company.locator('#next-offer-form').waitFor({state:'attached',timeout:15000});
    await company.locator('#drivers').waitFor({state:'attached'});
    await company.waitForFunction(()=>document.querySelector('#drivers')?.textContent.includes('No driver applications yet.'));
    assert.equal(await company.locator('#offer-waybill').count(),1,'Company Admin dispatch offer form must be available to an authenticated administrator.');
    assert.equal(await company.locator('#drivers .operations-list article').count(),0,'Empty staging driver application queue must render without fabricated applicants.');
    assert.deepEqual(companyErrors,[],'Company Admin dispatch and driver management screens must not throw uncaught JavaScript errors.');
    await company.close();
    console.log('PASS authenticated mock-session Driver onboarding and Company Admin dispatch UI checks (no real submissions or assignments).');
  } finally {
    await browser.close();
    await new Promise(resolve=>server.close(resolve));
  }
})().catch(error=>{console.error(error);process.exitCode=1;});

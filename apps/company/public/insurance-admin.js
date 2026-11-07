(() => {
  const panel=document.getElementById('insurance-management');
  if(!panel)return;
  const status=document.getElementById('insurance-admin-status');
  const list=document.getElementById('insurance-admin-list');
  const refresh=document.getElementById('insurance-admin-refresh');
  let active=false,isAdmin=false,epoch=0;
  const client=()=>window.swiftHaulSupabase;
  async function call(method,body){
    const supabase=client();
    if(!supabase)throw new Error('Secure account connection is unavailable.');
    const {data,error}=await supabase.functions.invoke('driver-insurance-admin',{method,...(body?{body}:{})});
    if(error)throw new Error(data?.error||error.message||'Insurance administration request failed.');
    if(data?.error)throw new Error(data.error);
    return data;
  }
  function element(tag,text,className){
    const node=document.createElement(tag);
    if(text!==undefined)node.textContent=text;
    if(className)node.className=className;
    return node;
  }
  function actionButton(label,fn){
    const b=element('button',label);b.type='button';b.addEventListener('click',()=>fn(b));return b;
  }
  async function update(driver,action,fields,button){
    button.disabled=true;
    try{
      await call('POST',{user_id:driver.user_id,action,...fields});
      status.textContent=action==='activate'?'Insurer policy activation recorded.':('Policy status updated: '+action+'.');
      await load();
    }catch(error){status.textContent=error.message||'Policy update failed.';}
    finally{button.disabled=false;}
  }
  function render(driver){
    const card=element('article',undefined,'order');
    const title=element('h3',driver.full_name);
    const detail=element('p',[driver.phone||'No phone on file','Account '+driver.account_status,'Driver review '+driver.verification_status].join(' · '));
    const subscription=element('p',driver.membership
      ? 'Premium '+driver.membership.plan+' · ends '+new Date(driver.membership.ends_at).toLocaleDateString('en-ZA')
      : 'No verified active Premium membership');
    const eligibility=element('p',driver.eligible
      ? 'Subscription eligible · '+driver.eligibility_basis
      : 'Not eligible for insurance subscription benefits');
    const policy=driver.policy;
    const coverage=element('p',driver.insurance_active
      ? 'INSURANCE ACTIVE · '+policy.insurer_name+' · '+policy.policy_reference+' · '+new Date(policy.coverage_starts_at).toLocaleDateString('en-ZA')+' – '+new Date(policy.coverage_ends_at).toLocaleDateString('en-ZA')
      : 'Insurance status: '+(policy?.status||'not registered')+(policy?.policy_reference?' · '+policy.policy_reference:''));
    card.append(title,detail,subscription,eligibility,coverage);
    const limits=element('p','Benefit limits: vehicle R30,000 · accidental disability R100,000 · accident daily benefit R1,000 per eligible day.');
    limits.className='subtle';card.append(limits);
    const fields=element('div',undefined,'workspace-grid');
    const insurerLabel=element('label','Insurer / underwriting partner');
    const insurer=element('input');insurer.type='text';insurer.maxLength=160;insurer.required=true;insurer.value=policy?.insurer_name||'';
    insurerLabel.append(insurer);
    const referenceLabel=element('label','Insurer policy reference');
    const reference=element('input');reference.type='text';reference.maxLength=120;reference.required=true;reference.value=policy?.policy_reference||'';
    referenceLabel.append(reference);
    const startLabel=element('label','Coverage starts');
    const start=element('input');start.type='datetime-local';start.required=true;
    if(policy?.coverage_starts_at)start.value=new Date(new Date(policy.coverage_starts_at).getTime()-new Date(policy.coverage_starts_at).getTimezoneOffset()*60000).toISOString().slice(0,16);
    startLabel.append(start);
    const endLabel=element('label','Coverage ends');
    const end=element('input');end.type='datetime-local';end.required=true;
    if(policy?.coverage_ends_at)end.value=new Date(new Date(policy.coverage_ends_at).getTime()-new Date(policy.coverage_ends_at).getTimezoneOffset()*60000).toISOString().slice(0,16);
    endLabel.append(end);
    fields.append(insurerLabel,referenceLabel,startLabel,endLabel);card.append(fields);
    const activate=actionButton('Activate verified insurer policy',()=>{
      if(!insurer.value.trim()||!reference.value.trim()||!start.value||!end.value){status.textContent='Enter the insurer, policy reference and coverage dates first.';return;}
      if(!window.confirm('Confirm that the insurer has issued this policy and approved the stated benefit limits and dates?'))return;
      update(driver,'activate',{insurer_name:insurer.value,policy_reference:reference.value,
        coverage_starts_at:new Date(start.value).toISOString(),coverage_ends_at:new Date(end.value).toISOString()},activate);
    });
    activate.disabled=!driver.eligible;
    card.append(activate);
    if(policy){
      if(policy.status!=='suspended')card.append(actionButton('Suspend cover',e=>update(driver,'suspend',{},e)));
      if(policy.status!=='expired')card.append(actionButton('Mark policy expired',e=>update(driver,'expire',{},e)));
      card.append(actionButton('Reset policy record',e=>{
        if(window.confirm('Reset this insurer policy record to pending and clear its insurer reference and dates?'))update(driver,'pending',{},e);
      }));
    }
    list.append(card);
  }
  async function load(){
    if(!active||!isAdmin)return;
    const current=++epoch;status.textContent='Loading driver insurance records…';
    try{
      const data=await call('GET');
      if(current!==epoch)return;
      list.replaceChildren();
      if(!data.drivers?.length){status.textContent='No driver accounts are available yet.';return;}
      data.drivers.forEach(render);
      status.textContent='Loaded '+data.drivers.length+' driver insurance records.';
    }catch(error){if(current===epoch)status.textContent=error.message||'Could not load insurance records.';}
  }
  refresh.addEventListener('click',load);
  document.addEventListener('account-ready',event=>{
    active=true;isAdmin=event.detail.role==='admin';
    if(!isAdmin){status.textContent='Administrator access is required to manage insurance policies.';return;}
    load();
  });
  document.addEventListener('account-cleared',()=>{active=false;isAdmin=false;epoch++;list.replaceChildren();status.textContent='Sign in as an administrator to manage insurer policies.';});
})();

const panel=document.getElementById('drivers');
if(panel){
  const note=document.createElement('p');
  note.textContent='Review driver applications and verification documents.';
  const refresh=document.createElement('button');
  refresh.type='button';refresh.textContent='Refresh driver applications';
  const status=document.createElement('p');status.setAttribute('role','status');
  const list=document.createElement('div');list.className='operations-list';
  panel.append(note,refresh,status,list);
  let active=false,epoch=0,isAdmin=false;
  async function call(method,body){
    const client=window.swiftHaulSupabase;
    if(!client)throw new Error('Secure account connection is unavailable.');
    const {data,error}=await client.functions.invoke('driver-admin',{method,...(body?{body}:{})});
    if(error)throw new Error(data?.error||error.message||'Driver review request failed.');
    if(data?.error)throw new Error(data.error);
    return data;
  }
  async function load(){
    if(!active||!isAdmin)return;
    const current=++epoch;status.textContent='Loading driver applications…';
    try{
      const data=await call('GET');
      if(current!==epoch)return;
      list.replaceChildren();
      if(!data.drivers?.length){status.textContent='No driver applications yet.';return;}
      for(const driver of data.drivers)render(driver);
      status.textContent='';
    }catch(error){if(current===epoch)status.textContent=error.message;}
  }
  async function review(driver,action,button){
    button.disabled=true;
    try{await call('POST',{user_id:driver.user_id,action});await load();status.textContent='Driver status updated.';}
    catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  function render(driver){
    const card=document.createElement('article');card.className='order';
    const title=document.createElement('h3');title.textContent=driver.user_profiles?.full_name||'Driver applicant';
    const details=document.createElement('p');
    details.textContent=[driver.phone,driver.license_number?'Licence '+driver.license_number:'Licence missing',driver.license_expiry?'Expires '+driver.license_expiry:'Expiry missing',String(driver.vehicle_type||'Vehicle missing').toUpperCase(),driver.vehicle_registration||'Registration missing'].join(' · ');
    const state=document.createElement('p');state.textContent='Verification: '+driver.verification_status;
    card.append(title,details,state);
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>review(driver,action,b));card.append(b);};
    if(driver.verification_status!=='approved')button('Approve driver','approve');
    if(driver.verification_status!=='rejected')button('Reject application','reject');
    if(driver.verification_status==='approved')button('Suspend driver','suspend');
    list.append(card);
  }
  refresh.addEventListener('click',load);
  document.addEventListener('account-ready',event=>{
    active=true;isAdmin=event.detail.role==='admin';
    if(!isAdmin){status.textContent='Only company administrators can approve driver applications.';return;}
    load();
  });
  document.addEventListener('account-cleared',()=>{active=false;isAdmin=false;epoch++;list.replaceChildren();status.textContent='';});
}

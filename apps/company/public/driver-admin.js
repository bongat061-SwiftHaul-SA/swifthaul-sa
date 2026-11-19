(() => {
const panel=document.getElementById('drivers');
if(panel){
  const note=document.createElement('p');
  note.textContent='Review driver applications and verification documents.';
  const refresh=document.createElement('button');
  refresh.type='button';refresh.textContent='Refresh driver applications';
  const status=document.createElement('p');status.setAttribute('role','status');
  const list=document.createElement('div');list.className='operations-list';
  const quality=document.createElement('section');quality.className='admin-quality-panel';
  const qualityTitle=document.createElement('h3');qualityTitle.textContent='Driver Quality & Ratings';
  const qualityFilter=document.createElement('select');qualityFilter.setAttribute('aria-label','Filter driver quality');qualityFilter.innerHTML='<option value="all">All drivers</option><option value="watchlist">Watchlist</option><option value="review_required">Review required</option><option value="low_rated">Below 4 stars</option>';
  const qualityList=document.createElement('div');qualityList.className='admin-quality-list';quality.append(qualityTitle,qualityFilter,qualityList);
  panel.append(note,refresh,status,quality,list);
  let active=false,epoch=0,isAdmin=false;
  async function call(method,body){
    const client=window.swiftHaulSupabase;
    if(!client)throw new Error('Secure account connection is unavailable.');
    const {data,error}=await client.functions.invoke('driver-admin',{method,...(body?{body}:{})});
    if(error){
      let details=data;
      try{if(!details&&error.context&&typeof error.context.json==='function')details=await error.context.json();}catch{}
      const code=details?.error||error.message||'Driver review request failed.';
      const missing=Array.isArray(details?.missing_documents)?details.missing_documents:[];
      const readable={
        criminal_background_clearance_required:'Background clearance must be confirmed before this driver can be approved.',
        valid_driver_licence_required:'A current, valid driver licence is required before approval.',
        required_documents_not_approved:'Approval is blocked until all required documents have been reviewed and accepted.',
        driver_activation_checks_failed:'The final driver eligibility checks did not pass. The driver has not been activated.'
      };
      throw new Error((readable[code]||code)+(missing.length?' Missing or outstanding: '+missing.join(', '):''));
    }
    if(data?.error)throw new Error(data.error);
    return data;
  }
  async function load(){
    if(!active||!isAdmin)return;
    const current=++epoch;status.textContent='Loading driver applications…';
    try{
      const data=await call('GET');
      if(current!==epoch)return;
      try{
        const q=await window.swiftHaulSupabase.functions.invoke('dispatch-operations',{method:'GET'});
        if(!q.error&&!q.data?.error){const scores=q.data.driverScores||[],alerts=q.data.qualityAlerts||[];qualityList.replaceChildren();const filter=qualityFilter.value;const filtered=scores.filter(d=>filter==='all'||(filter==='low_rated'?Number(d.average_rating)<4:d.performance_tier===filter));if(!filtered.length){const empty=document.createElement('p');empty.textContent='No drivers match this quality filter.';qualityList.append(empty);}for(const d of filtered){const row=document.createElement('article');row.className='admin-quality-card';const name=document.createElement('strong');name.textContent=String(d.user_id)+' · '+String(d.performance_tier||'unrated').replace('_',' ').toUpperCase();const metrics=document.createElement('p');metrics.textContent='Score '+d.performance_score+'/100 · ★ '+Number(d.average_rating||5).toFixed(2)+' ('+d.total_ratings+' ratings) · On time '+d.on_time_percentage+'% · Completion '+d.completion_percentage+'%';const related=alerts.filter(a=>a.driver_id===d.user_id&&a.status!=='dismissed');const alertText=document.createElement('p');alertText.textContent=related.length+' open quality alert(s)';row.append(name,metrics,alertText);qualityList.append(row);}}}catch(e){console.warn('Driver quality panel unavailable',e);}
      list.replaceChildren();
      if(!data.drivers?.length){status.textContent='No driver applications yet.';return;}
      for(const driver of data.drivers)render(driver);
      status.textContent='';
    }catch(error){if(current===epoch)status.textContent=error.message;}
  }
  async function review(driver,action,button){
    button.disabled=true;
    try{
      // The server-side activation action owns the full compliance checklist.
      // "approve" is a UI label; the API contract is "activate".
      const apiAction=action==='approve'?'activate':action;
      const result=await call('POST',{user_id:driver.user_id,action:apiAction});
      await load();
      status.textContent=action==='approve'?'Driver approved and activated.':'Driver status updated.';
    }
    catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  async function reviewDocument(driver,doc,reviewStatus,button){
    button.disabled=true;
    try{
      await call('POST',{action:'review_document',user_id:driver.user_id,document_id:doc.id,review_status:reviewStatus==='accepted'?'approved':reviewStatus});
      await load();status.textContent='Document review saved.';
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  function render(driver){
    const card=document.createElement('article');card.className='order';
    const title=document.createElement('h3');title.textContent=driver.user_profiles?.full_name||'Driver applicant';
    const details=document.createElement('p');
    details.textContent=[driver.phone,driver.license_number?'Licence '+driver.license_number:'Licence missing',driver.license_expiry?'Expires '+driver.license_expiry:'Expiry missing',String(driver.vehicle_type||'Vehicle missing').toUpperCase(),driver.vehicle_registration||'Registration missing'].join(' · ');
    const state=document.createElement('p');state.textContent='Verification: '+driver.verification_status+' · Onboarding: '+(driver.onboarding_status||'not started');
    const accountId=document.createElement('p');accountId.className='driver-account-id';
    accountId.textContent='Driver account ID: '+String(driver.user_id||'Unavailable');
    card.append(title,details,state,accountId);
    const copyId=document.createElement('button');copyId.type='button';copyId.textContent='Copy driver account ID';
    copyId.disabled=!driver.user_id;
    copyId.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(String(driver.user_id));status.textContent='Driver account ID copied.';}catch{status.textContent='Copy unavailable. Select the account ID shown on the driver profile.';}});
    card.append(copyId);
    const reviewPanel=document.createElement('details');reviewPanel.className='driver-review-details';
    const reviewSummary=document.createElement('summary');reviewSummary.textContent='View driver details & verification documents';
    reviewPanel.append(reviewSummary);
    card.append(reviewPanel);
    const app=driver.application;
    const profileTitle=document.createElement('strong');profileTitle.textContent='Application profile';reviewPanel.append(profileTitle);
    const profileRows=[];
    if(app){
      const identity=app.identity_details||{},licence=app.licence_details||{},vehicle=app.vehicle_details||{},bank=app.banking_details||{};
      const mask=value=>{const s=String(value||'');return s.length>4?'••••'+s.slice(-4):s?'••••':'Not supplied';};
      profileRows.push('Identity: '+(app.identity_type||identity.citizenship||'Not supplied'));
      profileRows.push('Date of birth: '+(identity.date_of_birth||'Not supplied'));
      profileRows.push('Contact: '+(identity.phone||driver.phone||'Not supplied')+' · '+(identity.email||'Email not supplied'));
      if(identity.id_number)profileRows.push('SA ID: '+mask(identity.id_number));
      if(identity.passport_number)profileRows.push('Passport: '+mask(identity.passport_number));
      profileRows.push('Licence: '+(licence.code||driver.licence_code||'Not supplied')+' · Expires '+(licence.expiry||driver.license_expiry||'Not supplied'));
      profileRows.push('PrDP: '+(licence.prdp_holder?'Yes':'No / not declared')+(licence.prdp_category?' · '+licence.prdp_category:'')+(licence.prdp_expiry?' · Expires '+licence.prdp_expiry:''));
      profileRows.push('Vehicle: '+[vehicle.make,vehicle.model,vehicle.year,vehicle.type].filter(Boolean).join(' ')+' · Registration '+(vehicle.registration_plate||driver.vehicle_registration||'Not supplied'));
      profileRows.push('Bank: '+(bank.bank_name||'Not supplied')+' · Account holder '+(bank.account_holder||'Not supplied')+' · '+(bank.account_type||'Type not supplied')+' · Account '+mask(bank.account_number));
      profileRows.push('Application submitted: '+(app.submitted_at?new Date(app.submitted_at).toLocaleString():'Date unavailable'));
      if(app.review_note)profileRows.push('Review note: '+app.review_note);
    }else profileRows.push('No completed onboarding application has been submitted by this driver yet.');
    for(const value of profileRows){const row=document.createElement('p');row.textContent=value;reviewPanel.append(row);}
    const docsTitle=document.createElement('strong');docsTitle.textContent='Verification documents';
    reviewPanel.append(docsTitle);
    const docs=driver.documents||[];
    if(!docs.length){const missing=document.createElement('p');missing.textContent='No documents uploaded yet.';reviewPanel.append(missing);}
    for(const doc of docs){
      const row=document.createElement('p');
      row.textContent=doc.document_type.replaceAll('_',' ')+' · '+doc.review_status+' · '+doc.original_name+' ';
      if(doc.signed_url){const link=document.createElement('a');link.href=doc.signed_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View securely';row.append(link);}
      reviewPanel.append(row);
      if(doc.review_status!=='accepted'){
        const accept=document.createElement('button');accept.type='button';accept.textContent='Accept document';
        accept.addEventListener('click',()=>reviewDocument(driver,doc,'accepted',accept));reviewPanel.append(accept);
      }
      if(doc.review_status!=='rejected'){
        const reject=document.createElement('button');reject.type='button';reject.textContent='Reject document';
        reject.addEventListener('click',()=>reviewDocument(driver,doc,'rejected',reject));reviewPanel.append(reject);
      }
    }
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>review(driver,action,b));reviewPanel.append(b);};
    if(driver.verification_status!=='approved')button('Approve driver','approve');
    if(driver.verification_status!=='rejected')button('Reject application','reject');
    if(driver.verification_status==='approved')button('Suspend driver','suspend');
    list.append(card);
  }
  qualityFilter.addEventListener('change',()=>{if(active)isAdmin&&load();});
  refresh.addEventListener('click',load);
  document.addEventListener('account-ready',event=>{
    active=true;isAdmin=event.detail.role==='admin';
    if(!isAdmin){status.textContent='Only company administrators can approve driver applications.';return;}
    load();
  });
  document.addEventListener('account-cleared',()=>{active=false;isAdmin=false;epoch++;list.replaceChildren();status.textContent='';});
}

})();

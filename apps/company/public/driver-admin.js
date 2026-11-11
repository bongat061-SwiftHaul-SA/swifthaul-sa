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
    if(action==='approve'){
      const required=['id_document','proof_of_address','bank_confirmation','drivers_licence','vehicle_document'];
      const missing=required.filter(type=>!(driver.documents||[]).some(doc=>doc.document_type===type&&doc.review_status==='accepted'));
      if(missing.length){status.textContent='Approval blocked. Accept these documents first: '+missing.map(type=>type.replaceAll('_',' ')).join(', ')+'.';return;}
    }
    button.disabled=true;
    try{await call('POST',{user_id:driver.user_id,action});await load();status.textContent='Driver status updated.';}
    catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  async function reviewDocument(driver,doc,reviewStatus,button){
    button.disabled=true;
    try{
      await call('POST',{action:'review_document',user_id:driver.user_id,document_id:doc.id,review_status:reviewStatus});
      await load();status.textContent='Document review saved.';
    }catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  function render(driver){
    const card=document.createElement('article');card.className='order';
    const title=document.createElement('h3');title.textContent=driver.user_profiles?.full_name||'Driver applicant';
    const details=document.createElement('p');
    details.textContent=[driver.phone,driver.license_number?'Licence '+driver.license_number:'Licence missing',driver.license_expiry?'Expires '+driver.license_expiry:'Expiry missing',String(driver.vehicle_type||'Vehicle missing').toUpperCase(),driver.vehicle_registration||'Registration missing'].join(' · ');
    const state=document.createElement('p');state.textContent='Verification: '+driver.verification_status;
    card.append(title,details,state);
    const docsTitle=document.createElement('strong');docsTitle.textContent='Verification documents';
    card.append(docsTitle);
    const docs=driver.documents||[];
    if(!docs.length){const missing=document.createElement('p');missing.textContent='No documents uploaded yet.';card.append(missing);}
    for(const doc of docs){
      const row=document.createElement('p');
      row.textContent=doc.document_type.replaceAll('_',' ')+' · '+doc.review_status+' · '+doc.original_name+' ';
      if(doc.signed_url){const link=document.createElement('a');link.href=doc.signed_url;link.target='_blank';link.rel='noopener noreferrer';link.textContent='View securely';row.append(link);}
      card.append(row);
      if(doc.review_status!=='accepted'){
        const accept=document.createElement('button');accept.type='button';accept.textContent='Accept document';
        accept.addEventListener('click',()=>reviewDocument(driver,doc,'accepted',accept));card.append(accept);
      }
      if(doc.review_status!=='rejected'){
        const reject=document.createElement('button');reject.type='button';reject.textContent='Reject document';
        reject.addEventListener('click',()=>reviewDocument(driver,doc,'rejected',reject));card.append(reject);
      }
    }
    const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>review(driver,action,b));card.append(b);};
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

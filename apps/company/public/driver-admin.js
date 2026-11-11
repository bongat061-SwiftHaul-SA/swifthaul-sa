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
    if(action==='approve'){
      const app=driver.application;
      const required=app?[
        ...(app.identity_type==='sa_citizen'?['id_front','id_back','profile_selfie']:['passport','work_permit']),
        'licence_front','licence_back','vehicle_licence_disc','vehicle_insurance','proof_of_address'
      ]:['id_document','proof_of_address','bank_confirmation','drivers_licence','vehicle_document'];
      const missing=required.filter(type=>!(driver.documents||[]).some(doc=>doc.document_type===type&&doc.review_status==='accepted'));
      if(app&&!(driver.documents||[]).some(doc=>['enatis_certificate','fleet_lease_agreement'].includes(doc.document_type)&&doc.review_status==='accepted'))missing.push('enatis certificate or fleet lease agreement');
      if(app?.licence_details?.prdp_holder&&!(driver.documents||[]).some(doc=>doc.document_type==='prdp'&&doc.review_status==='accepted'))missing.push('PrDP');
      if(app&&(!app.banking_details?.bank_name||!app.banking_details?.account_holder||!app.banking_details?.account_number))missing.push('banking details');
      if(missing.length){status.textContent='Approval blocked. Accept/complete: '+missing.map(type=>type.replaceAll('_',' ')).join(', ')+'.';return;}
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
    if(driver.application){
      const app=driver.application,summary=document.createElement('p');
      const identity=app.identity_details||{},licence=app.licence_details||{},vehicle=app.vehicle_details||{},bank=app.banking_details||{};
      summary.textContent=[
        'Applicant type: '+app.identity_type,
        'DOB: '+(identity.date_of_birth||'—'),
        'SA ID / Passport: '+(identity.id_number||identity.passport_number||'—'),
        'TRN: '+(identity.traffic_register_number||'—'),
        'Licence: '+(licence.code||'—')+' · expires '+(licence.expiry||'—'),
        'PrDP: '+(licence.prdp_holder?(licence.prdp_category+' · expires '+licence.prdp_expiry):'Not declared'),
        'Vehicle: '+[vehicle.make,vehicle.model,vehicle.year,vehicle.type,vehicle.registration_plate,vehicle.gross_vehicle_mass_kg?vehicle.gross_vehicle_mass_kg+' kg':''].filter(Boolean).join(' · '),
        'Bank: '+(bank.bank_name||'—')+' · '+(bank.account_holder||'—')+' · account '+(bank.account_number||'—')+' · branch '+(bank.universal_branch_code||'—'),
        'Application submitted: '+(app.submitted_at||'—')
      ].join(' | ');
      card.append(summary);
    }
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
  refresh.addEventListener('click',load);
  document.addEventListener('account-ready',event=>{
    active=true;isAdmin=event.detail.role==='admin';
    if(!isAdmin){status.textContent='Only company administrators can approve driver applications.';return;}
    load();
  });
  document.addEventListener('account-cleared',()=>{active=false;isAdmin=false;epoch++;list.replaceChildren();status.textContent='';});
}

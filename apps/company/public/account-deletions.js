(() => {
  const root=document.querySelector('body[data-app="company"] #workspace .page');
  if(!root)return;
  const panel=document.createElement('section');
  panel.id='account-deletions';panel.className='panel';panel.hidden=true;
  panel.innerHTML='<h2>Account deletion requests</h2><p class="subtle">Review requests from Customers and Drivers. Approval does not immediately delete an account: active deliveries, wallet balances, payouts and legally required records must be reconciled first.</p><button type="button" id="refresh-account-deletions">Refresh requests</button><p id="account-deletions-status" role="status" aria-live="polite">Sign in as a company administrator to review requests.</p><div id="account-deletions-list" class="operations-list"></div>';
  root.append(panel);
  const status=panel.querySelector('#account-deletions-status'),list=panel.querySelector('#account-deletions-list');
  let active=false,epoch=0;
  async function call(method,body){
    const client=window.swiftHaulSupabase;
    if(!client)throw Error('Secure account connection is unavailable.');
    const {data,error}=await client.functions.invoke('account-deletion-admin',{method,...(body?{body}:{})});
    if(error)throw Error(data?.error||error.message||'Account deletion review failed.');
    if(data?.error)throw Error(data.error);
    return data||{};
  }
  async function load(){
    if(!active)return;
    const current=++epoch;status.textContent='Loading deletion requests…';
    try{
      const data=await call('GET');if(current!==epoch)return;list.replaceChildren();
      if(!data.requests?.length){status.textContent='No open account deletion requests.';return;}
      data.requests.forEach(render);status.textContent=data.requests.length+' open request(s).';
    }catch(error){if(current===epoch)status.textContent=error.message;}
  }
  async function review(request,action,button){
    const prompt=action==='approve'
      ?'Approve this request for closure after financial and legal reconciliation? The account will NOT be deleted automatically.'
      :action==='reject'?'Reject this account deletion request?':'Move this request into review?';
    if(!confirm(prompt))return;
    button.disabled=true;
    try{const result=await call('POST',{request_id:request.id,action});await load();status.textContent=result.message||'Review status saved.';}
    catch(error){status.textContent=error.message;}
    finally{button.disabled=false;}
  }
  function render(request){
    const card=document.createElement('article');card.className='order';
    const title=document.createElement('h3');title.textContent=request.full_name+' · '+request.app_type.toUpperCase();
    const details=document.createElement('p');details.textContent=[request.email,request.phone,request.status,'Requested '+new Date(request.requested_at).toLocaleString()].filter(Boolean).join(' · ');
    const reason=document.createElement('p');reason.textContent=request.reason?'Reason: '+request.reason:'No reason supplied.';
    const warning=document.createElement('p');warning.textContent='Account status: '+request.account_status+'. Approval only authorizes the controlled closure process; it does not delete the account.';
    card.append(title,details,reason,warning);
    const add=(label,action)=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',()=>review(request,action,button));card.append(button);};
    if(request.status==='pending')add('Start review','start_review');
    add('Approve for closure review','approve');add('Reject request','reject');
    list.append(card);
  }
  panel.querySelector('#refresh-account-deletions').addEventListener('click',load);
  document.addEventListener('account-ready',event=>{active=event.detail?.role==='admin';if(active)load();else status.textContent='Only active Company Admin accounts can review deletion requests.';});
  document.addEventListener('account-cleared',()=>{active=false;epoch++;list.replaceChildren();status.textContent='';});
})();

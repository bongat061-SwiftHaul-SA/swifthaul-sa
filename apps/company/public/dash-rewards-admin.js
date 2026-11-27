(() => {
 const panel=document.getElementById('dash-rewards-admin'),queue=document.getElementById('dash-rewards-queue'),status=document.getElementById('dash-rewards-admin-status');
 if(!panel||!queue)return;

 const money=cents=>'R'+(Number(cents||0)/100).toFixed(2);
 const cashoutPanel=document.createElement('section');cashoutPanel.className='panel';cashoutPanel.style.marginTop='18px';cashoutPanel.innerHTML='<h3>R150 customer cash-out requests</h3><p class="subtle">Verify the customer and points balance. Make the bank transfer manually, then record its payment reference here. Rejecting a request returns the points to the customer.</p><div id="dash-cashout-queue">Loading cash-out requests…</div>';panel.append(cashoutPanel);
 const cashoutQueue=cashoutPanel.querySelector('#dash-cashout-queue');
 async function loadCashouts(client){
  cashoutQueue.textContent='Loading cash-out requests…';
  try{
   const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'list_cashouts'}});if(error)throw error;
   const rows=data?.pending_cashouts||[];cashoutQueue.replaceChildren();
   if(!rows.length){const p=document.createElement('p');p.className='subtle';p.textContent='No cash-out requests are waiting for review.';cashoutQueue.append(p);return;}
   rows.forEach(row=>{
    const card=document.createElement('article');card.className='panel';card.style.margin='10px 0';
    const title=document.createElement('h4');title.textContent=(row.customer_name||'Customer')+' · R150.00';card.append(title);
    const meta=document.createElement('p');meta.className='subtle';meta.textContent=(row.customer_email||row.user_id)+' · '+Number(row.points_snapshot).toLocaleString()+' points · Requested '+new Date(row.requested_at).toLocaleString('en-ZA');card.append(meta);
    const note=document.createElement('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional admin note';note.style.width='100%';card.append(note);
    const ref=document.createElement('input');ref.type='text';ref.maxLength=120;ref.placeholder='Cleared bank payment reference (required to mark paid)';ref.style.width='100%';card.append(ref);
    const actions=document.createElement('div');actions.className='driver-dash-controls';
    const paid=document.createElement('button');paid.type='button';paid.className='primary';paid.textContent='Mark R150 paid';
    const reject=document.createElement('button');reject.type='button';reject.textContent='Reject & return points';
    const review=async(decision)=>{paid.disabled=true;reject.disabled=true;try{if(decision==='paid'&&!ref.value.trim())throw new Error('Enter the cleared bank payment reference first.');const {error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'review_cashout',cashout_id:row.id,decision,payout_reference:ref.value.trim(),note:note.value}});if(error)throw error;status.textContent=decision==='paid'?'Cash-out marked paid. Customer points reset after recording payment.':'Cash-out rejected. Customer points remain available.';await load();}catch(e){status.textContent=e.message||'Could not save cash-out review.';paid.disabled=false;reject.disabled=false;}};
    paid.addEventListener('click',()=>review('paid'));reject.addEventListener('click',()=>review('reject'));actions.append(paid,reject);card.append(actions);cashoutQueue.append(card);
   });
  }catch(e){cashoutQueue.textContent='Unable to load cash-out requests.';status.textContent=e?.message||'Cash-out service unavailable.';}
 }
 async function load(){
  queue.textContent='Loading pending reward milestones…';status.textContent='';
  try{
   const client=window.swiftHaulSupabase;if(!client)throw new Error('Admin sign-in is still loading.');
   const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'list_pending'}});
   await loadCashouts(client);
   if(error)throw error;
   const rows=data?.pending||[];queue.replaceChildren();
   if(!rows.length){const p=document.createElement('p');p.className='subtle';p.textContent='No reward milestones are waiting for verification.';queue.append(p);return;}
   rows.forEach(row=>{
    const card=document.createElement('article');card.className='panel';card.style.margin='12px 0';
    const title=document.createElement('h3');title.textContent=row.customer_name+' · '+row.milestone_points.toLocaleString()+' points';card.append(title);
    const meta=document.createElement('p');meta.className='subtle';meta.textContent=row.customer_email+' · Cycle '+row.cycle_number+' · Reward '+money(row.reward_cents)+' · Submitted '+new Date(row.created_at).toLocaleString('en-ZA');card.append(meta);
    const rounds=document.createElement('div');rounds.className='table-wrap';const table=document.createElement('table');const thead=document.createElement('thead');thead.innerHTML='<tr><th>Round</th><th>Score</th><th>Submitted</th></tr>';table.append(thead);const tbody=document.createElement('tbody');
    (row.rounds||[]).forEach((r,i)=>{const tr=document.createElement('tr');[String(i+1),String(r.score??0),r.submitted_at?new Date(r.submitted_at).toLocaleString('en-ZA'):'—'].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});tbody.append(tr)});
    table.append(tbody);rounds.append(table);card.append(rounds);
    const note=document.createElement('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional verification note';note.style.width='100%';note.style.marginTop='10px';card.append(note);
    const actions=document.createElement('div');actions.className='driver-dash-controls';
    const approve=document.createElement('button');approve.type='button';approve.className='primary';approve.textContent='Approve '+money(row.reward_cents);
    const reject=document.createElement('button');reject.type='button';reject.textContent='Reject';
    async function review(decision,button){approve.disabled=true;reject.disabled=true;status.textContent='Saving verification…';try{const client=window.swiftHaulSupabase;if(!client)throw new Error('Admin sign-in is still loading.');const {error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'review_milestone',milestone_id:row.id,decision,note:note.value}});if(error)throw error;status.textContent=decision==='approve'?'Milestone approved. Voucher issued.':'Milestone rejected.';await load();}catch{status.textContent='Could not save the review. Please refresh and retry.';approve.disabled=false;reject.disabled=false;}}
    approve.addEventListener('click',()=>review('approve',approve));reject.addEventListener('click',()=>review('reject',reject));actions.append(approve,reject);card.append(actions);queue.append(card);
   });
  }catch(e){queue.textContent='Unable to load rewards. Confirm that you are signed in with an active Admin account.';status.textContent=e?.message||'Rewards service unavailable.';}
 }
 document.addEventListener('account-ready',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 document.querySelectorAll('.section-links a[data-page="dash-rewards"]').forEach(a=>a.addEventListener('click',()=>load()));
 window.addEventListener('popstate',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 if(new URLSearchParams(location.search).get('page')==='dash-rewards')load();
})();
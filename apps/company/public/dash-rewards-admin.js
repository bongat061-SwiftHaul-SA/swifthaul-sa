(() => {
 const panel=document.getElementById('dash-rewards-admin'),queue=document.getElementById('dash-rewards-queue'),status=document.getElementById('dash-rewards-admin-status');
 if(!panel||!queue)return;
 const money=cents=>'R'+(Number(cents||0)/100).toFixed(2);
 const makePanel=(title,description,id)=>{const section=document.createElement('section');section.className='panel';section.style.marginTop='18px';const h=document.createElement('h3');h.textContent=title;section.append(h);if(description){const p=document.createElement('p');p.className='subtle';p.textContent=description;section.append(p)}const body=document.createElement('div');body.id=id;body.textContent='Loading…';section.append(body);panel.append(section);return body};
 const claims=makePanel('Dash Rewards voucher requests','Customers request a voucher after reaching an approved points milestone. Approving a request deducts the points and issues the single-use voucher.','dash-voucher-claims');
 const cashouts=makePanel('R150 customer cash-out requests','Verify the customer and points balance. Make the bank transfer manually, then record its cleared payment reference. Never put bank account details in Admin notes. Rejecting returns the points.','dash-cashout-queue');
 const client=()=>{if(!window.swiftHaulSupabase)throw new Error('Admin sign-in is still loading.');return window.swiftHaulSupabase};
 const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n};
 async function invoke(action,extra={}){const {data,error}=await client().functions.invoke('customer-dash-rewards',{body:{action,...extra}});if(error)throw error;return data}
 async function loadRounds(){
  queue.textContent='Loading submitted Driver Dash rounds…';
  try{
   const data=await invoke('list_pending'),rows=data?.pending||[];queue.replaceChildren();
   if(!rows.length){queue.append(el('p','No submitted rounds are waiting for verification.','subtle'));return}
   rows.forEach(row=>{
    const card=el('article',undefined,'panel');card.style.margin='12px 0';
    card.append(el('h3',(row.customer_name||'Customer')+' · Score '+Number(row.score||0)));
    card.append(el('p',(row.customer_email||'')+' · Submitted '+(row.submitted_at?new Date(row.submitted_at).toLocaleString('en-ZA'):'—'),'subtle'));
    const note=el('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional verification note';note.style.width='100%';card.append(note);
    const actions=el('div',undefined,'driver-dash-controls');
    const approve=el('button','Approve verified round','primary'),reject=el('button','Reject round');
    const review=async(decision)=>{approve.disabled=reject.disabled=true;status.textContent='Saving round review…';try{await invoke('review_round',{round_id:row.id,decision,note:note.value});status.textContent=decision==='approve'?'Round approved. Verified points and any eligible milestone have been recorded.':'Round rejected; no points were credited.';await load()}catch(e){status.textContent=e?.message||'Round review failed.';approve.disabled=reject.disabled=false}};
    approve.addEventListener('click',()=>review('approve'));reject.addEventListener('click',()=>review('reject'));actions.append(approve,reject);card.append(actions);queue.append(card);
   });
  }catch(e){queue.textContent='Unable to load submitted rounds.';status.textContent=e?.message||'Rewards service unavailable.'}
 }
 async function loadClaims(){
  claims.textContent='Loading voucher requests…';
  try{
   const data=await invoke('list_pending_voucher_claims'),rows=data?.pending_voucher_claims||[];claims.replaceChildren();
   if(!rows.length){claims.append(el('p','No voucher requests are waiting for Admin review.','subtle'));return}
   rows.forEach(row=>{
    const card=el('article',undefined,'panel');card.style.margin='10px 0';
    card.append(el('h4',(row.customer_name||'Customer')+' · '+Number(row.milestone_points).toLocaleString()+' points'));
    card.append(el('p',(row.customer_email||'')+' · Reward '+money(row.reward_cents)+' · Requested '+(row.claim_requested_at?new Date(row.claim_requested_at).toLocaleString('en-ZA'):'—'),'subtle'));
    const note=el('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional verification note';note.style.width='100%';card.append(note);
    const actions=el('div',undefined,'driver-dash-controls');
    const approve=el('button','Approve & issue voucher','primary'),reject=el('button','Reject request');
    const review=async(decision)=>{approve.disabled=reject.disabled=true;status.textContent='Saving voucher review…';try{const result=await invoke('review_voucher_claim',{milestone_id:row.id,decision,note:note.value});status.textContent=decision==='approve'?'Voucher issued and points deducted ('+(result?.result?.voucher_code||'code generated')+').':'Voucher request rejected; points remain available.';await load()}catch(e){status.textContent=e?.message||'Voucher review failed.';approve.disabled=reject.disabled=false}};
    approve.addEventListener('click',()=>review('approve'));reject.addEventListener('click',()=>review('reject'));actions.append(approve,reject);card.append(actions);claims.append(card);
   });
  }catch(e){claims.textContent='Unable to load voucher requests.';status.textContent=e?.message||'Voucher review service unavailable.'}
 }
 async function loadCashouts(){
  cashouts.textContent='Loading cash-out requests…';
  try{
   const data=await invoke('list_cashouts'),rows=data?.pending_cashouts||[];cashouts.replaceChildren();
   if(!rows.length){cashouts.append(el('p','No cash-out requests are waiting for review.','subtle'));return}
   rows.forEach(row=>{
    const card=el('article',undefined,'panel');card.style.margin='10px 0';
    card.append(el('h4',(row.customer_name||'Customer')+' · R150.00'));
    card.append(el('p',(row.customer_email||'')+' · '+Number(row.points_snapshot).toLocaleString()+' points · Requested '+new Date(row.requested_at).toLocaleString('en-ZA'),'subtle'));
    const note=el('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional Admin note';note.style.width='100%';card.append(note);
    const reference=el('input');reference.type='text';reference.maxLength=120;reference.placeholder='Cleared bank payment reference (required to mark paid)';reference.style.width='100%';card.append(reference);
    const actions=el('div',undefined,'driver-dash-controls'),paid=el('button','Mark R150 paid','primary'),reject=el('button','Reject & return points');
    const review=async(decision)=>{paid.disabled=reject.disabled=true;try{if(decision==='paid'&&!reference.value.trim())throw new Error('Enter the cleared bank payment reference first.');await invoke('review_cashout',{cashout_id:row.id,decision,payout_reference:reference.value.trim(),note:note.value});status.textContent=decision==='paid'?'Cash-out marked paid; unused points forfeited as agreed.':'Cash-out rejected; points remain available.';await load()}catch(e){status.textContent=e?.message||'Cash-out review failed.';paid.disabled=reject.disabled=false}};
    paid.addEventListener('click',()=>review('paid'));reject.addEventListener('click',()=>review('reject'));actions.append(paid,reject);card.append(actions);cashouts.append(card);
   });
  }catch(e){cashouts.textContent='Unable to load cash-out requests.';status.textContent=e?.message||'Cash-out service unavailable.'}
 }
 async function load(){status.textContent='';await Promise.all([loadRounds(),loadClaims(),loadCashouts()])}
 document.addEventListener('account-ready',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 document.querySelectorAll('.section-links a[data-page="dash-rewards"]').forEach(a=>a.addEventListener('click',()=>load()));
 window.addEventListener('popstate',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 if(new URLSearchParams(location.search).get('page')==='dash-rewards')load();
})();
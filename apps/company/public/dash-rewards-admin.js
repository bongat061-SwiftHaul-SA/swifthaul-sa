(() => {
 const panel=document.getElementById('dash-rewards-admin'),queue=document.getElementById('dash-rewards-queue'),status=document.getElementById('dash-rewards-admin-status');
 if(!panel||!queue)return;
 const client=window.swiftHaulSupabase;
 const money=cents=>'R'+(Number(cents||0)/100).toFixed(2);
 async function load(){
  queue.textContent='Loading pending reward milestones…';status.textContent='';
  try{
   const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'list_pending'}});
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
    async function review(decision,button){approve.disabled=true;reject.disabled=true;status.textContent='Saving verification…';try{const {error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'review_milestone',milestone_id:row.id,decision,note:note.value}});if(error)throw error;status.textContent=decision==='approve'?'Milestone approved. Voucher issued.':'Milestone rejected.';await load();}catch{status.textContent='Could not save the review. Please refresh and retry.';approve.disabled=false;reject.disabled=false;}}
    approve.addEventListener('click',()=>review('approve',approve));reject.addEventListener('click',()=>review('reject',reject));actions.append(approve,reject);card.append(actions);queue.append(card);
   });
  }catch(e){queue.textContent='Unable to load rewards. Confirm that you are signed in with an active Admin account.';status.textContent=e?.message||'Rewards service unavailable.';}
 }
 document.addEventListener('DOMContentLoaded',()=>{if(location.search.includes('page=dash-rewards'))load()});
 document.querySelectorAll('.section-links a[data-page="dash-rewards"]').forEach(a=>a.addEventListener('click',()=>load()));
 window.addEventListener('popstate',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 if(new URLSearchParams(location.search).get('page')==='dash-rewards')load();
})();
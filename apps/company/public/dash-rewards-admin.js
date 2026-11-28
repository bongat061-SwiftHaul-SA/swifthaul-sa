(() => {
 'use strict';
 const panel=document.getElementById('dash-rewards-admin');
 const queue=document.getElementById('dash-rewards-queue');
 const status=document.getElementById('dash-rewards-admin-status');
 if(!panel||!queue||!status)return;

 const money=cents=>'R'+(Number(cents||0)/100).toFixed(2);
 const makeSection=(id,title,description)=>{
  let el=panel.querySelector('#'+id);
  if(!el){el=document.createElement('section');el.id=id;el.className='panel';el.style.marginTop='18px';panel.append(el);}
  el.replaceChildren();
  const h=document.createElement('h3');h.textContent=title;el.append(h);
  if(description){const p=document.createElement('p');p.className='subtle';p.textContent=description;el.append(p);}
  const body=document.createElement('div');body.id=id+'-list';el.append(body);
  return body;
 };
 const notifications=makeSection('dash-rewards-notifications','Customer reward claims & notifications','Customers claim vouchers themselves or request cash-out. These requests appear here for Admin visibility; voucher claims do not require Admin to claim or issue the reward on the customer’s behalf.');
 const cashoutQueue=makeSection('dash-rewards-cashouts','R150 cash-out requests','Verify the request, make the R150 bank transfer manually, then record the cleared payment reference. Rejecting a request leaves the customer’s points available.');
 const empty=(target,message)=>{const p=document.createElement('p');p.className='subtle';p.textContent=message;target.append(p);};
 async function loadNotifications(client){
  notifications.textContent='Loading customer notifications…';
  const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'list_admin_notifications'}});
  if(error)throw error;
  const rows=data?.notifications||[];notifications.replaceChildren();
  if(!rows.length){empty(notifications,'No new customer reward claims or cash-out requests.');return;}
  rows.forEach(row=>{
   const card=document.createElement('article');card.className='panel';card.style.margin='10px 0';
   const h=document.createElement('h4');h.textContent=row.title;card.append(h);
   const meta=document.createElement('p');meta.className='subtle';meta.textContent=(row.customer_name||'Customer')+' · '+(row.customer_email||row.customer_user_id)+' · '+new Date(row.created_at).toLocaleString('en-ZA');card.append(meta);
   const msg=document.createElement('p');msg.textContent=row.message;card.append(msg);
   if(row.read_at){const read=document.createElement('small');read.textContent='Read';card.append(read);}
   else{
    const button=document.createElement('button');button.type='button';button.textContent='Mark as read';
    button.addEventListener('click',async()=>{button.disabled=true;try{const {error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'mark_admin_notification_read',notification_id:row.id}});if(error)throw error;await loadNotifications(client);}catch{button.disabled=false;status.textContent='Could not update this notification.';}});
    card.append(button);
   }
   notifications.append(card);
  });
 }
 async function loadCashouts(client){
  cashoutQueue.textContent='Loading cash-out requests…';
  const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'list_cashouts'}});
  if(error)throw error;
  const rows=data?.pending_cashouts||[];cashoutQueue.replaceChildren();
  if(!rows.length){empty(cashoutQueue,'No cash-out requests are waiting for review.');return;}
  rows.forEach(row=>{
   const card=document.createElement('article');card.className='panel';card.style.margin='10px 0';
   const title=document.createElement('h4');title.textContent=(row.customer_name||'Customer')+' · R150.00';card.append(title);
   const meta=document.createElement('p');meta.className='subtle';meta.textContent=(row.customer_email||row.user_id)+' · '+Number(row.points_snapshot).toLocaleString()+' unused points · Requested '+new Date(row.requested_at).toLocaleString('en-ZA');card.append(meta);
   const note=document.createElement('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional Admin note';note.style.width='100%';card.append(note);
   const ref=document.createElement('input');ref.type='text';ref.maxLength=120;ref.placeholder='Cleared bank payment reference (required to mark paid)';ref.style.width='100%';card.append(ref);
   const actions=document.createElement('div');actions.className='driver-dash-controls';
   const paid=document.createElement('button');paid.type='button';paid.className='primary';paid.textContent='Mark R150 paid';
   const reject=document.createElement('button');reject.type='button';reject.textContent='Reject & return points';
   const review=async(decision)=>{
    paid.disabled=true;reject.disabled=true;
    try{
     if(decision==='paid'&&!ref.value.trim())throw new Error('Enter the cleared bank payment reference first.');
     const {error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'review_cashout',cashout_id:row.id,decision,payout_reference:ref.value.trim(),note:note.value}});
     if(error)throw error;
     status.textContent=decision==='paid'?'Cash-out marked paid. Unused points and unclaimed milestones have been forfeited.':'Cash-out rejected. Customer points remain available.';
     await load();
    }catch(e){status.textContent=e?.message||'Could not save cash-out review.';paid.disabled=false;reject.disabled=false;}
   };
   paid.addEventListener('click',()=>review('paid'));reject.addEventListener('click',()=>review('reject'));actions.append(paid,reject);card.append(actions);cashoutQueue.append(card);
  });
 }
 async function load(){
  queue.textContent='Loading submitted game rounds…';status.textContent='';
  try{
   const client=window.swiftHaulSupabase;if(!client)throw new Error('Admin sign-in is still loading.');
   const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'list_pending'}});
   if(error)throw error;
   const rows=data?.pending||[];queue.replaceChildren();
   if(!rows.length)empty(queue,'No submitted game rounds are waiting for verification.');
   rows.forEach(row=>{
    const card=document.createElement('article');card.className='panel';card.style.margin='12px 0';
    const title=document.createElement('h3');title.textContent=(row.customer_name||'Customer')+' · '+Number(row.score||0).toLocaleString()+' game points';card.append(title);
    const meta=document.createElement('p');meta.className='subtle';meta.textContent=(row.customer_email||row.user_id)+' · Cycle '+(row.cycle_number||'—')+' · Submitted '+(row.submitted_at?new Date(row.submitted_at).toLocaleString('en-ZA'):'—');card.append(meta);
    const note=document.createElement('textarea');note.rows=2;note.maxLength=500;note.placeholder='Optional verification note';note.style.width='100%';note.style.marginTop='10px';card.append(note);
    const actions=document.createElement('div');actions.className='driver-dash-controls';
    const approve=document.createElement('button');approve.type='button';approve.className='primary';approve.textContent='Approve round & credit points';
    const reject=document.createElement('button');reject.type='button';reject.textContent='Reject round';
    const review=async(decision)=>{
     approve.disabled=true;reject.disabled=true;status.textContent='Saving round verification…';
     try{
      const {data,error}=await client.functions.invoke('customer-dash-rewards',{body:{action:'review_round',round_id:row.id,decision,note:note.value}});
      if(error)throw error;
      const credited=Number(data?.result?.points_credited||0);
      status.textContent=decision==='approve'?'Round approved. '+credited.toLocaleString()+' verified points credited; customer reward milestones updated.':'Round rejected. No points were credited.';
      await load();
     }catch(e){status.textContent=e?.message||'Could not save round review. Refresh and retry.';approve.disabled=false;reject.disabled=false;}
    };
    approve.addEventListener('click',()=>review('approve'));reject.addEventListener('click',()=>review('reject'));actions.append(approve,reject);card.append(actions);queue.append(card);
   });
   await Promise.all([loadNotifications(client),loadCashouts(client)]);
  }catch(e){queue.textContent='Unable to load submitted rounds. Confirm that you are signed in with an active Admin account.';status.textContent=e?.message||'Rewards service unavailable.';}
 }
 document.addEventListener('account-ready',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 document.querySelectorAll('.section-links a[data-page="dash-rewards"]').forEach(a=>a.addEventListener('click',()=>load()));
 window.addEventListener('popstate',()=>{if(new URLSearchParams(location.search).get('page')==='dash-rewards')load()});
 if(new URLSearchParams(location.search).get('page')==='dash-rewards')load();
})();
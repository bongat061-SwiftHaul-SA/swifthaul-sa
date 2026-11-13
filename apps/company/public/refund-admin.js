(() => {
const panel=document.getElementById('refunds');
if(panel){
  const refresh=document.getElementById('refund-refresh');
  const status=document.getElementById('refund-status');
  const list=document.getElementById('refund-list');
  let active=false,epoch=0,isAdmin=false;
  async function call(method,body){
    const client=window.swiftHaulSupabase;
    if(!client)throw new Error('Secure account connection is unavailable.');
    const {data,error}=await client.functions.invoke('refund-admin',{method,...(body?{body}:{})});
    if(error)throw new Error(data?.error||error.message||'Refund request failed.');
    if(data?.error)throw new Error(data.error);
    return data;
  }
  async function act(request,action,providerReference,button){
    button.disabled=true;status.textContent='Processing refund review…';
    try{await call('POST',{request_id:request.id,action,...(providerReference?{provider_reference:providerReference}:{})});await load();status.textContent='Refund workflow updated.';}
    catch(error){status.textContent=error.message;button.disabled=false;}
  }
  function render(request){
    const card=document.createElement('article');card.className='order';
    const title=document.createElement('h3');title.textContent=request.waybill+' · '+request.request_type;
    const booking=request.customer_bookings||{};
    const route=document.createElement('p');route.textContent=(booking.pickup||'')+' → '+(booking.dropoff||'');
    const recipient=document.createElement('p');recipient.textContent='Recipient: '+(booking.recipient||'Not available')+' · Booking status: '+(booking.status||'unknown');
    const reason=document.createElement('p');reason.textContent='Customer reason: '+request.reason;
    const amount=document.createElement('p');amount.textContent='Refund: R'+(Number(request.refund_amount_cents||0)/100).toFixed(2)+' · Source: '+request.refund_source+' · State: '+request.status;
    card.append(title,route,recipient,reason,amount);
    const button=(label,action,reference)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',()=>act(request,action,reference,b));card.append(b);};
    if(request.status==='pending'){
      button(request.refund_source==='provider'?'Approve for external refund':'Approve request','approve');
      button('Reject request','reject');
    }else if(request.status==='provider_pending'){
      const input=document.createElement('input');input.type='text';input.maxLength=200;input.placeholder='Actual PayFast/provider refund reference';input.setAttribute('aria-label','External refund reference');
      const complete=document.createElement('button');complete.type='button';complete.textContent='Confirm external refund completed';
      complete.addEventListener('click',()=>{if(input.value.trim().length<3){status.textContent='Enter the real provider refund reference first.';return;}act(request,'provider_complete',input.value.trim(),complete);});
      card.append(input,complete);
      const note=document.createElement('p');note.textContent='Do not confirm until the refund has actually been completed in the payment provider dashboard.';card.append(note);
    }
    list.append(card);
  }
  async function load(){
    if(!active||!isAdmin)return;
    const current=++epoch;status.textContent='Loading refund requests…';
    try{const data=await call('GET');if(current!==epoch)return;list.replaceChildren();
      if(!data.requests?.length){status.textContent='No cancellation or refund requests yet.';return;}
      data.requests.forEach(render);status.textContent='';
    }catch(error){if(current===epoch)status.textContent=error.message;}
  }
  refresh.addEventListener('click',load);
  document.addEventListener('account-ready',event=>{active=true;isAdmin=event.detail.role==='admin';if(isAdmin)load();else status.textContent='Only administrators can review refund requests.';});
  document.addEventListener('account-cleared',()=>{active=false;isAdmin=false;epoch++;list.replaceChildren();status.textContent='';});
}

})();

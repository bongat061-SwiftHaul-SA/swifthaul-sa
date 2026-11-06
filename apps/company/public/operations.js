const app = document.body.dataset.app;
if (app === 'driver' || app === 'company') {
  const panel = document.getElementById('dispatches');
  const heading = panel.querySelector('h2');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh deliveries';
  const list = document.createElement('div');
  list.className = 'operations-list';
  panel.replaceChildren(heading, refresh, message, list);

  let active = false;
  let requestNumber = 0;
  let draggedCard = null;
  const viewStyle=document.createElement('style');
  viewStyle.textContent='.driver-next-task{margin:12px 0;padding:14px;border-radius:13px;background:#172b49;color:#fff}.driver-next-task small{display:block;color:#a9c1ee;font-size:9px;font-weight:900;letter-spacing:1px}.driver-next-task strong{display:block;margin:5px 0;font-size:18px}.driver-next-task p{margin:4px 0 10px;color:#d2def2;font-size:11px}.driver-next-task a{display:inline-block;color:#a9c1ff;font-size:11px;font-weight:800}.dispatch-sequence-note{font-size:10px;color:#687486;padding:9px 11px;border:1px dashed #aab5c5;border-radius:10px;margin:8px 0}.dispatch-stop-tools{display:flex;align-items:center;gap:7px;margin-bottom:9px}.dispatch-stop-tools b{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#34518a;color:white;font-size:10px}.dispatch-stop-tools button{padding:6px 9px;font-size:10px}.order[draggable=true]{cursor:grab}.order.dragging{opacity:.45}.order.drag-over{outline:2px dashed #4779f4;outline-offset:3px}';
  document.head.append(viewStyle);
  const podStyle=document.createElement('style');podStyle.textContent=".pod-action-bar{margin:14px 0;padding:14px;border-radius:14px;background:#172b49;color:#fff}.pod-action-bar p{color:#d4deed;font-size:12px}.pod-action-bar button,.pod-confirm{width:100%;margin-top:8px}.pod-dialog{width:min(94vw,560px);max-height:88vh;border:0;border-radius:18px;padding:0;background:#f7f9fc;color:#172b27;box-shadow:0 18px 60px #0008}.pod-dialog::backdrop{background:#07111dcc;backdrop-filter:blur(3px)}.pod-dialog-body{padding:20px;display:grid;gap:12px;overflow:auto}.pod-dialog-body label{display:grid;gap:6px;font-size:13px;font-weight:700}.pod-dialog-body input{max-width:100%;padding:10px;border:1px solid #ccd5d0;border-radius:9px}.pod-close{justify-self:end}.pod-methods{display:grid;grid-template-columns:1fr 1fr;gap:8px}.pod-pane{display:grid;gap:10px}.pod-photo-preview{width:100%;max-height:260px;object-fit:contain;background:#e8ecea;border-radius:12px}.pod-signature{width:100%;height:180px;border:2px dashed #84968e;border-radius:12px;background:#fff;touch-action:none}.pod-confirm{background:#16834b;color:#fff;font-weight:800;padding:14px;border:0;border-radius:10px}.pod-confirm:disabled{opacity:.6}";document.head.append(podStyle);
  const money = value => 'R' + Number(value || 0).toFixed(2);
  const statusLabel = value => ({
    pending: 'Awaiting dispatch', assigned: 'Assigned', accepted: 'Accepted',
    picked_up: 'Picked up', in_transit: 'In transit', delivered: 'Delivered',
    failed: 'Failed delivery', cancelled: 'Cancelled'
  }[value] || value || 'Unknown');

  async function invoke(method, body) {
    const client = window.swiftHaulSupabase;
    if (!client) throw new Error('Secure account connection is unavailable. Reload the page.');
    const { data, error } = await client.functions.invoke('dispatch-operations', {
      method,
      ...(body ? { body } : {})
    });
    if (error) throw new Error(data?.error || error.message || 'Dispatch request failed.');
    if (data?.error) throw new Error(data.error);
    return data;
  }

  let selectedWaybills = new Set();
  async function routeInvoke(method, body) {
    const client=window.swiftHaulSupabase;
    if(!client)throw new Error('Secure account connection is unavailable.');
    const {data,error}=await client.functions.invoke('dispatch-routes',{method,...(body?{body}:{})});
    if(error)throw new Error(data?.error||error.message||'Route service unavailable.');
    if(data?.error)throw new Error(data.error);
    return data;
  }
  function renderRoutePanel(routes, orders) {
    const panelRoute=document.createElement('section');panelRoute.className='dispatch-route-panel';
    const title=document.createElement('h3');title.textContent=app==='company'?'Multi-stop route planner':'Your assigned route';
    panelRoute.append(title);
    if(app==='company'){
      const driverLabel=document.createElement('label');driverLabel.textContent='Approved driver account ID';
      const driverInput=document.createElement('input');driverInput.placeholder='Paste driver user ID';driverInput.autocomplete='off';driverLabel.append(driverInput);
      const help=document.createElement('p');help.textContent='Select pending deliveries below, then create a route. Each delivery is inserted as pickup followed by drop-off. Up to 15 deliveries per route.';
      const create=document.createElement('button');create.type='button';create.textContent='Create route from selected deliveries';
      create.addEventListener('click',async()=>{const chosen=(orders||[]).filter(o=>selectedWaybills.has(o.waybill));if(!driverInput.value.trim()||!chosen.length){message.textContent='Enter an approved driver ID and select at least one pending delivery.';return;}if(chosen.length>15){message.textContent='A route can contain up to 15 deliveries.';return;}create.disabled=true;try{const stops=chosen.flatMap(o=>[{waybill:o.waybill,stop_type:'pickup'},{waybill:o.waybill,stop_type:'dropoff'}]);await routeInvoke('POST',{action:'create_route',driver_user_id:driverInput.value.trim(),stops});selectedWaybills.clear();await load();message.textContent='Multi-stop route assigned.';}catch(e){message.textContent=e.message||'Unable to create route.';}finally{create.disabled=false;}});
      panelRoute.append(driverLabel,help,create);
    }
    if(!routes?.length){const empty=document.createElement('p');empty.textContent=app==='company'?'No multi-stop routes have been created yet.':'No multi-stop route is assigned to you.';panelRoute.append(empty);}
    for(const route of routes||[]){
      const routeCard=document.createElement('article');routeCard.className='dispatch-route-card';
      const meta=document.createElement('p');meta.textContent='Route '+String(route.id).slice(0,8)+' · '+String(route.status).replace('_',' ');routeCard.append(meta);
      const listStops=document.createElement('ol');listStops.className='dispatch-route-stops';
      const stops=[...(route.stops||[])].sort((a,b)=>a.sequence_no-b.sequence_no);
      for(let i=0;i<stops.length;i++){
        const stop=stops[i],booking=stop.customer_bookings||{},item=document.createElement('li');
        const label=document.createElement('strong');label.textContent=(stop.stop_type==='pickup'?'Pickup':'Drop-off')+' · '+stop.waybill;
        const address=document.createElement('span');address.textContent=stop.stop_type==='pickup'?(booking.pickup||'Pickup address unavailable'):(booking.dropoff||'Drop-off address unavailable');
        const state=document.createElement('small');state.textContent=stop.status==='completed'?'Completed':booking.status==='delivered'?'Delivery complete':'Pending';
        item.append(label,address,state);
        if(app==='company'&&route.status==='assigned'){
          const persistOrder=async(nextStops,button)=>{button.disabled=true;try{await routeInvoke('POST',{action:'reorder_route',route_id:route.id,stop_ids:nextStops.map(x=>x.id)});await load();}catch(e){message.textContent=e.message;}finally{button.disabled=false;}};
          if(i>0){const up=document.createElement('button');up.type='button';up.textContent='↑';up.setAttribute('aria-label','Move stop up');up.addEventListener('click',()=>{const next=stops.slice();[next[i-1],next[i]]=[next[i],next[i-1]];persistOrder(next,up);});item.append(up);}
          if(i<stops.length-1){const down=document.createElement('button');down.type='button';down.textContent='↓';down.setAttribute('aria-label','Move stop down');down.addEventListener('click',()=>{const next=stops.slice();[next[i],next[i+1]]=[next[i+1],next[i]];persistOrder(next,down);});item.append(down);}
        }
        listStops.append(item);
      }
      routeCard.append(listStops);
      if(app==='driver'&&route.status==='assigned'){const start=document.createElement('button');start.type='button';start.textContent='Start route';start.addEventListener('click',async()=>{start.disabled=true;try{await routeInvoke('POST',{action:'start_route',route_id:route.id});await load();}catch(e){message.textContent=e.message;}finally{start.disabled=false;}});routeCard.append(start);}
      panelRoute.append(routeCard);
    }
    list.prepend(panelRoute);
  }

  async function load() {
    if (!active || document.body.dataset.guestPreview === 'true') return;
    const current = ++requestNumber;
    message.textContent = 'Loading deliveries…';
    try {
      const data = await invoke('GET');
      let routeData={routes:[]},routeServiceUnavailable=false;
      try{routeData=await routeInvoke('GET');}catch{routeServiceUnavailable=true;}
      if (current !== requestNumber) return;
      list.replaceChildren();
      selectedWaybills=new Set([...selectedWaybills].filter(id=>(data.orders||[]).some(order=>order.waybill===id)));
      if(routeServiceUnavailable){const routeNotice=document.createElement('p');routeNotice.className='dispatch-sequence-note';routeNotice.textContent='Persistent route planning is staged in development and awaits its Supabase migration and Edge Function release.';list.append(routeNotice);}
      else renderRoutePanel(routeData.routes||[],data.orders||[]);
      if(app==='company'){const note=document.createElement('p');note.className='dispatch-sequence-note';note.textContent='Route sequence draft: drag jobs or use the arrow controls to arrange a local planning order. This does not change dispatch assignments or calculate an optimised multi-stop route.';list.append(note);}
      if (app === 'driver' && data.driverProfile?.verification_status !== 'approved') {
        const notice = document.createElement('p');
        notice.textContent = 'Your driver application is awaiting verification. Dispatch access will be enabled after approval.';
        list.append(notice);
      }
      if (!data.orders?.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No deliveries are currently assigned to this account.';
        list.append(empty);
      }
      for (const order of data.orders || []) render(order);
      message.textContent = '';
    } catch (error) {
      if (current === requestNumber) message.textContent = error.message || 'Unable to load deliveries.';
    }
  }

  async function action(body, button) {
    const current = requestNumber;
    button.disabled = true;
    try {
      await invoke('POST', body);
      if(app==='driver'&&['pickup','complete'].includes(body.action)){try{await routeInvoke('POST',{action:'sync_waybill',waybill:body.waybill});}catch{}}
      if (current !== requestNumber) return;
      await load();
      message.textContent = 'Delivery updated.';
    } catch (error) {
      if (current === requestNumber) message.textContent = error.message || 'Unable to update delivery.';
    } finally {
      button.disabled = false;
    }
  }

  function makeButton(parent, label, body) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => action(body, button));
    parent.append(button);
    return button;
  }

  function render(order) {
    const card = document.createElement('article');
    card.className = 'order';
    const title = document.createElement('h3');
    title.textContent = order.waybill;
    const route = document.createElement('p');
    route.textContent = order.pickup + ' → ' + order.dropoff;
    const summary = document.createElement('p');
    summary.textContent = [
      String(order.vehicle || '').toUpperCase(),
      money(order.price),
      statusLabel(order.status),
      order.paid_at ? 'Paid' : 'Payment pending'
    ].filter(Boolean).join(' · ');
    card.append(title, route, summary);
    if(app==='company'&&order.status==='pending'&&!order.driver_user_id&&!order.refunded_at){const pickLabel=document.createElement('label');pickLabel.className='dispatch-route-select';const pick=document.createElement('input');pick.type='checkbox';pick.checked=selectedWaybills.has(order.waybill);pick.addEventListener('change',()=>{if(pick.checked)selectedWaybills.add(order.waybill);else selectedWaybills.delete(order.waybill);});pickLabel.append(pick,document.createTextNode(' Include in multi-stop route'));card.append(pickLabel);}
    if(app==='driver'){
      const next=document.createElement('section');next.className='driver-next-task';
      const kicker=document.createElement('small');kicker.textContent='NEXT TASK';
      const instruction=document.createElement('strong');
      const guidance=document.createElement('p');
      const task=({assigned:['Review this delivery','Accept only when you are ready to collect the parcel.'],accepted:['Navigate to pickup','Travel to the pickup point and confirm collection when the parcel is in your possession.'],picked_up:['Start delivery','The parcel is collected. Begin the trip to the drop-off point.'],in_transit:['Complete delivery','Follow the route, capture proof of delivery and confirm the recipient PIN.']})[order.status]||['Delivery update',statusLabel(order.status)];
      instruction.textContent=task[0];guidance.textContent=task[1];next.append(kicker,instruction,guidance);
      const directions=document.createElement('a');const origin=order.pickup_latitude!=null&&order.pickup_longitude!=null?order.pickup_latitude+','+order.pickup_longitude:order.pickup;const destination=order.dropoff_latitude!=null&&order.dropoff_longitude!=null?order.dropoff_latitude+','+order.dropoff_longitude:order.dropoff;
      directions.href='https://www.google.com/maps/dir/?api=1&'+new URLSearchParams({origin,destination,travelmode:'driving'}).toString();directions.target='_blank';directions.rel='noopener noreferrer';directions.textContent='Open turn-by-turn directions ↗';next.append(directions);card.append(next);
    }
    for (const [kind,label] of [['pickup','Pickup'],['dropoff','Drop-off']]) {
      const plus = order[kind + '_plus_code'];
      const lat = order[kind + '_latitude'], lng = order[kind + '_longitude'];
      if (!plus && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)))) continue;
      const location = document.createElement('p');
      location.textContent = label + ' pin: ' + (plus || 'coordinates saved') + (order[kind + '_geohash'] ? ' · Geohash ' + order[kind + '_geohash'] : '');
      card.append(location);
      if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        const mapLink = document.createElement('a');
        mapLink.href = 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
        mapLink.target = '_blank'; mapLink.rel = 'noopener noreferrer'; mapLink.textContent = 'Open ' + label.toLowerCase() + ' pin in Maps';
        card.append(mapLink);
      }
      if (plus) {
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy ' + label.toLowerCase() + ' Plus Code';
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(plus); message.textContent = label + ' Plus Code copied.'; } catch { message.textContent = 'Copy was blocked; select the code manually: ' + plus; } });
        card.append(copy);
      }
    }

    if (order.scheduled_at) {
      const scheduled = document.createElement('p');
      scheduled.textContent = 'Requested pickup: ' + new Date(order.scheduled_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
      card.append(scheduled);
    }
    if (order.proof && app === 'company') {
      const proof = document.createElement('p');
      proof.textContent = 'Proof of delivery received' + (order.proof.recipient_name ? ' · ' + order.proof.recipient_name : '') + '.';
      card.append(proof);
    }
    if (order.status === 'failed' && order.failure_reason) {
      const reason = document.createElement('p');
      reason.textContent = 'Failure reason: ' + order.failure_reason;
      card.append(reason);
    }

    if (app === 'driver') {
      if (order.recipient) {
        const recipient = document.createElement('p');
        recipient.textContent = 'Recipient: ' + order.recipient;
        card.append(recipient);
      }
      if (order.status === 'assigned') makeButton(card, 'Accept delivery', { waybill: order.waybill, action: 'accept' });
      if (order.status === 'accepted') makeButton(card, 'Confirm pickup', { waybill: order.waybill, action: 'pickup' });
      if (order.status === 'picked_up') makeButton(card, 'Start delivery', { waybill: order.waybill, action: 'in_transit' });
      if (order.status === 'in_transit') {
        if (order.proof) {
          const proofNote = document.createElement('p');
          proofNote.textContent = 'Proof of delivery submitted' + (order.proof.recipient_name ? ' · Recipient: ' + order.proof.recipient_name : '') + '.';
          card.append(proofNote);
          const form = document.createElement('form');
          const label = document.createElement('label');
          label.textContent = 'Recipient four-digit PIN';
          const pin = document.createElement('input');
          pin.name = 'pin';
          pin.inputMode = 'numeric';
          pin.pattern = '[0-9]{4}';
          pin.maxLength = 4;
          pin.required = true;
          pin.autocomplete = 'off';
          label.append(pin);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Complete Stop';
          form.append(label, submit);
          form.addEventListener('submit', event => {
            event.preventDefault();
            action({ waybill: order.waybill, action: 'complete', pin: pin.value }, submit);
            pin.value = '';
          });
          card.append(form);
        } else {
          const actionBar=document.createElement('section');actionBar.className='pod-action-bar';
          const actionTitle=document.createElement('strong');actionTitle.textContent='Proof of Delivery';
          const actionHint=document.createElement('p');actionHint.textContent='Capture a parcel photo or recipient signature before completing this stop.';
          const openProof=document.createElement('button');openProof.type='button';openProof.textContent='Open secure proof capture';
          const dialog=document.createElement('dialog');dialog.className='pod-dialog';
          const dialogBody=document.createElement('div');dialogBody.className='pod-dialog-body';
          const close=document.createElement('button');close.type='button';close.textContent='Close';close.className='pod-close';
          const heading=document.createElement('h3');heading.textContent='Proof of Delivery';
          const methods=document.createElement('div');methods.className='pod-methods';
          const photoTab=document.createElement('button');photoTab.type='button';photoTab.textContent='Take a photo';
          const signatureTab=document.createElement('button');signatureTab.type='button';signatureTab.textContent='Collect signature';
          methods.append(photoTab,signatureTab);
          const photoPane=document.createElement('section');photoPane.className='pod-pane';
          const photoLabel=document.createElement('label');photoLabel.textContent='Parcel / handover photo (JPEG, PNG or WebP; max 10 MB)';
          const file=document.createElement('input');file.type='file';file.accept='image/jpeg,image/png,image/webp';file.setAttribute('capture','environment');
          const preview=document.createElement('img');preview.alt='Proof photo preview';preview.hidden=true;preview.className='pod-photo-preview';
          photoLabel.append(file);photoPane.append(photoLabel,preview);
          const signPane=document.createElement('section');signPane.className='pod-pane';signPane.hidden=true;
          const signHelp=document.createElement('p');signHelp.textContent='Ask the recipient to sign in the box below.';
          const canvas=document.createElement('canvas');canvas.className='pod-signature';canvas.width=900;canvas.height=360;canvas.setAttribute('aria-label','Recipient signature area');
          const clearSign=document.createElement('button');clearSign.type='button';clearSign.textContent='Clear signature';
          signPane.append(signHelp,canvas,clearSign);
          const recipientLabel=document.createElement('label');recipientLabel.textContent='Recipient name (optional)';
          const recipient=document.createElement('input');recipient.maxLength=120;recipientLabel.append(recipient);
          const notesLabel=document.createElement('label');notesLabel.textContent='Delivery notes (optional)';
          const notes=document.createElement('input');notes.maxLength=500;notesLabel.append(notes);
          const confirm=document.createElement('button');confirm.type='button';confirm.textContent='Confirm Photo';confirm.className='pod-confirm';
          const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
          dialogBody.append(close,heading,methods,photoPane,signPane,recipientLabel,notesLabel,confirm,status);dialog.append(dialogBody);
          let mode='photo',drawing=false,hasSignature=false,signatureBlob=null;
          const context=canvas.getContext('2d');context.lineWidth=5;context.lineCap='round';context.lineJoin='round';context.strokeStyle='#142d27';
          const point=event=>{const rect=canvas.getBoundingClientRect();return{x:(event.clientX-rect.left)*canvas.width/rect.width,y:(event.clientY-rect.top)*canvas.height/rect.height};};
          canvas.addEventListener('pointerdown',event=>{drawing=true;hasSignature=true;canvas.setPointerCapture(event.pointerId);const p=point(event);context.beginPath();context.moveTo(p.x,p.y);});
          canvas.addEventListener('pointermove',event=>{if(!drawing)return;const p=point(event);context.lineTo(p.x,p.y);context.stroke();});
          for(const eventName of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(eventName,()=>{drawing=false;});
          clearSign.addEventListener('click',()=>{context.clearRect(0,0,canvas.width,canvas.height);hasSignature=false;signatureBlob=null;});
          file.addEventListener('change',()=>{const selected=file.files?.[0];if(!selected){preview.hidden=true;return;}if(!['image/jpeg','image/png','image/webp'].includes(selected.type)||selected.size>10*1024*1024){status.textContent='Choose a JPEG, PNG or WebP image under 10 MB.';file.value='';return;}preview.src=URL.createObjectURL(selected);preview.hidden=false;});
          const setMode=next=>{mode=next;photoPane.hidden=next!=='photo';signPane.hidden=next!=='signature';photoTab.disabled=next==='photo';signatureTab.disabled=next==='signature';confirm.textContent=next==='photo'?'Confirm Photo':'Confirm Signature';status.textContent='';};
          photoTab.addEventListener('click',()=>setMode('photo'));signatureTab.addEventListener('click',()=>setMode('signature'));
          openProof.addEventListener('click',()=>{if(typeof dialog.showModal==='function')dialog.showModal();else status.textContent='This browser does not support secure proof capture.';});
          close.addEventListener('click',()=>dialog.close());
          confirm.addEventListener('click',async()=>{
            let selected;
            if(mode==='photo')selected=file.files?.[0];
            else if(hasSignature){signatureBlob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(signatureBlob)selected=new File([signatureBlob],'recipient-signature.png',{type:'image/png'});}
            if(!selected){status.textContent=mode==='photo'?'Take or select a proof photo first.':'Collect the recipient signature first.';return;}
            if(selected.size>10*1024*1024){status.textContent='Proof image must be 10 MB or less.';return;}
            confirm.disabled=true;status.textContent='Uploading securely…';
            try{
              const client=window.swiftHaulSupabase;if(!client)throw new Error('Secure account connection is unavailable.');
              const {data:upload,error:initError}=await client.functions.invoke('pod-upload',{body:{action:'create',waybill:order.waybill,content_type:selected.type,size:selected.size}});
              if(initError||upload?.error)throw new Error(upload?.error||initError.message);
              const {error:storageError}=await client.storage.from('delivery-proof').uploadToSignedUrl(upload.path,upload.token,selected,{contentType:selected.type,upsert:false});
              if(storageError)throw storageError;
              const proofNotes=[mode==='signature'?'Proof method: recipient signature':'Proof method: delivery photo',notes.value.trim()].filter(Boolean).join(' · ');
              const {data:confirmed,error:confirmError}=await client.functions.invoke('pod-upload',{body:{action:'confirm',waybill:order.waybill,path:upload.path,recipient_name:recipient.value,notes:proofNotes}});
              if(confirmError||confirmed?.error)throw new Error(confirmed?.error||confirmError.message);
              dialog.close();await load();message.textContent=mode==='signature'?'Recipient signature uploaded. Enter the recipient PIN to complete this stop.':'Proof photo uploaded. Enter the recipient PIN to complete this stop.';
            }catch(error){status.textContent=error.message||'Unable to upload proof.';}
            finally{confirm.disabled=false;}
          });
          actionBar.append(actionTitle,actionHint,openProof);card.append(actionBar,dialog);
        }
      }
      if (['accepted', 'picked_up', 'in_transit'].includes(order.status)) {
        const form = document.createElement('form');
        const label = document.createElement('label');
        label.textContent = 'Reason delivery cannot be completed';
        const reason = document.createElement('input');
        reason.maxLength = 300;
        reason.required = true;
        label.append(reason);
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Report failed delivery';
        form.append(label, submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          action({ waybill: order.waybill, action: 'fail', reason: reason.value.trim() }, submit);
        });
        card.append(form);
      }
    } else if (!['delivered', 'failed', 'cancelled'].includes(order.status)) {
      const form = document.createElement('form');
      const label = document.createElement('label');
      label.textContent = 'Approved driver account ID';
      const id = document.createElement('input');
      id.required = true;
      id.maxLength = 36;
      id.pattern = '[0-9a-fA-F-]{36}';
      label.append(id);
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'Assign driver';
      form.append(label, submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        action({ waybill: order.waybill, action: 'assign', driver_id: id.value.trim() }, submit);
      });
      card.append(form);
    }
    if(app==='company'){
      card.draggable=true;card.dataset.waybill=order.waybill;
      const tools=document.createElement('div');tools.className='dispatch-stop-tools';
      const stop=document.createElement('b');stop.textContent=String(list.querySelectorAll('.order').length+1);
      const label=document.createElement('span');label.textContent='Draft stop sequence';
      const up=document.createElement('button');up.type='button';up.textContent='Move up';up.setAttribute('aria-label','Move '+order.waybill+' up');
      const down=document.createElement('button');down.type='button';down.textContent='Move down';down.setAttribute('aria-label','Move '+order.waybill+' down');
      up.addEventListener('click',()=>{const prev=card.previousElementSibling;if(prev?.classList.contains('order'))list.insertBefore(card,prev);refreshSequence();});
      down.addEventListener('click',()=>{const next=card.nextElementSibling;if(next?.classList.contains('order'))list.insertBefore(next,card);refreshSequence();});
      tools.append(stop,label,up,down);card.prepend(tools);
      card.addEventListener('dragstart',()=>{draggedCard=card;card.classList.add('dragging');});
      card.addEventListener('dragend',()=>{card.classList.remove('dragging');draggedCard=null;refreshSequence();});
      card.addEventListener('dragover',event=>{if(!draggedCard||draggedCard===card)return;event.preventDefault();card.classList.add('drag-over');});
      card.addEventListener('dragleave',()=>card.classList.remove('drag-over'));
      card.addEventListener('drop',event=>{event.preventDefault();card.classList.remove('drag-over');if(draggedCard&&draggedCard!==card){const rect=card.getBoundingClientRect();list.insertBefore(draggedCard,event.clientY<rect.top+rect.height/2?card:card.nextSibling);refreshSequence();}});
    }
    list.append(card);
    if(app==='company')refreshSequence();
  }

  function refreshSequence(){if(app!=='company')return;[...list.querySelectorAll('.order')].forEach((card,index)=>{const badge=card.querySelector('.dispatch-stop-tools b');if(badge)badge.textContent=String(index+1);});}
  refresh.addEventListener('click', load);
  document.addEventListener('account-ready', () => { active = true; load(); });
  document.addEventListener('account-cleared', () => {
    active = false;
    requestNumber++;
    list.replaceChildren();
    message.textContent = '';
  });
  document.addEventListener('guest-preview', () => {
    active = false;
    requestNumber++;
    list.replaceChildren();
    message.textContent = 'Sign in to access assigned deliveries and company dispatch.';
  });
}

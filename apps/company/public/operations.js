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

  async function load() {
    if (!active || document.body.dataset.guestPreview === 'true') return;
    const current = ++requestNumber;
    message.textContent = 'Loading deliveries…';
    try {
      const data = await invoke('GET');
      if (current !== requestNumber) return;
      list.replaceChildren();
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
          proofNote.textContent = 'Proof photo uploaded' + (order.proof.recipient_name ? ' · Recipient: ' + order.proof.recipient_name : '') + '.';
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
          submit.textContent = 'Confirm delivery';
          form.append(label, submit);
          form.addEventListener('submit', event => {
            event.preventDefault();
            action({ waybill: order.waybill, action: 'complete', pin: pin.value }, submit);
            pin.value = '';
          });
          card.append(form);
        } else {
          const form = document.createElement('form');
          const fileLabel = document.createElement('label');
          fileLabel.textContent = 'Proof-of-delivery photo (JPEG, PNG or WebP; max 10 MB)';
          const file = document.createElement('input');
          file.type = 'file';
          file.accept = 'image/jpeg,image/png,image/webp';
          file.required = true;
          fileLabel.append(file);
          const recipientLabel = document.createElement('label');
          recipientLabel.textContent = 'Recipient name (optional)';
          const recipient = document.createElement('input');
          recipient.maxLength = 120;
          recipientLabel.append(recipient);
          const notesLabel = document.createElement('label');
          notesLabel.textContent = 'Delivery notes (optional)';
          const notes = document.createElement('input');
          notes.maxLength = 500;
          notesLabel.append(notes);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Upload proof photo';
          form.append(fileLabel, recipientLabel, notesLabel, submit);
          form.addEventListener('submit', async event => {
            event.preventDefault();
            const selected = file.files?.[0];
            if (!selected) return;
            if (selected.size > 10 * 1024 * 1024) {
              message.textContent = 'Choose an image smaller than 10 MB.';
              return;
            }
            submit.disabled = true;
            message.textContent = 'Uploading proof photo…';
            try {
              const client = window.swiftHaulSupabase;
              const { data: upload, error: initError } = await client.functions.invoke('pod-upload', {
                body: { action: 'create', waybill: order.waybill, content_type: selected.type, size: selected.size }
              });
              if (initError || upload?.error) throw new Error(upload?.error || initError.message);
              const { error: storageError } = await client.storage.from('delivery-proof')
                .uploadToSignedUrl(upload.path, upload.token, selected, { contentType: selected.type, upsert: false });
              if (storageError) throw storageError;
              const { data: confirmed, error: confirmError } = await client.functions.invoke('pod-upload', {
                body: { action: 'confirm', waybill: order.waybill, path: upload.path, recipient_name: recipient.value, notes: notes.value }
              });
              if (confirmError || confirmed?.error) throw new Error(confirmed?.error || confirmError.message);
              await load();
              message.textContent = 'Proof photo uploaded. Enter the recipient PIN to complete delivery.';
            } catch (error) {
              message.textContent = error.message || 'Unable to upload proof photo.';
            } finally {
              submit.disabled = false;
            }
          });
          card.append(form);
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

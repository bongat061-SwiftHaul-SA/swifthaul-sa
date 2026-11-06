(() => {
  const dialog=document.getElementById('delivery-route-dialog');
  const status=document.getElementById('route-status'),loading=document.getElementById('route-loading'),retry=document.getElementById('retry-delivery-route'),summary=document.getElementById('route-summary'),locations=document.getElementById('route-locations'),progress=document.getElementById('tracking-progress');
  let request,currentOrder;
  const stages=[['pending','Booking received','Your delivery request is in the SwiftHaul system.'],['assigned','Driver assigned','Dispatch has matched a driver to your delivery.'],['accepted','Driver confirmed','The driver has accepted the delivery.'],['picked_up','Parcel collected','The parcel has been collected from the pickup point.'],['in_transit','On the way','The parcel is moving to the drop-off point.'],['delivered','Delivered','Delivery has been marked complete.']];
  const short=value=>String(value||'Not provided').length>34?String(value).slice(0,31)+'…':String(value||'Not provided');
  function stageIndex(order){const s=String(order.status||'pending').toLowerCase();if(order.completed_at||['delivered','completed'].includes(s))return 5;if(['in_transit','out_for_delivery','on_the_way'].includes(s))return 4;if(['picked_up','collected','picked-up'].includes(s))return 3;if(['accepted','driver_accepted'].includes(s))return 2;if(order.assigned_driver||['assigned','driver_assigned'].includes(s))return 1;return 0;}
  function renderProgress(order){
    const active=stageIndex(order),terminal=['cancelled','failed','refunded'].includes(String(order.status||'').toLowerCase());
    progress.replaceChildren();
    const note=document.createElement('p');note.className='tracking-live-note';note.textContent='Updates reflect confirmed booking events. The route graphic is illustrative; live driver GPS is not connected.';progress.append(note);
    if(terminal){const item=document.createElement('div');item.className='tracking-terminal';item.textContent='This delivery is '+String(order.status).replaceAll('_',' ')+'. Contact dispatch if you need assistance.';progress.append(item);return;}
    const list=document.createElement('ol');list.className='tracking-timeline';
    stages.forEach((stage,index)=>{const li=document.createElement('li');li.className=index<active?'is-done':index===active?'is-current':'';const marker=document.createElement('span');marker.className='tracking-marker';marker.setAttribute('aria-hidden','true');const body=document.createElement('div');body.className='tracking-step';const title=document.createElement('strong');title.textContent=stage[1];const detail=document.createElement('span');detail.textContent=stage[2];body.append(title,detail);const time=document.createElement('span');time.className='tracking-time';time.textContent=index===active?'Current':index<active?'Confirmed':'Upcoming';li.append(marker,body,time);list.append(li);});
    progress.append(list);
  }
  async function loadRoute(){
    if(!currentOrder||document.body.dataset.guestPreview==='true')return;
    request?.abort();const active=new AbortController();request=active;loading.hidden=false;retry.hidden=true;summary.hidden=true;locations.hidden=true;status.textContent='Checking route distance and estimated driving time…';
    try{
      const response=await fetch('/api/booking-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waybill:currentOrder.waybill}),signal:active.signal,cache:'no-store'});
      const route=await response.json();if(request!==active||active.signal.aborted||!dialog.open)return;if(!response.ok)throw new Error(route.error||'Route details are unavailable.');
      const minutes=Math.max(1,Math.round(Number(route.duration)/60));const duration=minutes<60?minutes+' min':Math.floor(minutes/60)+' hr'+(minutes%60?' '+(minutes%60)+' min':'');
      const hasRoute=Number.isFinite(Number(route.distance))&&Number.isFinite(Number(route.duration));
      summary.textContent=hasRoute?(Number(route.distance)/1000).toFixed(1)+' km · Estimated driving time '+duration:'Route distance and driving time are not available.';summary.hidden=false;
      document.getElementById('tracking-distance').textContent=hasRoute?(Number(route.distance)/1000).toFixed(1)+' km':'—';
      document.getElementById('tracking-eta').textContent=hasRoute?duration:'—';
      locations.textContent='Pickup: '+route.pickup.label+'. Drop-off: '+route.dropoff.label+'. Open directions for turn-by-turn navigation.';locations.hidden=false;
      status.textContent='Route details updated. ETA is an estimate, not live driver telemetry.';
    }catch(error){if(request!==active||active.signal.aborted)return;status.textContent=error.message||'Unable to load route details. Please try again.';retry.hidden=false;}
    finally{if(request===active)loading.hidden=true;}
  }
  document.addEventListener('delivery-route',event=>{
    if(document.body.dataset.guestPreview==='true')return;
    currentOrder=event.detail;
    document.getElementById('route-waybill').textContent=currentOrder.waybill;
    document.getElementById('route-pickup-short').textContent=short(currentOrder.pickup);
    document.getElementById('route-dropoff-short').textContent=short(currentOrder.dropoff);
    const active=stageIndex(currentOrder),currentLabel=stages[active][1];
    document.getElementById('tracking-status-pill').textContent=currentLabel.toUpperCase();
    document.getElementById('tracking-current-status').textContent=currentLabel;
    document.getElementById('tracking-map-label').textContent='STATUS · '+currentLabel.toUpperCase();
    document.getElementById('tracking-eta').textContent='—';document.getElementById('tracking-distance').textContent='—';
    const directions=new URL('https://www.google.com/maps/dir/');
    directions.search=new URLSearchParams({api:'1',origin:currentOrder.pickup,destination:currentOrder.dropoff,travelmode:'driving'}).toString();
    document.getElementById('route-directions').href=directions.href;renderProgress(currentOrder);
    if(!dialog.open)dialog.showModal();loadRoute();
  });
  function resetPreview(){
    request?.abort();request=null;currentOrder=null;status.textContent='';summary.textContent='';locations.textContent='';progress.replaceChildren();
    ['route-waybill','route-pickup-short','route-dropoff-short'].forEach(id=>{document.getElementById(id).textContent='';});
    document.getElementById('route-directions').removeAttribute('href');
    ['tracking-eta','tracking-distance'].forEach(id=>document.getElementById(id).textContent='—');
    document.getElementById('tracking-current-status').textContent='Received';document.getElementById('tracking-status-pill').textContent='BOOKING RECEIVED';document.getElementById('tracking-map-label').textContent='DELIVERY STATUS';
  }
  document.getElementById('close-delivery-route').addEventListener('click',()=>{dialog.close();resetPreview();});
  retry.addEventListener('click',loadRoute);dialog.addEventListener('cancel',resetPreview);dialog.addEventListener('close',()=>{if(!dialog.open)resetPreview();});
  document.addEventListener('account-cleared',()=>{if(dialog.open)dialog.close();resetPreview();});
})();
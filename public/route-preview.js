(() => {
  const dialog=document.getElementById('delivery-route-dialog');
  const status=document.getElementById('route-status');
  const loading=document.getElementById('route-loading');
  const retry=document.getElementById('retry-delivery-route');
  const summary=document.getElementById('route-summary');
  const locations=document.getElementById('route-locations');
  let request,currentOrder;
  async function loadRoute(){
    if(!currentOrder||document.body.dataset.guestPreview==='true')return;
    request?.abort();const active=new AbortController();request=active;
    loading.hidden=false;retry.hidden=true;summary.hidden=true;locations.hidden=true;
    status.textContent='Checking route distance and estimated driving time…';
    try{
      const response=await fetch('/api/booking-route',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({waybill:currentOrder.waybill}),signal:active.signal,cache:'no-store'});
      const route=await response.json();
      if(request!==active||active.signal.aborted||!dialog.open)return;
      if(!response.ok)throw new Error(route.error||'Route details are unavailable.');
      const minutes=Math.max(1,Math.round(Number(route.duration)/60));
      const duration=minutes<60?minutes+' min':Math.floor(minutes/60)+' hr'+(minutes%60?' '+(minutes%60)+' min':'');
      summary.textContent=Number.isFinite(Number(route.distance))&&Number.isFinite(Number(route.duration))?(Number(route.distance)/1000).toFixed(1)+' km · Estimated drive time: '+duration:'Route distance and time are not available.';
      summary.hidden=false;
      locations.textContent='Matched pickup: '+route.pickup.label+'. Matched drop-off: '+route.dropoff.label+'. Verify the addresses and use the directions link for navigation.';
      locations.hidden=false;
      status.textContent='Route details ready. No embedded map is loaded.';
    }catch(error){if(request!==active||active.signal.aborted)return;status.textContent=error.message||'Unable to load route details. Please try again.';retry.hidden=false;}
    finally{if(request===active)loading.hidden=true;}
  }
  document.addEventListener('delivery-route',event=>{
    if(document.body.dataset.guestPreview==='true')return;
    currentOrder=event.detail;
    document.getElementById('route-waybill').textContent=currentOrder.waybill;
    document.getElementById('route-pickup').textContent=currentOrder.pickup;
    document.getElementById('route-dropoff').textContent=currentOrder.dropoff;
    const directions=new URL('https://www.google.com/maps/dir/');
    directions.search=new URLSearchParams({api:'1',origin:currentOrder.pickup,destination:currentOrder.dropoff,travelmode:'driving'}).toString();
    document.getElementById('route-directions').href=directions.href;
    if(!dialog.open)dialog.showModal();loadRoute();
  });
  function resetPreview(){
    request?.abort();request=null;currentOrder=null;status.textContent='';summary.textContent='';locations.textContent='';
    ['route-waybill','route-pickup','route-dropoff'].forEach(id=>{document.getElementById(id).textContent='';});
    document.getElementById('route-directions').removeAttribute('href');
  }
  document.getElementById('close-delivery-route').addEventListener('click',()=>{dialog.close();resetPreview();});
  retry.addEventListener('click',loadRoute);
  dialog.addEventListener('cancel',resetPreview);
  dialog.addEventListener('close',()=>{if(!dialog.open)resetPreview();});
  document.addEventListener('account-cleared',()=>{if(dialog.open)dialog.close();resetPreview();});
})();
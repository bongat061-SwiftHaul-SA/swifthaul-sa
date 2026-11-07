(() => {
  const params = new URLSearchParams(location.search);
  const waybill = params.get('waybill');
  if (!waybill) return;
  const map = window.swiftHaulMap;
  const status = document.getElementById('map-status');
  const heading = document.querySelector('.intro h1');
  const intro = document.querySelector('.intro p');
  const pickup = { lat:Number(params.get('pickupLat')), lng:Number(params.get('pickupLng')) };
  const dropoff = { lat:Number(params.get('dropoffLat')), lng:Number(params.get('dropoffLng')) };
  const valid = p => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat)<=90 && Math.abs(p.lng)<=180 && !(p.lat===0&&p.lng===0);
  const hasPickup=valid(pickup), hasDropoff=valid(dropoff);
  if (heading) heading.textContent = 'Delivery tracking · ' + waybill;
  if (intro) intro.textContent = (params.get('pickup')||'Pickup') + ' → ' + (params.get('dropoff')||'Drop-off') + '. ' + (params.get('status')||'Booking route');
  const footer=document.querySelector('.footer');
  if (footer) footer.textContent='Planned route only. Driver GPS appears only when explicitly shared by the driver platform; live traffic is not included.';
  if (!map) { if(status) status.textContent='Map is loading. Reload if the map does not appear.'; return; }
  const draw=async()=>{
    const points=[];
    if(hasPickup) points.push([pickup.lng,pickup.lat]);
    if(hasDropoff) points.push([dropoff.lng,dropoff.lat]);
    if(!points.length){if(status)status.textContent='This booking has no saved map coordinates yet. The booking addresses are shown above.';return;}
    const marker=(point,color,label)=>{
      const node=document.createElement('div');
      node.style.cssText='width:22px;height:22px;border:4px solid #fff;border-radius:50%;background:'+color+';box-shadow:0 2px 9px #0006';
      new maplibregl.Marker({element:node}).setLngLat(point).setPopup(new maplibregl.Popup({offset:12}).setText(label)).addTo(map);
    };
    if(hasPickup)marker([pickup.lng,pickup.lat],'#16845b','Pickup · '+(params.get('pickup')||''));
    if(hasDropoff)marker([dropoff.lng,dropoff.lat],'#2878c8','Drop-off · '+(params.get('dropoff')||''));
    if(points.length===2){
      const fallback={type:'Feature',properties:{},geometry:{type:'LineString',coordinates:points}};
      map.addSource('booking-context-route',{type:'geojson',data:fallback});
      map.addLayer({id:'booking-context-route-line',type:'line',source:'booking-context-route',paint:{'line-color':'#176b52','line-width':5,'line-opacity':.85,'line-dasharray':[2,2]}});
      try{
        const url='https://router.project-osrm.org/route/v1/driving/'+pickup.lng+','+pickup.lat+';'+dropoff.lng+','+dropoff.lat+'?overview=full&geometries=geojson&steps=false';
        const response=await fetch(url,{headers:{Accept:'application/json'}});
        if(!response.ok)throw new Error('route unavailable');
        const data=await response.json(),route=data.routes&&data.routes[0];
        if(route){map.getSource('booking-context-route').setData({type:'Feature',properties:{},geometry:route.geometry});map.setPaintProperty('booking-context-route-line','line-dasharray',[1,0]);if(status)status.textContent='Planned road route · '+(route.distance/1000).toFixed(1)+' km · '+Math.max(1,Math.round(route.duration/60))+' min estimated driving time. Not live traffic or driver GPS.';}
        else throw new Error('route unavailable');
      }catch{if(status)status.textContent='Road routing is unavailable. Showing the direct pickup-to-drop-off connection.';}
      map.fitBounds([[pickup.lng,pickup.lat],[dropoff.lng,dropoff.lat]],{padding:70,maxZoom:15});
    }else{map.setCenter(points[0]).setZoom(14);if(status)status.textContent='Showing the saved booking location. The other stop has no saved coordinates.';}
  };
  if(map.loaded())draw();else map.once('load',draw);
})();
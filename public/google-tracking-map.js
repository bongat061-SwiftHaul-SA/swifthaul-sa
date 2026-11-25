// Google Maps route panel helper for Driver and Company dispatch workspaces.
(() => {
  let ready;
  const load = () => {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (ready) return ready;
    ready = new Promise((resolve,reject) => {
      const key=window.SWIFTHAUL_GOOGLE_MAPS_API_KEY;
      if(!key){reject(new Error('Google Maps key configuration is missing.'));return;}
      const callback='__swiftHaulTrackingMapsReady';
      const timer=setTimeout(()=>reject(new Error('Google Maps loading timed out.')),15000);
      window[callback]=()=>{clearTimeout(timer);resolve(window.google.maps);delete window[callback];};
      const script=document.createElement('script');script.async=true;
      script.src='https://maps.googleapis.com/maps/api/js?key='+encodeURIComponent(key)+'&callback='+callback+'&loading=async&v=weekly';
      script.onerror=()=>{clearTimeout(timer);reject(new Error('Google Maps could not be loaded.'));};document.head.append(script);
    }); return ready;
  };
  const point=p=>({lat:Number(p.lat??p.latitude),lng:Number(p.lng??p.longitude)});
  window.SwiftHaulGoogleMaps={load,createRouteMap:async(element,pickup,dropoff,onError=()=>{})=>{
    const maps=await load(),a=point(pickup),b=point(dropoff);
    if(!Number.isFinite(a.lat)||!Number.isFinite(a.lng)||!Number.isFinite(b.lat)||!Number.isFinite(b.lng))throw new Error('Pickup or drop-off coordinates are invalid.');
    const map=new maps.Map(element,{center:a,zoom:12,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,zoomControl:true,gestureHandling:'greedy',backgroundColor:'#e4e9ed'});
    const bounds=new maps.LatLngBounds();bounds.extend(a);bounds.extend(b);
    const marker=(position,title,color)=>new maps.Marker({map,position,title,icon:{path:maps.SymbolPath.CIRCLE,scale:10,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});
    marker(a,'Pickup','#176b52');marker(b,'Drop-off','#9eb6d4');
    const direct=new maps.Polyline({map,path:[a,b],strokeColor:'#9eb6d4',strokeOpacity:.9,strokeWeight:5});
    map.fitBounds(bounds,52);
    const service=new maps.DirectionsService();
    service.route({origin:a,destination:b,travelMode:maps.TravelMode.DRIVING},(result,status)=>{
      if(status==='OK'&&result?.routes?.[0]){direct.setPath(result.routes[0].overview_path);map.fitBounds(result.routes[0].bounds,52);}
      else onError(new Error('Google road routing is temporarily unavailable; showing the direct pickup-to-drop-off connection.'));
    });
    maps.event.addListener(map,'tilesloaded',()=>{element.dataset.googleMapReady='true';});
    return {map,fitRoute:()=>map.fitBounds(bounds,52),destroy:()=>{maps.event.clearInstanceListeners(map);map.unbindAll();}};
  }};
})();

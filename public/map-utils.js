// Google Maps renderer shared by Customer booking quotes and delivery-route previews.
(() => {
  let mapsReady;
  function loadGoogleMaps() {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (mapsReady) return mapsReady;
    mapsReady = new Promise((resolve, reject) => {
      const key = window.SWIFTHAUL_GOOGLE_MAPS_API_KEY;
      if (!key) { reject(new Error('Google Maps key configuration is missing.')); return; }
      const callback = '__swiftHaulGoogleMapsReady';
      const timer = setTimeout(() => reject(new Error('Google Maps loading timed out.')), 15000);
      window[callback] = () => { clearTimeout(timer); resolve(window.google.maps); delete window[callback]; };
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=' + callback + '&loading=async&v=weekly';
      script.onerror = () => { clearTimeout(timer); reject(new Error('Google Maps could not be loaded.')); };
      document.head.append(script);
    });
    return mapsReady;
  }
  window.renderDeliveryMap = (element, route, onTileError = () => {}) => {
    element.hidden = false;
    const handle = { map: null, cancelled: false, stop() { this.cancelled = true; }, remove() { this.cancelled = true; if (this.map) { google.maps.event.clearInstanceListeners(this.map); this.map = null; } } };
    const coordinates = Array.isArray(route.coordinates) ? route.coordinates : [];
    const valid = p => p && Number.isFinite(Number(p.latitude ?? p.lat)) && Number.isFinite(Number(p.longitude ?? p.lng));
    const pickup = valid(route.pickup) ? {lat:Number(route.pickup.latitude ?? route.pickup.lat),lng:Number(route.pickup.longitude ?? route.pickup.lng)} : (coordinates.length ? {lat:Number(coordinates[0][1]),lng:Number(coordinates[0][0])} : null);
    const dropoff = valid(route.dropoff) ? {lat:Number(route.dropoff.latitude ?? route.dropoff.lat),lng:Number(route.dropoff.longitude ?? route.dropoff.lng)} : (coordinates.length>1 ? {lat:Number(coordinates.at(-1)[1]),lng:Number(coordinates.at(-1)[0])} : null);
    if (!pickup || !dropoff || !Number.isFinite(pickup.lat) || !Number.isFinite(dropoff.lat)) throw new Error('The route does not contain valid pickup and drop-off coordinates.');
    loadGoogleMaps().then(maps => {
      if (handle.cancelled) return;
      const map = new maps.Map(element, {center:pickup,zoom:12,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,zoomControl:true,gestureHandling:'greedy',backgroundColor:'#e4e9ed'});
      handle.map = map;
      const bounds = new maps.LatLngBounds();
      bounds.extend(pickup); bounds.extend(dropoff);
      const pin = (position,title,color) => new maps.Marker({map,position,title,icon:{path:maps.SymbolPath.CIRCLE,scale:10,fillColor:color,fillOpacity:1,strokeColor:'#fff',strokeWeight:3}});
      pin(pickup,'Pickup','#21664e'); pin(dropoff,'Drop-off','#a56924');
      const line = new maps.Polyline({map,path:[pickup,dropoff],geodesic:true,strokeColor:'#176b52',strokeOpacity:.9,strokeWeight:5});
      map.fitBounds(bounds,36);
      const directions = new maps.DirectionsService();
      directions.route({origin:pickup,destination:dropoff,travelMode:maps.TravelMode.DRIVING},(result,status)=>{
        if (handle.cancelled) return;
        if (status === 'OK' && result?.routes?.[0]) {
          line.setPath(result.routes[0].overview_path);
          const renderer = new maps.DirectionsRenderer({map,suppressMarkers:true,preserveViewport:true,polylineOptions:{strokeColor:'#176b52',strokeOpacity:.95,strokeWeight:5}});
          renderer.setDirections(result);
          map.fitBounds(result.routes[0].bounds,36);
        } else {
          onTileError(new Error('Google road directions are temporarily unavailable; showing the direct pickup-to-drop-off connection.'));
        }
      });
      maps.event.addListenerOnce(map,'tilesloaded',()=>{ if(!handle.cancelled) element.dataset.mapReady='true'; });
      setTimeout(()=>{if(!handle.cancelled && !element.dataset.mapReady)onTileError(new Error('Google Maps tiles are taking longer than expected.'));},12000);
    }).catch(error => { if (!handle.cancelled) onTileError(error); });
    return handle;
  };
})();

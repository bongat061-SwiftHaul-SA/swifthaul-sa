// Render the exact road geometry returned by OSRM for quotes and delivery previews.
(() => {
  let mapsReady;
  function loadGoogleMaps() {
    if (window.google?.maps) return Promise.resolve(window.google.maps);
    if (mapsReady) return mapsReady;
    mapsReady = new Promise((resolve, reject) => {
      const key = window.SWIFTHAUL_GOOGLE_MAPS_API_KEY;
      if (!key) { reject(new Error('Google Maps key configuration is missing.')); return; }
      const callback = '__swiftHaulGoogleMapsReady';
      const timer = setTimeout(() => reject(new Error('Google Maps loading timed out.')), 12000);
      window[callback] = () => { clearTimeout(timer); resolve(window.google.maps); delete window[callback]; };
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(key) + '&callback=' + callback + '&loading=async&v=weekly';
      script.onerror = () => { clearTimeout(timer); reject(new Error('Google Maps could not be loaded.')); };
      document.head.append(script);
    });
    return mapsReady;
  }
  const valid = p => p && Number.isFinite(Number(p.latitude ?? p.lat)) && Number.isFinite(Number(p.longitude ?? p.lng));
  const point = p => ({lat:Number(p.latitude ?? p.lat),lng:Number(p.longitude ?? p.lng)});
  function routePoints(route) {
    const coords = Array.isArray(route.coordinates) ? route.coordinates
      .filter(p => Array.isArray(p) && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])))
      .map(([lng,lat]) => ({lat:Number(lat),lng:Number(lng)})) : [];
    const pickup = valid(route.pickup) ? point(route.pickup) : coords[0];
    const dropoff = valid(route.dropoff) ? point(route.dropoff) : coords.at(-1);
    if (!pickup || !dropoff) throw new Error('The selected addresses do not have valid map coordinates.');
    const path = coords.length > 1 ? coords : [pickup,dropoff];
    return {pickup,dropoff,path};
  }
  function renderMapLibre(element, points, handle, onTileError) {
    if (!window.maplibregl) throw new Error('The map is unavailable. Please check your connection and try again.');
    const map = new maplibregl.Map({
      container:element,
      style:{version:8,sources:{base:{type:'raster',tiles:['https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'],tileSize:256,attribution:'© OpenStreetMap contributors © CARTO'}},layers:[{id:'base-raster',type:'raster',source:'base'}]},
      center:[points.pickup.lng,points.pickup.lat],zoom:12,attributionControl:true,dragRotate:false,pitchWithRotate:false,maxPitch:0
    });
    handle.map=map;
    map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
    const marker=(p,label,color)=>{const el=document.createElement('div');el.textContent=label;el.setAttribute('aria-label',label==='P'?'Pickup':'Drop-off');el.style.cssText='width:30px;height:30px;border:3px solid #fff;border-radius:50%;background:'+color+';color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;box-shadow:0 2px 9px #0005';new maplibregl.Marker({element:el,anchor:'center'}).setLngLat([p.lng,p.lat]).addTo(map);};
    marker(points.pickup,'P','#21664e');marker(points.dropoff,'D','#2475c7');
    map.on('load',()=>{
      if(handle.cancelled)return;
      const feature={type:'Feature',properties:{source:'OSRM'},geometry:{type:'LineString',coordinates:points.path.map(p=>[p.lng,p.lat])}};
      map.addSource('osrm-road-route',{type:'geojson',data:feature});
      map.addLayer({id:'osrm-road-route-casing',type:'line',source:'osrm-road-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#fff','line-width':8}});
      map.addLayer({id:'osrm-road-route-line',type:'line',source:'osrm-road-route',layout:{'line-join':'round','line-cap':'round'},paint:{'line-color':'#176b52','line-width':5}});
      const bounds=new maplibregl.LngLatBounds();
      points.path.forEach(p=>bounds.extend([p.lng,p.lat]));
      map.fitBounds(bounds,{padding:42,maxZoom:15});
      element.dataset.mapReady='true';
    });
    map.on('error',event=>{if(event?.error&&!handle.cancelled)onTileError(event.error);});
    handle.remove=()=>{handle.cancelled=true;map.remove();handle.map=null;};
  }
  window.renderDeliveryMap = (element, route, onTileError = () => {}) => {
    element.hidden=false;
    delete element.dataset.mapReady;
    const points=routePoints(route);
    const handle={map:null,cancelled:false,stop(){this.cancelled=true;},remove(){this.cancelled=true;if(this.map){if(this.map.setMap)this.map.setMap(null);else this.map.remove?.();this.map=null;}}};
    const renderGoogle=maps=>{
      if(handle.cancelled)return;
      const map=new maps.Map(element,{center:points.pickup,zoom:12,mapTypeControl:false,streetViewControl:false,fullscreenControl:false,zoomControl:true,gestureHandling:'greedy',backgroundColor:'#e4e9ed'});
      handle.map=map;
      new maps.Marker({map,position:points.pickup,title:'Pickup',label:{text:'P',color:'#fff',fontWeight:'800'}});
      new maps.Marker({map,position:points.dropoff,title:'Drop-off',label:{text:'D',color:'#fff',fontWeight:'800'}});
      const path=points.path.map(p=>({lat:p.lat,lng:p.lng}));
      new maps.Polyline({map,path,geodesic:false,strokeColor:'#176b52',strokeOpacity:.95,strokeWeight:5});
      const bounds=new maps.LatLngBounds();
      path.forEach(p=>bounds.extend(p));
      map.fitBounds(bounds,36);
      maps.event.addListenerOnce(map,'tilesloaded',()=>{if(!handle.cancelled)element.dataset.mapReady='true';});
      setTimeout(()=>{if(!handle.cancelled&&!element.dataset.mapReady)onTileError(new Error('Map tiles are taking longer than expected.'));},12000);
      handle.remove=()=>{handle.cancelled=true;maps.event.clearInstanceListeners(map);maps.event.clearInstanceListeners(map);handle.map=null;};
    };
    loadGoogleMaps().then(renderGoogle).catch(error=>{
      if(handle.cancelled)return;
      if(window.maplibregl){try{renderMapLibre(element,points,handle,onTileError);}catch(fallbackError){onTileError(fallbackError);}}
      else onTileError(error);
    });
    return handle;
  };
})();
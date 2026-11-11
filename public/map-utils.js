window.renderDeliveryMap = (element, route, onTileError = () => {}) => {
  if (!window.maplibregl) throw new Error('The map library could not load. Reload this page or open directions.');
  element.hidden = false;
  const coords = route.coordinates || [];
  if (coords.length < 2) throw new Error('The route does not contain enough mapped points.');
  const feature = {type:'Feature',properties:{},geometry:{type:'LineString',coordinates:coords}};
  const rasterStyle=tiles=>({version:8,sources:{base:{type:'raster',tiles:[tiles],tileSize:256,attribution:'&copy; OpenStreetMap contributors &copy; CARTO'}},layers:[{id:'base-raster',type:'raster',source:'base'}]});
  const map = new maplibregl.Map({
    container:element,
    style:rasterStyle('https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'),
    center:coords[0],zoom:12,scrollZoom:false,attributionControl:true
  });
  map.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
  const addPin=(title,point,color)=>{
    const node=document.createElement('div');
    node.style.cssText='width:28px;height:28px;border:3px solid #fff;border-radius:50% 50% 50% 7px;transform:rotate(-45deg);background:'+color+';box-shadow:0 2px 8px #0005';
    new maplibregl.Marker({element:node,anchor:'bottom'}).setLngLat([point.longitude,point.latitude])
      .setPopup(new maplibregl.Popup({offset:12}).setText(title)).addTo(map);
  };
  if(route.pickup)addPin('Pickup',route.pickup,'#21664e');
  if(route.dropoff)addPin('Drop-off',route.dropoff,'#a56924');
  map.on('style.load',()=>{
    if(map.getSource('quoted-route')) return;
    map.addSource('quoted-route',{type:'geojson',data:feature});
    map.addLayer({id:'quoted-route-shadow',type:'line',source:'quoted-route',paint:{'line-color':'#102b20','line-width':12,'line-opacity':.18,'line-cap':'round','line-join':'round'}});
    map.addLayer({id:'quoted-route-casing',type:'line',source:'quoted-route',paint:{'line-color':'#fff','line-width':9,'line-opacity':.96,'line-cap':'round','line-join':'round'}});
    map.addLayer({id:'quoted-route-line',type:'line',source:'quoted-route',paint:{'line-color':'#176b52','line-width':5,'line-opacity':1,'line-cap':'round','line-join':'round'}});
    const lngs=coords.map(p=>p[0]),lats=coords.map(p=>p[1]);
    map.fitBounds([[Math.min(...lngs),Math.min(...lats)],[Math.max(...lngs),Math.max(...lats)]],{padding:36,maxZoom:15});
    map.resize();
  });
  let fallbackUsed=false;
  let tileWatchdog=setTimeout(()=>{
    if(fallbackUsed)return;
    fallbackUsed=true;
    map.setStyle(rasterStyle('https://tile.openstreetmap.org/{z}/{x}/{y}.png'));
    onTileError(new Error('Detailed map tiles timed out; switched to the lightweight map.'));
    tileWatchdog=setTimeout(()=>onTileError(new Error('Map tiles are still slow. Use the directions link to verify the route.')),10000);
  },10000);
  map.on('idle',()=>clearTimeout(tileWatchdog));
  map.on('error',event=>{if(event?.error)onTileError(event.error);});
  requestAnimationFrame(()=>map.resize());
  return map;
};

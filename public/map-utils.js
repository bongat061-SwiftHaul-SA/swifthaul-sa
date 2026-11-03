window.renderDeliveryMap = (element, route, onTileError = () => {}) => {
  if (!window.L) throw new Error('The map could not load. Reload this page or open directions.');
  element.hidden = false;
  const map = L.map(element,{scrollWheelZoom:false,zoomAnimation:false,fadeAnimation:false,markerZoomAnimation:false}).setView([route.pickup.latitude,route.pickup.longitude],12);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',maxZoom:19}).on('tileerror',onTileError).addTo(map);
  const line = L.polyline(route.coordinates.map(([lon,lat])=>[lat,lon]),{color:'#21664e',weight:5,opacity:0.9}).addTo(map);
  for (const [title,point,color] of [['Pickup',route.pickup,'#21664e'],['Drop-off',route.dropoff,'#a56924']]) {
    const label=document.createElement('span');label.textContent=title;
    L.circleMarker([point.latitude,point.longitude],{radius:8,color:'#fff',weight:3,fillColor:color,fillOpacity:1}).bindTooltip(label,{permanent:true,direction:'top',offset:[0,-8]}).addTo(map);
  }
  map.fitBounds(line.getBounds().extend([route.pickup.latitude,route.pickup.longitude]).extend([route.dropoff.latitude,route.dropoff.longitude]),{padding:[40,45],maxZoom:15,animate:false});
  return map;
};

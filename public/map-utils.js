window.renderDeliveryMap = (element, route, onTileError = () => {}) => {
  if (!window.L || !window.SwiftHaulMaps) {
    throw new Error('The shared map could not load. Reload this page or open directions.');
  }

  element.hidden = false;
  const controller = window.SwiftHaulMaps.createMap(element, {
    scope: 'customer-route-preview',
    tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
    tileOptions: { maxZoom: 19 },
    leaflet: {
      scrollWheelZoom: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false
    }
  });
  const map = controller.map;
  const routes = controller.layers.get('routes').group;
  const markers = controller.layers.get('markers').group;

  controller.layers.get('tiles').group.eachLayer(layer => {
    if (typeof layer.on === 'function') layer.on('tileerror', onTileError);
  });

  const routePoints = route.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
  L.polyline(routePoints, { color: '#102b20', weight: 12, opacity: 0.18, lineCap: 'round', lineJoin: 'round' }).addTo(routes);
  L.polyline(routePoints, { color: '#ffffff', weight: 9, opacity: 0.96, lineCap: 'round', lineJoin: 'round' }).addTo(routes);
  const line = L.polyline(routePoints, { color: '#176b52', weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', dashArray: '1 0' }).addTo(routes);

  for (const [title, point, color] of [
    ['Pickup', route.pickup, '#21664e'],
    ['Drop-off', route.dropoff, '#a56924']
  ]) {
    const label = document.createElement('span');
    label.textContent = title;
    const pin = document.createElement('span');
    pin.className = 'swift-map-pin ' + (title === 'Pickup' ? 'pickup' : 'dropoff');
    pin.setAttribute('aria-label', title);
    pin.style.setProperty('--pin-color', color);
    L.marker([point.latitude, point.longitude], {
      icon: L.divIcon({ className: 'swift-map-pin-wrap', html: pin.outerHTML, iconSize: [28, 38], iconAnchor: [14, 35] }),
      zIndexOffset: title === 'Pickup' ? 900 : 1000
    }).bindTooltip(label, { permanent: true, direction: 'top', offset: [0, -26], className: 'swift-map-tooltip' }).addTo(markers);
  }

  const bounds = line.getBounds()
    .extend([route.pickup.latitude, route.pickup.longitude])
    .extend([route.dropoff.latitude, route.dropoff.longitude]);
  controller.camera.move({ bounds, maxZoom: 15 }, 0, 'customer-route-preview');
  map.invalidateSize();
  return map;
};

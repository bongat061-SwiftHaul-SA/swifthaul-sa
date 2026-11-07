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

  const line = L.polyline(
    route.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
    { color: '#21664e', weight: 5, opacity: 0.9 }
  ).addTo(routes);

  for (const [title, point, color] of [
    ['Pickup', route.pickup, '#21664e'],
    ['Drop-off', route.dropoff, '#a56924']
  ]) {
    const label = document.createElement('span');
    label.textContent = title;
    L.circleMarker([point.latitude, point.longitude], {
      radius: 8,
      color: '#fff',
      weight: 3,
      fillColor: color,
      fillOpacity: 1
    }).bindTooltip(label, {
      permanent: true,
      direction: 'top',
      offset: [0, -8]
    }).addTo(markers);
  }

  const bounds = line.getBounds()
    .extend([route.pickup.latitude, route.pickup.longitude])
    .extend([route.dropoff.latitude, route.dropoff.longitude]);
  controller.camera.move({ bounds, maxZoom: 15 }, 0, 'customer-route-preview');
  map.invalidateSize();
  return map;
};

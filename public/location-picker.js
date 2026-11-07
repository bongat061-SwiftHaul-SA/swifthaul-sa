(() => {
  const form = document.getElementById('booking-form');
  const pickup = document.getElementById('custPickup');
  const dropoff = document.getElementById('custDropoff');
  if (!form || !pickup || !dropoff || document.getElementById('delivery-map-stage')) return;

  const style = document.createElement('style');
  style.textContent = [
    '#delivery-map-stage{position:relative;height:clamp(590px,76vh,760px);min-height:590px;margin:-28px -28px 26px;overflow:hidden;background:#e9eee9;isolation:isolate}',
    '#global-location-map{position:absolute;inset:0;width:100%;height:100%;background:#e9eee9}',
    '#global-location-map .leaflet-control-attribution{font-size:9px;background:#ffffffd9}',
    '.swift-location-sheet{position:absolute;z-index:700;left:18px;right:18px;bottom:18px;max-height:68%;overflow-y:auto;overscroll-behavior:contain;padding:20px;background:#fff;border:1px solid #d9e1d9;border-radius:16px;box-shadow:0 14px 42px #102c2533}',
    '.swift-sheet-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}',
    '.swift-sheet-head h3{font-size:16px;line-height:1.3;margin:0;color:#17352e}',
    '.swift-sheet-head p{margin:4px 0 0;font-size:10px;color:#61776f}',
    '.swift-route-steps{display:flex;align-items:center;gap:8px;color:#61776f;font-size:10px;font-weight:800;letter-spacing:.7px;text-transform:uppercase}',
    '.swift-route-steps .step-dot{width:9px;height:9px;border-radius:50%;background:#21664e;display:inline-block}',
    '.swift-route-steps .step-dot.drop{background:#2475c7}',
    '.swift-route-steps .step-line{width:22px;height:2px;background:#9caaa0}',
    '.swift-location-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.swift-location-fields .field{margin:0;min-width:0}',
    '.swift-location-fields .field label{font-size:10px;font-weight:800;color:#526d5d}',
    '.swift-location-fields input{padding:12px 13px;font-size:12px;margin-top:6px}',
    '.swift-location-fields .address-suggestions{z-index:1300}',
    '.swift-pin-button{margin:7px 0 0!important;padding:7px 9px!important;border-radius:7px!important;font-size:10px!important;background:#f3f6f1!important;color:#315b48!important;border:1px solid #d9e1d9!important}',
    '.swift-pin-button[aria-pressed=true]{background:#e7f1e5!important;border-color:#8eb59a!important}',
    '.swift-sheet-tools{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:12px}',
    '.swift-sheet-tools button{padding:9px 12px;font-size:10px}',
    '.swift-sheet-tools .swift-current{background:#173d31;color:#fff;border-color:#173d31}',
    '.swift-pin-meta{display:flex;align-items:center;gap:8px;min-width:0;margin-top:12px;padding:9px 11px;border-radius:9px;background:#f3f6f1;color:#526d5d;font-size:10px}',
    '.swift-pin-meta strong{color:#17352e;font:700 11px ui-monospace,monospace;overflow-wrap:anywhere}',
    '#loc-status{font-size:10px;line-height:1.5;color:#61776f;margin:8px 0 0;min-height:15px}',
    '.swift-sheet-quote{margin-top:12px}',
    '.swift-sheet-quote #calculate-route{width:100%;padding:13px;background:#21664e;color:#fff;border-color:#21664e}',
    '.swift-sheet-quote #quote-result{margin:12px 0 0;padding:12px 0 0;border-top:1px solid #e1e8df}',
    '.swift-sheet-quote #quote-result h3{margin:0 0 8px}',
    '.swift-sheet-quote #quote-map{height:170px}',
    '.swift-map-marker{width:34px;height:34px;border:3px solid #fff;border-radius:50% 50% 50% 8px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 12px #17352e55}',
    '.swift-map-marker span{transform:rotate(45deg);font-size:16px;font-weight:900;color:#fff;line-height:1}',
    '.swift-map-marker.pickup{background:#21664e}',
    '.swift-map-marker.dropoff{background:#2475c7}',
    '@media(max-width:650px){#delivery-map-stage{height:min(82svh,790px);min-height:650px;margin:-22px -22px 22px}.swift-location-sheet{left:10px;right:10px;bottom:10px;max-height:72%;padding:15px;border-radius:16px}.swift-location-fields{grid-template-columns:1fr;gap:9px}.swift-location-fields .field input{padding:11px}.swift-sheet-head h3{font-size:15px}.swift-sheet-tools{margin-top:9px}.swift-sheet-quote #quote-result{font-size:11px}}'
    '#delivery-map-stage{height:clamp(650px,82vh,900px);min-height:650px;margin:-30px -30px 28px;border-radius:0 0 22px 22px;background:#e8eeea;box-shadow:0 12px 30px #12251d18}',
    '#global-location-map{background:#e9efec}',
    '#global-location-map .leaflet-tile-pane{filter:saturate(.78) brightness(1.035)}',
    '#global-location-map .leaflet-control-zoom{margin:18px;border:0;border-radius:13px;overflow:hidden;box-shadow:0 4px 16px #102c2524}',
    '#global-location-map .leaflet-control-zoom a{width:42px;height:42px;line-height:42px;border:0;color:#142d23;font-size:20px}',
    '.swift-location-sheet{left:16px;right:16px;bottom:16px;max-height:56%;padding:20px 22px;border:1px solid #e7ece8;border-radius:24px;box-shadow:0 18px 55px #102c2530}',
    '.swift-sheet-head{align-items:flex-start;margin-bottom:16px}',
    '.swift-sheet-head h3{font-size:18px;font-weight:850;letter-spacing:-.6px;color:#14231e}',
    '.swift-sheet-head p{font-size:11px;color:#77837d}',
    '.swift-route-steps{padding:8px 11px;border-radius:999px;background:#f1f5f2;font-size:9px;white-space:nowrap}',
    '.swift-location-fields{grid-template-columns:1fr;gap:8px}',
    '.swift-location-fields .field{position:relative;padding-left:22px}',
    '.swift-location-fields .field:before{content:"";position:absolute;left:3px;top:17px;width:10px;height:10px;border-radius:50%;background:#176b52;box-shadow:0 0 0 4px #e5f1ea}',
    '.swift-location-fields .field:nth-child(2):before{border-radius:3px;background:#2675c8;box-shadow:0 0 0 4px #e7f0fa}',
    '.swift-location-fields .field label{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:#77837d}',
    '.swift-location-fields input{height:43px;min-height:43px;margin-top:4px;padding:10px 13px;border-radius:11px;background:#f8faf8;font-size:12px}',
    '.swift-pin-button{margin:4px 0 0!important;padding:5px 8px!important;border-radius:8px!important;font-size:9px!important}',
    '.swift-sheet-tools{justify-content:flex-start;margin-top:10px}',
    '.swift-sheet-tools button{min-height:36px;padding:8px 11px;border-radius:10px;font-size:10px}',
    '.swift-sheet-tools .swift-current{background:#142d23;border-color:#142d23}',
    '.swift-pin-meta{margin-top:9px;border-radius:10px;background:#f5f7f5}',
    '#loc-status{font-size:10px}',
    '.swift-sheet-quote{margin-top:10px}',
    '.swift-sheet-quote #calculate-route{min-height:48px;border-radius:13px;background:#142d23;border-color:#142d23;font-size:12px;font-weight:800}',
    '.swift-sheet-quote #quote-result{padding-top:12px}',
    '.swift-sheet-quote #quote-map{height:190px;border-radius:14px}',
    '.swift-map-marker{width:38px;height:38px;border-radius:50% 50% 50% 8px}',
    '.swift-map-marker span{font-size:15px}',
    '@media(max-width:650px){#delivery-map-stage{height:78svh;min-height:650px;margin:-22px -18px 22px;border-radius:0 0 20px 20px}.swift-location-sheet{left:10px;right:10px;bottom:10px;max-height:58%;padding:15px 16px;border-radius:21px}.swift-sheet-head{gap:8px}.swift-sheet-head h3{font-size:15px}.swift-route-steps{gap:5px;padding:7px 8px;font-size:8px}.swift-location-fields{gap:6px}.swift-location-fields input{height:40px;min-height:40px}.swift-sheet-tools{gap:6px}.swift-sheet-tools button{padding:7px 9px;font-size:9px}.swift-pin-meta{margin-top:7px}.swift-sheet-quote #quote-result{font-size:10px}}'
  ].join('\n');
  style.textContent += [
    '#delivery-map-stage{height:clamp(650px,84vh,900px)!important;min-height:650px!important;margin:0!important;border-radius:20px!important}',
    '.swift-location-sheet{left:clamp(12px,2vw,24px)!important;right:clamp(12px,2vw,24px)!important;bottom:clamp(12px,2vw,24px)!important;max-height:76%!important;overflow-y:auto!important;padding:18px!important;border-radius:22px!important}',
    '.swift-sheet-head{margin-bottom:12px!important}',
    '.swift-sheet-head h3{font-size:17px!important;font-weight:850!important;letter-spacing:-.5px!important}',
    '.swift-location-fields{grid-template-columns:1fr!important;gap:7px!important}',
    '.swift-location-fields .field{padding-left:20px!important}',
    '.swift-location-fields input{min-height:42px!important;height:42px!important;margin-top:4px!important;padding:10px 12px!important}',
    '.swift-location-fields .field label{font-size:9px!important;letter-spacing:.65px!important;text-transform:uppercase!important}',
    '.swift-location-fields .field:before{top:15px!important}',
    '.swift-pin-button{margin-top:3px!important;padding:5px 8px!important;font-size:9px!important}',
    '.swift-location-sheet .parcel-fields{margin:10px 0!important;padding:12px!important;border:1px solid #e8edea!important;border-radius:14px!important;background:#fbfcfb!important}',
    '.swift-location-sheet .parcel-fields legend{margin-bottom:7px!important}',
    '.swift-location-sheet .parcel-fields>p.subtle{display:none!important}',
    '.swift-location-sheet .load-grid{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}',
    '.swift-location-sheet .load-grid label{font-size:9px!important;min-width:0!important}',
    '.swift-location-sheet #cargo-estimator{margin:9px 0 12px!important;padding:13px!important;border:1px solid #e4ebe6!important;border-radius:15px!important;background:#f3f7f4!important}',
    '.swift-location-sheet #cargo-estimator h3{font-size:13px!important;margin:0 0 5px!important}',
    '.swift-location-sheet #cargo-estimator p{font-size:10px!important;line-height:1.45!important;margin:6px 0!important}',
    '.swift-location-sheet #cargo-estimator textarea,.swift-location-sheet #cargo-estimator input[type=file]{font-size:11px!important;border-radius:10px!important}',
    '.swift-location-sheet #cargo-estimator .cargo-actions button{min-height:38px!important;padding:9px 12px!important;font-size:10px!important;border-radius:10px!important}',
    '.swift-location-sheet #cargo-estimator .cargo-range{font-size:14px!important}',
    '.swift-location-sheet .load-grid input{min-height:39px!important;height:39px!important;padding:8px!important;font-size:11px!important}',
    '.swift-location-sheet #load-summary{margin:7px 0 0!important;font-size:10px!important;min-height:0!important}',
    '.swift-more-options{margin:9px 0!important;border:1px solid #e7ece8!important;border-radius:13px!important;background:#fff!important}',
    '.swift-more-options>summary{padding:12px 13px!important;color:#34443d!important;font-size:11px!important;font-weight:800!important;cursor:pointer!important;list-style:none!important}',
    '.swift-more-options>summary::-webkit-details-marker{display:none!important}',
    '.swift-more-options>summary:after{content:"＋";float:right;color:#176b52!important}',
    '.swift-more-options[open]>summary:after{content:"−"}',
    '.swift-more-content{padding:0 12px 10px!important}',
    '.swift-more-content fieldset{margin:10px 0!important;padding:11px!important}',
    '.swift-more-content .subtle{font-size:10px!important}',
    '.swift-sheet-quote{margin-top:10px!important}',
    '.swift-sheet-quote #quote-status{margin:7px 0!important;min-height:0!important;font-size:10px!important}',
    '.swift-sheet-quote #calculate-route{width:100%!important;min-height:46px!important;border-radius:12px!important;background:#142d23!important;border-color:#142d23!important;font-weight:800!important}',
    '.swift-sheet-quote #quote-result{margin:10px 0!important;padding:12px!important;border:1px solid #e5eee8!important;border-radius:14px!important;background:#f7faf8!important}',
    '.swift-sheet-quote #quote-result>p.subtle:nth-of-type(n+2){display:none!important}',
    '.swift-sheet-quote #quote-map{height:150px!important;border-radius:12px!important}',
    '.swift-sheet-quote .quote-totals strong{font-size:21px!important}',
    '.swift-booking-actions{position:sticky!important;bottom:-18px!important;z-index:5!important;margin:12px -18px -18px!important;padding:12px 18px 14px!important;background:#fff!important;border-top:1px solid #e8edea!important;box-shadow:0 -8px 20px #fff!important}',
    '.swift-booking-actions #submit{width:100%!important;min-height:52px!important;border-radius:13px!important;background:#142d23!important;border-color:#142d23!important}',
    '.swift-booking-actions #message{margin:6px 0 0!important;font-size:10px!important}',
    '@media(max-width:650px){#delivery-map-stage{height:88svh!important;min-height:660px!important;margin:0!important;border-radius:18px!important}.swift-location-sheet{left:9px!important;right:9px!important;bottom:9px!important;max-height:77%!important;padding:13px!important;border-radius:19px!important}.swift-sheet-head h3{font-size:15px!important}.swift-location-fields{gap:5px!important}.swift-location-fields input{min-height:39px!important;height:39px!important}.swift-location-sheet .load-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.swift-location-sheet .load-grid input{min-height:37px!important;height:37px!important}.swift-booking-actions{bottom:-13px!important;margin:10px -13px -13px!important;padding:10px 13px 12px!important}.swift-sheet-quote #quote-map{height:125px!important}}'
  ].join('\n');
  document.head.append(style);

  const pickupWrap = pickup.closest('.field');
  const dropoffWrap = dropoff.closest('.field');
  if (!pickupWrap || !dropoffWrap) return;

  const stage = document.createElement('section');
  stage.id = 'delivery-map-stage';
  stage.setAttribute('aria-label', 'Delivery route map and location selector');
  stage.innerHTML = '<div id="global-location-map" role="application" aria-label="Interactive map showing pickup and drop-off locations. Tap the map to place the selected pin or drag a marker."></div>' +
    '<section class="swift-location-sheet" aria-label="Pickup and drop-off details">' +
    '<div class="swift-sheet-head"><div><h3>Where should we collect and deliver?</h3><p>Choose an address, then confirm the exact point on the map.</p></div>' +
    '<div class="swift-route-steps" aria-label="Pickup to drop-off"><span class="step-dot"></span><span>Pickup</span><span class="step-line"></span><span class="step-dot drop"></span><span>Drop-off</span></div></div>' +
    '<div class="swift-location-fields"></div>' +
    '<div class="swift-sheet-tools"><button type="button" id="loc-current" class="swift-current">◎ Use my location</button><button type="button" id="loc-open">Re-centre map</button><button type="button" id="loc-copy-plus" disabled>Copy Plus Code</button><a href="https://www.openstreetmap.org/?mlat=-26.32517&amp;mlon=28.19535#map=14/-26.32517/28.19535&amp;layers=T" target="_blank" rel="noopener noreferrer" style="font-size:10px;color:#21664e;font-weight:700">Open transport map ↗</a></div>' +
    '<div class="swift-pin-meta"><span>Selected pin</span><strong id="loc-plus">Choose pickup or drop-off</strong></div>' +
    '<p id="loc-status" role="status" aria-live="polite">Select a pickup or drop-off field, then tap the map to fine-tune its pin.</p>' +
    '<div class="swift-sheet-quote"></div></section>';
  form.insertBefore(stage, pickupWrap);
  const fields = stage.querySelector('.swift-location-fields');
  fields.append(pickupWrap, dropoffWrap);

  const calculate = document.getElementById('calculate-route');
  const quote = document.getElementById('quote-result');
  const sheet = stage.querySelector('.swift-location-sheet');
  const quoteArea = stage.querySelector('.swift-sheet-quote');
  const recipientWrap = document.getElementById('custRecip')?.closest('.field');
  if (recipientWrap) fields.append(recipientWrap);

  const parcelFields = form.querySelector('.parcel-fields');
  if (parcelFields) sheet.insertBefore(parcelFields, quoteArea);

  const vehicleFieldset = form.querySelector('input[name="vehicle"]')?.closest('fieldset');
  if (vehicleFieldset) vehicleFieldset.hidden = true;

  const moreOptions = document.createElement('details');
  moreOptions.className = 'swift-more-options';
  const moreSummary = document.createElement('summary');
  moreSummary.textContent = 'More options · pickup time, return and payment';
  const moreContent = document.createElement('div');
  moreContent.className = 'swift-more-content';
  moreOptions.append(moreSummary, moreContent);
  for (const selector of ['#schedule-later', '#request-return', '#payment-method']) {
    const fieldset = form.querySelector(selector)?.closest('fieldset');
    if (fieldset) moreContent.append(fieldset);
  }
  const pricingNote = form.querySelector('a[href="terms.html#pricing"]')?.closest('p');
  if (pricingNote) moreContent.append(pricingNote);
  sheet.insertBefore(moreOptions, quoteArea);

  const quoteStatus = document.getElementById('quote-status');
  if (quoteStatus) quoteArea.append(quoteStatus);
  if (calculate) quoteArea.append(calculate);
  if (quote) quoteArea.append(quote);

  const bookingActions = document.createElement('div');
  bookingActions.className = 'swift-booking-actions';
  const submitButton = document.getElementById('submit');
  const bookingMessage = document.getElementById('message');
  if (submitButton) bookingActions.append(submitButton);
  if (bookingMessage) bookingActions.append(bookingMessage);
  quoteArea.append(bookingActions);

  const $ = id => document.getElementById(id);
  const state = { pickup: null, dropoff: null };
  let map = null;
  let mapController = null;
  let activeField = pickup;
  let routeLine = null;
  let selectedCode = '';

  const geohash = (lat, lng, precision = 9) => {
    const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
    let latRange = [-90, 90], lngRange = [-180, 180], even = true, bits = 0, ch = 0, out = '';
    while (out.length < precision) {
      const range = even ? lngRange : latRange, mid = (range[0] + range[1]) / 2;
      ch <<= 1;
      if ((even ? lng : lat) >= mid) { ch |= 1; range[0] = mid; } else range[1] = mid;
      even = !even;
      if (++bits === 5) { out += alphabet[ch]; bits = 0; ch = 0; }
    }
    return out;
  };
  const hiddenField = name => {
    let input = form.querySelector('[name="' + name + '"]');
    if (!input) { input = document.createElement('input'); input.type = 'hidden'; input.name = name; form.append(input); }
    return input;
  };
  const markerIcon = kind => L.divIcon({
    className: '',
    html: '<div class="swift-map-marker ' + kind + '"><span>' + (kind === 'pickup' ? 'P' : 'D') + '</span></div>',
    iconSize: [34, 42], iconAnchor: [17, 38]
  });
  function ensureMap() {
    if (map || !window.L) return;
    mapController = window.SwiftHaulMaps?.createMap('global-location-map', {scope:'customer-booking'});
    if (!mapController) { $('loc-status').textContent = 'Shared map services are unavailable. Reload the page.'; return; }
    map = mapController.map;
    mapController.camera.move({lat:-26.32516865200042,lng:28.195352552065742,zoom:14},0,'customer-booking');
    mapController.padding.add(new window.SwiftHaulMaps.MapPaddingSource(stage.querySelector('.swift-location-sheet')), 'customer-booking');
    L.control.zoom({ position: 'topright' }).addTo(map);
    map.on('click', event => {
      if (activeField) saveLocation(activeField, event.latlng.lat, event.latlng.lng, 'Map pin adjusted. Check the address and Plus Code.');
    });
    setTimeout(() => map.invalidateSize(), 120);
  }
  function fitLocations() {
    if (!map) return;
    const points = ['pickup', 'dropoff'].filter(key => state[key]).map(key => [state[key].lat, state[key].lng]);
    if (points.length === 2) {
      mapController.camera.move({bounds:points,zoom:15},0,'customer-booking');
      if (routeLine) routeLine.setLatLngs(points);
      else routeLine = L.polyline(points, { color: '#173d31', weight: 5, opacity: .92, lineCap: 'round', dashArray: '9 8' }).addTo(mapController.layers.get('routes').group);
    } else if (points.length === 1) {
      mapController.camera.move({lat:points[0][0],lng:points[0][1],zoom:16},0,'customer-booking');
      if (routeLine) { routeLine.remove(); routeLine = null; }
    }
  }
  window.swiftHaulSetRoadRoute = route => {
    ensureMap();
    if (!map || !route?.coordinates?.length) return false;
    const points = route.coordinates.map(([longitude, latitude]) => [latitude, longitude]);
    if (routeLine) routeLine.setLatLngs(points);
    else routeLine = L.polyline(points, { color:'#176b52', weight:6, opacity:.96, lineCap:'round', lineJoin:'round' }).addTo(mapController.layers.get('routes').group);
    const bounds = routeLine.getBounds();
    mapController.camera.move({bounds, maxZoom:15}, 250, 'customer-booking');
    setTimeout(() => map.invalidateSize(), 80);
    $('loc-status').textContent = 'Road route loaded. Adjust either pin if the pickup or drop-off entrance is incorrect.';
    return true;
  };

  function saveLocation(input, lat, lng, message) {
    if (!window.OpenLocationCode || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      $('loc-status').textContent = 'The Plus Code library is still loading. Please try again shortly.';
      return;
    }
    const key = input.name === 'pickup' ? 'pickup' : 'dropoff';
    const code = window.OpenLocationCode.encode(lat, lng, 10);
    const hash = geohash(lat, lng);
    state[key] = { lat, lng, code, hash };
    Object.entries({ latitude: lat, longitude: lng, plus_code: code, geohash: hash }).forEach(([suffix, value]) => {
      hiddenField(key + '_' + suffix).value = String(value);
    });
    const pinButton = input.parentElement.querySelector('.swift-pin-button');
    if (pinButton) { pinButton.setAttribute('aria-pressed', 'true'); pinButton.textContent = '✓ Pin confirmed'; }
    activeField = input;
    selectedCode = code;
    $('loc-plus').textContent = code;
    $('loc-copy-plus').disabled = false;
    $('loc-status').textContent = message || (key === 'pickup' ? 'Pickup pin saved.' : 'Drop-off pin saved.');
    if (map) {
      if (state[key].marker) state[key].marker.setLatLng([lat, lng]);
      else state[key].marker = L.marker([lat, lng], { draggable: true, icon: markerIcon(key), title: key === 'pickup' ? 'Pickup point' : 'Drop-off point' }).addTo(mapController.layers.get('markers').group);
      state[key].marker.off('dragend');
      state[key].marker.on('dragend', event => {
        const p = event.target.getLatLng();
        saveLocation(input, p.lat, p.lng, 'Pin moved. The updated location is saved.');
      });
      fitLocations();
    }
  }

  window.swiftHaulShowAddressOnMap = (input, lat, lng) => {
    activeField = input;
    ensureMap();
    if (!map) return;
    saveLocation(input, Number(lat), Number(lng), 'Address matched. Check the pin and adjust it if the entrance is different.');
    setTimeout(() => map.invalidateSize(), 100);
  };

  for (const [input, label] of [[pickup, 'pickup'], [dropoff, 'drop-off']]) {
    const key = input.name === 'pickup' ? 'pickup' : 'dropoff';
    input.addEventListener('focus', () => { activeField = input; });
    input.addEventListener('input', () => {
      if (input.dataset.justSelected === 'true') return;
      const previous = state[key];
      if (previous?.marker && map) map.removeLayer(previous.marker);
      delete state[key];
      if (routeLine) { routeLine.remove(); routeLine = null; }
      const remaining = state.pickup || state.dropoff;
      if (remaining && map) mapController.camera.move({lat:remaining.lat,lng:remaining.lng,zoom:15},0,'customer-booking');
      const pin = input.parentElement.querySelector('.swift-pin-button');
      if (pin) { pin.setAttribute('aria-pressed', 'false'); pin.textContent = '◎ Adjust ' + label + ' pin on map'; }
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'swift-pin-button';
    button.textContent = '◎ Adjust ' + label + ' pin on map';
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      activeField = input;
      ensureMap();
      stage.scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('loc-status').textContent = 'Tap the map or drag the ' + label + ' marker to the exact point.';
      setTimeout(() => map && map.invalidateSize(), 140);
    });
    input.insertAdjacentElement('afterend', button);
  }

  $('loc-open').addEventListener('click', () => {
    ensureMap();
    if (!map) { $('loc-status').textContent = 'Map is still loading. Please try again.'; return; }
    fitLocations();
    if (!state.pickup && !state.dropoff) mapController.camera.move({lat:-26.32516865200042,lng:28.195352552065742,zoom:14},0,'customer-booking');
    setTimeout(() => map.invalidateSize(), 100);
  });
  $('loc-current').addEventListener('click', () => {
    if (!navigator.geolocation) { $('loc-status').textContent = 'This device does not support location sharing. You can still place a pin manually.'; return; }
    $('loc-status').textContent = 'Requesting location permission…';
    navigator.geolocation.getCurrentPosition(position => {
      ensureMap();
      saveLocation(activeField || pickup, position.coords.latitude, position.coords.longitude, 'Your device location is selected. Check the pin before continuing.');
    }, error => {
      $('loc-status').textContent = error.code === 1 ? 'Location permission was denied. You can still place a pin manually.' : 'Could not get your location. Place a pin manually instead.';
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
  $('loc-copy-plus').addEventListener('click', async () => {
    if (!selectedCode) return;
    try { await navigator.clipboard.writeText(selectedCode); $('loc-status').textContent = 'Plus Code copied: ' + selectedCode; }
    catch { $('loc-status').textContent = 'Copy was blocked by the browser. Select the code and copy it manually.'; }
  });

  const revealObserver = new MutationObserver(() => {
    if (!document.getElementById('workspace')?.hidden) {
      ensureMap();
      setTimeout(() => map && map.invalidateSize(), 180);
      revealObserver.disconnect();
    }
  });
  revealObserver.observe(document.getElementById('workspace'), { attributes: true, attributeFilter: ['hidden'] });
  if (!document.getElementById('workspace')?.hidden) { ensureMap(); setTimeout(() => map && map.invalidateSize(), 180); }
})();
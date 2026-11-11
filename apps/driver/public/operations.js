const app = document.body.dataset.app;
if (app === 'driver' || app === 'company') {
  const panel = document.getElementById('dispatches');
  const historyList = () => document.getElementById('driver-delivery-history-list');
  const heading = panel.querySelector('h2');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh deliveries';
  const offerPanel = document.createElement('section');
  offerPanel.className = 'driver-stacked-offers';
  offerPanel.setAttribute('aria-label', 'Incoming delivery offers');
  const itineraryPanel = document.createElement('section');
  itineraryPanel.className = 'driver-itinerary-panel';
  const list = document.createElement('div');
  list.className = 'operations-list';
  panel.replaceChildren(heading, refresh, message, offerPanel, itineraryPanel, list);

  let active = false;
  let requestNumber = 0;
  let offerCountdowns = [];
  const activeTrackingCleanups = new Set();
  const money = value => 'R' + Number(value || 0).toFixed(2);
  const statusLabel = value => ({
    pending: 'Awaiting dispatch', assigned: 'Assigned', accepted: 'Accepted',
    picked_up: 'Picked up', in_transit: 'In transit', delivered: 'Delivered',
    failed: 'Failed delivery', cancelled: 'Cancelled'
  }[value] || value || 'Unknown');

  async function invoke(method, body) {
    const client = window.swiftHaulSupabase;
    if (!client) throw new Error('Secure account connection is unavailable. Reload the page.');
    const { data, error } = await client.functions.invoke('dispatch-operations', {
      method,
      ...(body ? { body } : {})
    });
    if (error) throw new Error(data?.error || error.message || 'Dispatch request failed.');
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function loadIncomingOffers(currentOrders = []) {
    if (app !== 'driver') return;
    for (const timer of offerCountdowns) clearInterval(timer);
    offerCountdowns = [];
    offerPanel.replaceChildren();
    try {
      const client = window.swiftHaulSupabase;
      const { data, error } = await client.functions.invoke('dispatch-offers', { method: 'GET' });
      if (error || data?.error) throw new Error(data?.error || error?.message || 'Unable to load offers.');
      const offers = data?.offers || [];
      if (!offers.length) return;
      const heading = document.createElement('h3');
      heading.textContent = 'Incoming delivery requests';
      offerPanel.append(heading);
      const currentNet = currentOrders.filter(o => !['delivered','failed','cancelled'].includes(o.status)).reduce((sum,o)=>sum+Number(o.price||0)*0.75,0);
      for (const offer of offers) {
        const booking = Array.isArray(offer.customer_bookings) ? offer.customer_bookings[0] : offer.customer_bookings || {};
        const card = document.createElement('article');
        card.className = 'order driver-offer-card';
        const title = document.createElement('h4');
        title.textContent = offer.add_on_order ? 'Add-On Order' : 'New delivery request';
        const payout = document.createElement('p');
        payout.className = 'driver-offer-payout';
        payout.textContent = (offer.add_on_order ? 'Add-On Order · ' : 'Net payout · ') + money(offer.net_payout_zar);
        const route = document.createElement('p');
        route.textContent = (booking.pickup || 'Pickup') + ' → ' + (booking.dropoff || 'Drop-off');
        const countdown = document.createElement('small');
        countdown.className = 'driver-offer-countdown';
        const updateCountdown = () => {
          const remaining = Math.max(0, Math.ceil((new Date(offer.expires_at).getTime() - Date.now()) / 1000));
          countdown.textContent = remaining ? 'Offer expires in ' + remaining + 's' : 'Offer expired';
          if (!remaining) {
            for (const button of actions.querySelectorAll('button')) button.disabled = true;
          }
        };
        updateCountdown();
        const timer = setInterval(updateCountdown, 250);
        offerCountdowns.push(timer);
        const detail = document.createElement('p');
        detail.textContent = offer.add_on_order
          ? (offer.extra_detour_km == null ? 'Matches your active route corridor' : '+' + Number(offer.extra_detour_km).toFixed(1) + ' km estimated detour') + ' · Combined route net ' + money(currentNet + Number(offer.net_payout_zar || 0))
          : (Number(offer.distance_meters || 0) / 1000).toFixed(1) + ' km pickup distance';
        const actions = document.createElement('div');
        actions.className = 'driver-offer-actions';
        for (const [label,response] of [['Accept','accept'],['Decline','decline']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = label;
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              const result = await client.functions.invoke('dispatch-offers', { body: { action: 'respond_offer', offer_id: offer.id, response } });
              if (result.error || result.data?.error) throw new Error(result.data?.error || result.error?.message || 'Unable to respond to offer.');
              await load();
            } catch (error) {
              message.textContent = error.message || 'Unable to respond to offer.';
              button.disabled = false;
            }
          });
          actions.append(button);
        }
        card.append(title,payout,route,countdown,detail,actions);
        offerPanel.append(card);
      }
    } catch (error) {
      const note = document.createElement('p');
      note.textContent = error.message || 'Incoming offers are temporarily unavailable.';
      offerPanel.append(note);
    }
  }

  async function renderItinerary(routeStops = [], orders = [], driverProfile = {}) {
    if (app !== 'driver') return;
    const activeOrders = orders.filter(o => ['assigned','accepted','picked_up','in_transit'].includes(o.status));
    const capacity = /motor/i.test(driverProfile.vehicle_type || '') ? 2 : /bakkie|van|panel/i.test(driverProfile.vehicle_type || '') ? 3 : /truck|ton/i.test(driverProfile.vehicle_type || '') ? 4 : 2;
    const section = document.createElement('section');
    section.className = 'driver-multi-itinerary';
    const header = document.createElement('div');
    header.className = 'driver-itinerary-header';
    const title = document.createElement('h3');
    title.textContent = 'Multi-Stop Active Itinerary';
    const counter = document.createElement('span');
    counter.className = 'driver-active-order-counter';
    counter.textContent = activeOrders.length + ' / ' + capacity + ' Active Deliveries';
    header.append(title,counter);
    const preference = document.createElement('label');
    preference.className = 'driver-stacked-preference';
    const toggle = document.createElement('input');
    toggle.type = 'checkbox';
    toggle.checked = driverProfile.allow_stacked_orders !== false;
    toggle.addEventListener('change',async()=>{
      toggle.disabled=true;
      try{
        const client=window.swiftHaulSupabase;
        const {data,error}=await client.functions.invoke('dispatch-offers',{body:{action:'set_stacked_orders',enabled:toggle.checked}});
        if(error||data?.error)throw new Error(data?.error||error?.message||'Unable to update stacked delivery preference.');
        message.textContent=toggle.checked?'Add-on delivery offers enabled.':'Add-on delivery offers paused.';
      }catch(error){toggle.checked=!toggle.checked;message.textContent=error.message||'Unable to update preference.';}
      finally{toggle.disabled=false;}
    });
    preference.append(toggle,document.createTextNode(' Allow stacked delivery offers'));
    const stopList = document.createElement('ol');
    stopList.className = 'driver-itinerary-stops';
    const visibleStops = routeStops.filter(stop=>stop.status!=='completed');
    if(!visibleStops.length){
      const empty=document.createElement('li');
      empty.textContent='Your next pickup and drop-off stops will appear here.';
      stopList.append(empty);
    } else {
      visibleStops.forEach((stop,index)=>{
        const item=document.createElement('li');
        item.className='driver-itinerary-stop';
        const meta=document.createElement('strong');
        meta.textContent='Stop '+(index+1)+' of '+visibleStops.length+' · '+String(stop.stop_type||'').toUpperCase();
        const address=document.createElement('span');
        address.textContent=stop.address||'Address confirmed on delivery';
        const ref=document.createElement('small');
        ref.textContent='Order '+String(stop.order_id||'').slice(0,10)+' · '+(stop.status==='arrived'?'Arrived':'Upcoming');
        item.append(meta,address,ref);
        const open=document.createElement('button');
        open.type='button';
        open.textContent='Open delivery';
        open.addEventListener('click',()=>{
          const target=[...list.querySelectorAll('[data-waybill]')].find(card=>card.dataset.waybill===stop.order_id);
          target?.scrollIntoView({behavior:'smooth',block:'center'});
        });
        item.append(open);
        stopList.append(item);
      });
    }
    section.append(header,preference,stopList);
    itineraryPanel.replaceChildren(section);
  }

  async function load() {
    if (!active || document.body.dataset.guestPreview === 'true') return;
    const current = ++requestNumber;
    message.textContent = 'Loading deliveries…';
    try {
      const data = await invoke('GET');
      if (current !== requestNumber) return;
      for (const cleanup of activeTrackingCleanups) cleanup();
      activeTrackingCleanups.clear();
      list.replaceChildren();
      historyList()?.replaceChildren();
      if (app === 'driver' && data.driverProfile?.verification_status !== 'approved') {
        const notice = document.createElement('p');
        notice.textContent = 'Your driver application is awaiting verification. Dispatch access will be enabled after approval.';
        list.append(notice);
      }
      await loadIncomingOffers(data.orders || []);
      if (app === 'driver') await renderItinerary(data.routeStops || [], data.orders || [], data.driverProfile || {});
      if (!data.orders?.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No deliveries are currently assigned to this account.';
        list.append(empty);

        // Keep the parcel-style map visible even before the first dispatch is assigned.
        if (app === 'driver') {
          const preview = document.createElement('section');
          preview.className = 'driver-tracking';
          const head = document.createElement('div');
          head.className = 'tracking-head';
          const heading = document.createElement('h4');
          heading.textContent = 'Live delivery map';
          const state = document.createElement('span');
          state.className = 'tracking-state';
          state.textContent = 'Awaiting assignment';
          head.append(heading, state);

          const stage = document.createElement('div');
          stage.className = 'tracking-map-stage';
          const mapElement = document.createElement('div');
          mapElement.className = 'driver-tracking-map';
          mapElement.setAttribute('role', 'region');
          mapElement.setAttribute('aria-label', 'Driver location map preview');
          const tools = document.createElement('div');
          tools.className = 'tracking-map-tools';
          const recenter = document.createElement('button');
          recenter.type = 'button';
          recenter.className = 'tracking-map-tool';
          recenter.textContent = '◎  Recenter';
          tools.append(recenter);
          stage.append(mapElement, tools);

          const sheet = document.createElement('div');
          sheet.className = 'tracking-trip-sheet';
          const etaRow = document.createElement('div');
          etaRow.className = 'tracking-eta-row';
          const eta = document.createElement('div');
          eta.className = 'tracking-eta';
          const etaValue = document.createElement('strong');
          etaValue.textContent = '—';
          const etaLabel = document.createElement('span');
          etaLabel.textContent = 'Estimated arrival';
          eta.append(etaValue, etaLabel);
          const distance = document.createElement('div');
          distance.className = 'tracking-distance';
          const distanceValue = document.createElement('strong');
          distanceValue.textContent = 'No active route';
          const distanceLabel = document.createElement('span');
          distanceLabel.textContent = 'Route appears when a delivery is assigned';
          distance.append(distanceValue, distanceLabel);
          etaRow.append(eta, distance);

          const actions = document.createElement('div');
          actions.className = 'tracking-actions';
          const start = document.createElement('button');
          start.type = 'button';
          start.className = 'primary';
          start.textContent = 'Show my location';
          const stop = document.createElement('button');
          stop.type = 'button';
          stop.textContent = 'Stop';
          stop.disabled = true;
          actions.append(start, stop);
          const note = document.createElement('p');
          note.className = 'tracking-note';
          note.textContent = 'Your map is ready. Once dispatch assigns a delivery, its pickup, destination, route and ETA will appear here. Location stays on this device in this preview.';
          const updated = document.createElement('small');
          updated.className = 'tracking-updated';
          updated.textContent = 'Your location is off.';
          sheet.append(etaRow, actions, note, updated);
          preview.append(head, sheet, stage);
          list.append(preview);

          let previewMap = null, marker = null, ring = null, watch = null, lastPoint = null, lastPosition = null;
          if (window.maplibregl) {
            previewMap = new maplibregl.Map({
              container: mapElement,
              style: {
                version: 8,
                sources: { carto: { type: 'raster', tiles: [
                  'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                  'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
                  'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
                ], tileSize: 256, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' } },
                layers: [{ id: 'carto-voyager', type: 'raster', source: 'carto' }]
              },
              center: [24.0,-29.0], zoom: 5, attributionControl: true
            });
            previewMap.addControl(new maplibregl.NavigationControl({showCompass:false}),'top-right');
            previewMap.on('load', () => { if (lastPosition) showPosition(lastPosition); });
            requestAnimationFrame(() => previewMap && previewMap.resize());
          } else {
            mapElement.textContent = 'Map library unavailable. Check your connection.';
          }
          const showPosition = position => {
            lastPosition = position;
            const { latitude, longitude, accuracy } = position.coords;
            lastPoint = [latitude, longitude];
            if (previewMap && previewMap.loaded()) {
              if (!marker) {
                const node=document.createElement('div');
                node.style.cssText='width:20px;height:20px;border:4px solid #fff;border-radius:50%;background:#176b52;box-shadow:0 1px 10px #0006';
                marker=new maplibregl.Marker({element:node}).setLngLat([longitude,latitude]).addTo(previewMap);
              } else marker.setLngLat([longitude,latitude]);
              const radius=Math.max(10,accuracy||10), latRadius=radius/111320;
              const lngRadius=radius/(111320*Math.max(.01,Math.cos(latitude*Math.PI/180)));
              const ringCoordinates=Array.from({length:65},(_,i)=>{const angle=i*Math.PI*2/64;return [longitude+Math.cos(angle)*lngRadius,latitude+Math.sin(angle)*latRadius];});
              const feature={type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ringCoordinates]}};
              if(!previewMap.getSource('preview-accuracy')){
                previewMap.addSource('preview-accuracy',{type:'geojson',data:feature});
                previewMap.addLayer({id:'preview-accuracy-fill',type:'fill',source:'preview-accuracy',paint:{'fill-color':'#176b52','fill-opacity':.10}});
                previewMap.addLayer({id:'preview-accuracy-line',type:'line',source:'preview-accuracy',paint:{'line-color':'#176b52','line-width':1}});
              } else previewMap.getSource('preview-accuracy').setData(feature);
              previewMap.flyTo({center:[longitude,latitude],zoom:15});
            }
            state.textContent = '● GPS active';
            updated.textContent = 'Updated ' + new Date(position.timestamp).toLocaleTimeString('en-ZA') + ' · accuracy ±' + Math.round(accuracy || 0) + ' m';
          };
          start.addEventListener('click', () => {
            if (!navigator.geolocation) {
              updated.textContent = 'This browser does not support device location.';
              return;
            }
            if (watch !== null) return;
            state.textContent = 'Getting GPS fix…';
            start.disabled = true;
            navigator.geolocation.getCurrentPosition(position => {
              showPosition(position);
              watch = navigator.geolocation.watchPosition(showPosition, error => {
                state.textContent = 'GPS signal interrupted';
                updated.textContent = error.code === 1 ? 'Location permission denied. Enable it in browser settings.' : 'Could not refresh GPS. Check device location services.';
                start.disabled = false;
                stop.disabled = true;
                if (watch !== null) navigator.geolocation.clearWatch(watch);
                watch = null;
              }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
              stop.disabled = false;
            }, error => {
              state.textContent = 'GPS permission needed';
              updated.textContent = error.code === 1 ? 'Allow location access to show your position.' : 'Could not get a GPS fix. Check device location services.';
              start.disabled = false;
            }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
          });
          stop.addEventListener('click', () => {
            if (watch !== null) navigator.geolocation.clearWatch(watch);
            watch = null;
            state.textContent = 'Tracking paused';
            updated.textContent = 'Location updates have stopped on this device.';
            start.disabled = false;
            stop.disabled = true;
          });
          recenter.addEventListener('click', () => {
            if (previewMap && lastPoint) previewMap.flyTo({center:[lastPoint[1],lastPoint[0]],zoom:16});
            else if (previewMap) previewMap.flyTo({center:[24.0,-29.0],zoom:5});
          });
          const cleanupPreview = () => {
            if (watch !== null && navigator.geolocation) navigator.geolocation.clearWatch(watch);
            watch = null;
            if (previewMap) { previewMap.remove(); previewMap = null; }
            activeTrackingCleanups.delete(cleanupPreview);
          };
          activeTrackingCleanups.add(cleanupPreview);
        }
      }
      for (const order of data.orders || []) render(order);
      if (app === 'driver' && historyList() && !historyList().children.length) { const empty=document.createElement('p'); empty.textContent='No completed, failed or cancelled deliveries yet.'; historyList().append(empty); }
      if (app === 'driver' && !list.children.length) { const empty=document.createElement('p'); empty.textContent='No active deliveries are assigned right now.'; list.append(empty); }
      message.textContent = '';
    } catch (error) {
      if (current === requestNumber) message.textContent = error.message || 'Unable to load deliveries.';
    }
  }

  async function action(body, button) {
    const current = requestNumber;
    button.disabled = true;
    try {
      await invoke('POST', body);
      if (current !== requestNumber) return;
      await load();
      message.textContent = 'Delivery updated.';
    } catch (error) {
      if (current === requestNumber) message.textContent = error.message || 'Unable to update delivery.';
    } finally {
      button.disabled = false;
    }
  }

  function makeButton(parent, label, body) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => action(body, button));
    parent.append(button);
    return button;
  }

  function render(order) {
    const card = document.createElement('article');
    card.className = 'order';
  card.dataset.deliveryStatus = order.status || '';
    card.dataset.waybill = order.waybill;
    const title = document.createElement('h3');
    title.textContent = order.waybill;
    const route = document.createElement('p');
    route.textContent = order.pickup + ' → ' + order.dropoff;
    const summary = document.createElement('p');
    summary.textContent = [
      String(order.vehicle || '').toUpperCase(),
      money(order.price),
      statusLabel(order.status),
      order.paid_at ? 'Paid' : 'Payment pending'
    ].filter(Boolean).join(' · ');
    card.append(title, route, summary);
    const fullMap=document.createElement('a');fullMap.className='open-booking-map';fullMap.textContent='Open full-screen tracking map ↗';
    fullMap.href='map.html';
  fullMap.addEventListener('click',()=>{try{sessionStorage.setItem('swiftHaulMapContext',JSON.stringify({waybill:order.waybill,pickup:order.pickup,dropoff:order.dropoff,status:order.status||'Booking route',pickupLat:order.pickup_latitude,pickupLng:order.pickup_longitude,dropoffLat:order.dropoff_latitude,dropoffLng:order.dropoff_longitude}));}catch{} });card.append(fullMap);

    // Driver-only, Uber Parcel-inspired tracking experience. GPS remains local to this device.
    if (app === 'driver' && ['accepted', 'picked_up', 'in_transit'].includes(order.status)) {
      const pickup = { lat: Number(order.pickup_latitude), lng: Number(order.pickup_longitude) };
      const dropoff = { lat: Number(order.dropoff_latitude), lng: Number(order.dropoff_longitude) };
      const validPoint = point => Number.isFinite(point.lat) && Number.isFinite(point.lng) &&
        Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180 && !(point.lat === 0 && point.lng === 0);
      const tracking = document.createElement('section');
      tracking.className = 'driver-tracking';
      const trackingHead = document.createElement('div');
      trackingHead.className = 'tracking-head';
      const trackingTitle = document.createElement('h4');
      trackingTitle.textContent = order.status === 'accepted' ? 'Head to pickup' : 'Continue to drop-off';
      const trackingState = document.createElement('span');
      trackingState.className = 'tracking-state';
      trackingState.textContent = 'GPS not started';
      trackingHead.append(trackingTitle, trackingState);

      const mapStage = document.createElement('div');
      mapStage.className = 'tracking-map-stage';
      const trackingMap = document.createElement('div');
      trackingMap.className = 'driver-tracking-map';
      trackingMap.setAttribute('role', 'region');
      trackingMap.setAttribute('aria-label', 'Live delivery route map');
      const mapTools = document.createElement('div');
      mapTools.className = 'tracking-map-tools';
      const recenter = document.createElement('button');
      recenter.type = 'button'; recenter.className = 'tracking-map-tool';
      recenter.textContent = '◎  Recenter';
      mapTools.append(recenter);
      const mapLegend = document.createElement('div');
      mapLegend.className = 'tracking-map-legend';
      mapLegend.innerHTML = '<span><i class="pickup-dot"></i> Pickup</span><span><i class="dropoff-dot"></i> Drop-off</span><span><i class="driver-dot"></i> You</span>';
      mapStage.append(trackingMap, mapTools, mapLegend);

      const tripSheet = document.createElement('div');
      tripSheet.className = 'tracking-trip-sheet';
      const etaRow = document.createElement('div');
      etaRow.className = 'tracking-eta-row';
      const etaBlock = document.createElement('div');
      etaBlock.className = 'tracking-eta';
      const etaValue = document.createElement('strong');
      etaValue.textContent = '—';
      const etaCaption = document.createElement('span');
      etaCaption.textContent = 'Estimated arrival';
      etaBlock.append(etaValue, etaCaption);
      const distanceBlock = document.createElement('div');
      distanceBlock.className = 'tracking-distance';
      const distanceValue = document.createElement('strong');
      distanceValue.textContent = 'Route pending';
      const distanceCaption = document.createElement('span');
      distanceCaption.textContent = 'Road distance';
      distanceBlock.append(distanceValue, distanceCaption);
      etaRow.append(etaBlock, distanceBlock);

      const routeProgress = document.createElement('div');
      routeProgress.className = 'tracking-route-progress';
      const progressTrack = document.createElement('div');
      progressTrack.className = 'tracking-progress-track';
      const progressFill = document.createElement('span');
      progressFill.className = 'tracking-progress-fill';
      progressTrack.append(progressFill);
      const routeLabels = document.createElement('div');
      routeLabels.className = 'tracking-route-labels';
      const pickupLabel = document.createElement('span');
      pickupLabel.textContent = order.pickup || 'Pickup location';
      const dropoffLabel = document.createElement('span');
      dropoffLabel.textContent = order.dropoff || 'Destination';
      routeLabels.append(pickupLabel, dropoffLabel);
      routeProgress.append(progressTrack, routeLabels);

      const trackingActions = document.createElement('div');
      trackingActions.className = 'tracking-actions';
      const startTracking = document.createElement('button');
      startTracking.type = 'button'; startTracking.className = 'primary';
      startTracking.textContent = 'Start GPS tracking';
      const stopTracking = document.createElement('button');
      stopTracking.type = 'button'; stopTracking.textContent = 'Stop';
      stopTracking.disabled = true;
      trackingActions.append(startTracking, stopTracking);
      const trackingNote = document.createElement('p');
      trackingNote.className = 'tracking-note';
      trackingNote.textContent = 'Your GPS position is shown on this device only. Customer and dispatch sharing is not enabled yet.';
      const trackingUpdated = document.createElement('small');
      trackingUpdated.className = 'tracking-updated';
      trackingUpdated.textContent = 'Allow location access to show your live position.';
      tripSheet.append(etaRow, routeProgress, trackingActions, trackingNote, trackingUpdated);
      tracking.append(trackingHead, tripSheet, mapStage);
      card.append(tracking);

      let map = null, driverMarker = null, accuracyRing = null, routeLine = null, watchId = null;
      let currentDriverPoint = null, currentDriverPosition = null;
      const points = [];
      if (validPoint(pickup)) points.push([pickup.lat, pickup.lng]);
      if (validPoint(dropoff)) points.push([dropoff.lat, dropoff.lng]);
      const routeFeature = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: points.map(([lat,lng]) => [lng,lat]) } };
      let mapLoaded = false;
      const fitRoute = () => {
        if (!map || !points.length) return;
        const bounds = [...points, ...(currentDriverPoint ? [currentDriverPoint] : [])].map(([lat,lng]) => [lng,lat]);
        if (bounds.length > 1) map.fitBounds(bounds, { padding: 52, maxZoom: 15 });
        else map.setCenter(bounds[0]).setZoom(14);
      };
      const updateRoute = async origin => {
        if (!validPoint(dropoff) || !origin) return;
        try {
          const url = 'https://router.project-osrm.org/route/v1/driving/' +
            origin[1] + ',' + origin[0] + ';' + dropoff.lng + ',' + dropoff.lat +
            '?overview=full&geometries=geojson&steps=false';
          const response = await fetch(url, { headers: { Accept: 'application/json' } });
          if (!response.ok) throw new Error('Routing unavailable');
          const data = await response.json();
          const route = data.routes?.[0];
          if (!route) throw new Error('No road route found');
          if (map && mapLoaded && map.getSource('driver-route')) map.getSource('driver-route').setData(route.geometry);
          const km = route.distance / 1000;
          distanceValue.textContent = km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
          const mins = Math.max(1, Math.round(route.duration / 60));
          etaValue.textContent = mins >= 60 ? Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min' : mins + ' min';
          etaCaption.textContent = 'Estimated driving time';
          distanceCaption.textContent = 'Road distance · route estimate';
        } catch {
          distanceValue.textContent = 'Unavailable';
          etaValue.textContent = '—';
          etaCaption.textContent = 'ETA unavailable';
          distanceCaption.textContent = 'Road routing service unavailable';
        }
      };

      if (window.maplibregl && points.length) {
        map = new maplibregl.Map({
          container: trackingMap,
          style: {
            version: 8,
            sources: { carto: { type: 'raster', tiles: [
              'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
              'https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
              'https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
            ], tileSize: 256, attribution: '&copy; OpenStreetMap contributors &copy; CARTO' } },
            layers: [{ id: 'carto-voyager', type: 'raster', source: 'carto' }]
          },
          center: points[0].slice().reverse(), zoom: 12, attributionControl: true
        });
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        const marker = (point, color, title) => {
          const node = document.createElement('div');
          node.style.cssText = 'width:18px;height:18px;border:4px solid #fff;border-radius:50%;background:' + color + ';box-shadow:0 1px 8px #0005';
          return new maplibregl.Marker({ element: node }).setLngLat([point[1],point[0]]).setPopup(new maplibregl.Popup({ offset: 12 }).setText(title)).addTo(map);
        };
        if (validPoint(pickup)) marker([pickup.lat,pickup.lng], '#e9edf2', 'Pickup');
        if (validPoint(dropoff)) marker([dropoff.lat,dropoff.lng], '#9eb6d4', 'Drop-off');
        map.on('load', () => {
          mapLoaded = true;
          map.addSource('driver-route', { type: 'geojson', data: routeFeature });
          map.addLayer({ id: 'driver-route-casing', type: 'line', source: 'driver-route', paint: { 'line-color': '#fff', 'line-width': 12, 'line-opacity': .95, 'line-cap': 'round', 'line-join': 'round' } });
          map.addLayer({ id: 'driver-route-line', type: 'line', source: 'driver-route', paint: { 'line-color': '#9eb6d4', 'line-width': 6, 'line-opacity': .98, 'line-cap': 'round', 'line-join': 'round' } });
          fitRoute();
          if (points.length === 2) updateRoute(order.status === 'in_transit' && currentDriverPoint ? currentDriverPoint : [pickup.lat,pickup.lng]);
          if (currentDriverPosition) showPosition(currentDriverPosition);
        });
        map.on('error', () => { trackingNote.textContent = 'Map tiles could not be loaded. Your trip details and GPS controls remain available.'; });
        requestAnimationFrame(() => map && map.resize());
      } else {
        trackingMap.hidden = true;
        trackingNote.textContent = 'A route map needs valid pickup and destination coordinates. GPS can still be checked on this device.';
      }
      const showPosition = position => {
        currentDriverPosition = position;
        const coords = position.coords;
        currentDriverPoint = [coords.latitude, coords.longitude];
        if (map && mapLoaded) {
          if (!driverMarker) {
            const node = document.createElement('div');
            node.style.cssText = 'width:20px;height:20px;border:4px solid #fff;border-radius:50%;background:#176b52;box-shadow:0 1px 10px #0006';
            driverMarker = new maplibregl.Marker({ element: node }).setLngLat([coords.longitude,coords.latitude]).setPopup(new maplibregl.Popup({ offset: 12 }).setText('Your current position')).addTo(map);
          } else driverMarker.setLngLat([coords.longitude,coords.latitude]);
          const radius = Math.max(10, coords.accuracy || 10);
          const latRadius = radius / 111320;
          const lngRadius = radius / (111320 * Math.max(.01, Math.cos(coords.latitude * Math.PI / 180)));
          const ringCoordinates = Array.from({length:65},(_,i)=> {
            const angle = i * Math.PI * 2 / 64;
            return [coords.longitude + Math.cos(angle)*lngRadius, coords.latitude + Math.sin(angle)*latRadius];
          });
          const ringFeature = { type:'Feature', properties:{}, geometry:{type:'Polygon',coordinates:[ringCoordinates]} };
          if (!map.getSource('driver-accuracy')) {
            map.addSource('driver-accuracy',{type:'geojson',data:ringFeature});
            map.addLayer({id:'driver-accuracy-fill',type:'fill',source:'driver-accuracy',paint:{'fill-color':'#176b52','fill-opacity':.10}});
            map.addLayer({id:'driver-accuracy-outline',type:'line',source:'driver-accuracy',paint:{'line-color':'#176b52','line-width':1,'line-opacity':.7}});
          } else map.getSource('driver-accuracy').setData(ringFeature);
        }
        trackingState.textContent = '● GPS active';
        trackingUpdated.textContent = 'Updated ' + new Date(position.timestamp).toLocaleTimeString('en-ZA') +
          ' · accuracy ±' + Math.round(coords.accuracy || 0) + ' m';
        progressFill.style.width = order.status === 'in_transit' ? '68%' : order.status === 'picked_up' ? '45%' : '18%';
        if (order.status === 'in_transit') updateRoute([coords.latitude, coords.longitude]);
      };
      startTracking.addEventListener('click', () => {
        if (!navigator.geolocation) {
          trackingState.textContent = 'GPS unavailable';
          trackingUpdated.textContent = 'This browser does not support device location.';
          return;
        }
        if (watchId !== null) return;
        trackingState.textContent = 'Getting GPS fix…';
        startTracking.disabled = true;
        navigator.geolocation.getCurrentPosition(position => {
          showPosition(position);
          startTracking.disabled = true;
          stopTracking.disabled = false;
          watchId = navigator.geolocation.watchPosition(showPosition, error => {
            trackingState.textContent = 'GPS signal interrupted';
            trackingUpdated.textContent = error.code === 1
              ? 'Location permission denied. Enable location access in browser settings.'
              : 'GPS refresh failed. Check device location services.';
            startTracking.disabled = false; stopTracking.disabled = true;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            watchId = null;
          }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
        }, error => {
          trackingState.textContent = 'GPS permission needed';
          trackingUpdated.textContent = error.code === 1
            ? 'Allow location access to start tracking.'
            : 'Could not get a GPS fix. Check device location services.';
          startTracking.disabled = false;
        }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
      });
      stopTracking.addEventListener('click', () => {
        if (watchId !== null) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        trackingState.textContent = 'Tracking paused';
        trackingUpdated.textContent = 'GPS updates have stopped on this device.';
        startTracking.disabled = false; stopTracking.disabled = true;
      });
      recenter.addEventListener('click', () => {
        if (map && currentDriverPoint) map.flyTo({ center: [currentDriverPoint[1],currentDriverPoint[0]], zoom: 16 });
        else fitRoute();
      });
      const cleanupTracking = () => {
        if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
        watchId = null;
        if (map) { map.remove(); map = null; }
        activeTrackingCleanups.delete(cleanupTracking);
      };
      activeTrackingCleanups.add(cleanupTracking);
    }
    for (const [kind,label] of [['pickup','Pickup'],['dropoff','Drop-off']]) {
      const lat = order[kind + '_latitude'], lng = order[kind + '_longitude'];
      if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) continue;
      const location = document.createElement('p');
      location.textContent = label + ' coordinates: ' + Number(lat).toFixed(6) + ', ' + Number(lng).toFixed(6);
      card.append(location);
      if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        const mapLink = document.createElement('a');
        mapLink.href = 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
        mapLink.target = '_blank'; mapLink.rel = 'noopener noreferrer'; mapLink.textContent = 'Open ' + label.toLowerCase() + ' pin in Maps';
        card.append(mapLink);
      }
    }

    if (order.scheduled_at) {
      const scheduled = document.createElement('p');
      scheduled.textContent = 'Requested pickup: ' + new Date(order.scheduled_at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
      card.append(scheduled);
    }
    if (order.proof && app === 'company') {
      const proof = document.createElement('p');
      proof.textContent = 'Proof of delivery received' + (order.proof.recipient_name ? ' · ' + order.proof.recipient_name : '') + '.';
      card.append(proof);
    }
    if (order.status === 'failed' && order.failure_reason) {
      const reason = document.createElement('p');
      reason.textContent = 'Failure reason: ' + order.failure_reason;
      card.append(reason);
    }

    if (app === 'driver') {
      if (order.recipient) {
        const recipient = document.createElement('p');
        recipient.textContent = 'Recipient: ' + order.recipient;
        card.append(recipient);
      }
      if (order.status === 'assigned') makeButton(card, 'Accept delivery', { waybill: order.waybill, action: 'accept' });
      if (order.status === 'accepted') makeButton(card, 'Confirm pickup', { waybill: order.waybill, action: 'pickup' });
      if (order.status === 'picked_up') makeButton(card, 'Start delivery', { waybill: order.waybill, action: 'in_transit' });
      if (order.status === 'in_transit') {
        if (order.proof) {
          const proofNote = document.createElement('p');
          proofNote.textContent = 'Proof photo uploaded' + (order.proof.recipient_name ? ' · Recipient: ' + order.proof.recipient_name : '') + '.';
          card.append(proofNote);
          const form = document.createElement('form');
          const label = document.createElement('label');
          label.textContent = 'Recipient four-digit PIN';
          const pin = document.createElement('input');
          pin.name = 'pin';
          pin.inputMode = 'numeric';
          pin.pattern = '[0-9]{4}';
          pin.maxLength = 4;
          pin.required = true;
          pin.autocomplete = 'off';
          label.append(pin);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Confirm delivery';
          form.append(label, submit);
          form.addEventListener('submit', event => {
            event.preventDefault();
            action({ waybill: order.waybill, action: 'complete', pin: pin.value }, submit);
            pin.value = '';
          });
          card.append(form);
        } else {
          const form = document.createElement('form');
          const fileLabel = document.createElement('label');
          fileLabel.textContent = 'Proof-of-delivery photo (JPEG, PNG or WebP; max 10 MB)';
          const file = document.createElement('input');
          file.type = 'file';
          file.accept = 'image/jpeg,image/png,image/webp';
          file.required = true;
          fileLabel.append(file);
          const recipientLabel = document.createElement('label');
          recipientLabel.textContent = 'Recipient name (optional)';
          const recipient = document.createElement('input');
          recipient.maxLength = 120;
          recipientLabel.append(recipient);
          const notesLabel = document.createElement('label');
          notesLabel.textContent = 'Delivery notes (optional)';
          const notes = document.createElement('input');
          notes.maxLength = 500;
          notesLabel.append(notes);
          const submit = document.createElement('button');
          submit.type = 'submit';
          submit.textContent = 'Upload proof photo';
          form.append(fileLabel, recipientLabel, notesLabel, submit);
          form.addEventListener('submit', async event => {
            event.preventDefault();
            const selected = file.files?.[0];
            if (!selected) return;
            if (selected.size > 10 * 1024 * 1024) {
              message.textContent = 'Choose an image smaller than 10 MB.';
              return;
            }
            submit.disabled = true;
            message.textContent = 'Uploading proof photo…';
            try {
              const client = window.swiftHaulSupabase;
              const { data: upload, error: initError } = await client.functions.invoke('pod-upload', {
                body: { action: 'create', waybill: order.waybill, content_type: selected.type, size: selected.size }
              });
              if (initError || upload?.error) throw new Error(upload?.error || initError.message);
              const { error: storageError } = await client.storage.from('delivery-proof')
                .uploadToSignedUrl(upload.path, upload.token, selected, { contentType: selected.type, upsert: false });
              if (storageError) throw storageError;
              const { data: confirmed, error: confirmError } = await client.functions.invoke('pod-upload', {
                body: { action: 'confirm', waybill: order.waybill, path: upload.path, recipient_name: recipient.value, notes: notes.value }
              });
              if (confirmError || confirmed?.error) throw new Error(confirmed?.error || confirmError.message);
              await load();
              message.textContent = 'Proof photo uploaded. Enter the recipient PIN to complete delivery.';
            } catch (error) {
              message.textContent = error.message || 'Unable to upload proof photo.';
            } finally {
              submit.disabled = false;
            }
          });
          card.append(form);
        }
      }
      if (['accepted', 'picked_up', 'in_transit'].includes(order.status)) {
        const form = document.createElement('form');
        const label = document.createElement('label');
        label.textContent = 'Reason delivery cannot be completed';
        const reason = document.createElement('input');
        reason.maxLength = 300;
        reason.required = true;
        label.append(reason);
        const submit = document.createElement('button');
        submit.type = 'submit';
        submit.textContent = 'Report failed delivery';
        form.append(label, submit);
        form.addEventListener('submit', event => {
          event.preventDefault();
          action({ waybill: order.waybill, action: 'fail', reason: reason.value.trim() }, submit);
        });
        card.append(form);
      }
    } else if (!['delivered', 'failed', 'cancelled'].includes(order.status)) {
      const form = document.createElement('form');
      const label = document.createElement('label');
      label.textContent = 'Approved driver account ID';
      const id = document.createElement('input');
      id.required = true;
      id.maxLength = 36;
      id.pattern = '[0-9a-fA-F-]{36}';
      label.append(id);
      const submit = document.createElement('button');
      submit.type = 'submit';
      submit.textContent = 'Assign driver';
      form.append(label, submit);
      form.addEventListener('submit', event => {
        event.preventDefault();
        action({ waybill: order.waybill, action: 'assign', driver_id: id.value.trim() }, submit);
      });
      card.append(form);
    }
    if (app === 'driver' && ['delivered','failed','cancelled'].includes(order.status) && historyList()) { const history=historyList(); if(history.children.length===1 && history.firstElementChild?.textContent?.includes('No completed')) history.replaceChildren(); history.append(card); }
    else list.append(card);
  }

  refresh.addEventListener('click', load);
  document.addEventListener('account-ready', () => { active = true; load(); });
  document.addEventListener('account-cleared', () => {
    active = false;
    requestNumber++;
    for (const cleanup of activeTrackingCleanups) cleanup();
    activeTrackingCleanups.clear();
    list.replaceChildren();
    historyList()?.replaceChildren();
    message.textContent = '';
  });
  document.addEventListener('guest-preview', () => {
    active = false;
    requestNumber++;
    list.replaceChildren();
    historyList()?.replaceChildren();
    message.textContent = 'Sign in to access assigned deliveries and company dispatch.';
  });
}

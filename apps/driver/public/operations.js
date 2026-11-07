const app = document.body.dataset.app;
if (app === 'driver' || app === 'company') {
  const panel = document.getElementById('dispatches');
  const heading = panel.querySelector('h2');
  const message = document.createElement('p');
  message.setAttribute('role', 'status');
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.textContent = 'Refresh deliveries';
  const list = document.createElement('div');
  list.className = 'operations-list';
  panel.replaceChildren(heading, refresh, message, list);

  let active = false;
  let requestNumber = 0;
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
      if (app === 'driver' && data.driverProfile?.verification_status !== 'approved') {
        const notice = document.createElement('p');
        notice.textContent = 'Your driver application is awaiting verification. Dispatch access will be enabled after approval.';
        list.append(notice);
      }
      if (!data.orders?.length) {
        const empty = document.createElement('p');
        empty.textContent = 'No deliveries are currently assigned to this account.';
        list.append(empty);
      }
      for (const order of data.orders || []) render(order);
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
      trackingTitle.textContent = 'Your delivery';
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
      tracking.append(trackingHead, mapStage, tripSheet);
      card.append(tracking);

      let map = null, driverMarker = null, accuracyRing = null, routeLine = null, watchId = null;
      let currentDriverPoint = null;
      const points = [];
      if (validPoint(pickup)) points.push([pickup.lat, pickup.lng]);
      if (validPoint(dropoff)) points.push([dropoff.lat, dropoff.lng]);
      const fitRoute = () => {
        if (!map) return;
        const bounds = [...points, ...(currentDriverPoint ? [currentDriverPoint] : [])];
        if (bounds.length > 1) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
        else if (bounds.length) map.setView(bounds[0], 14);
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
          const coords = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
          if (map) {
            if (routeLine) routeLine.remove();
            routeLine = L.polyline(coords, { color: '#176b52', weight: 6, opacity: .95, lineCap: 'round', lineJoin: 'round' }).addTo(map);
          }
          const km = route.distance / 1000;
          distanceValue.textContent = km < 10 ? km.toFixed(1) + ' km' : Math.round(km) + ' km';
          const mins = Math.max(1, Math.round(route.duration / 60));
          etaValue.textContent = mins >= 60 ? Math.floor(mins / 60) + ' hr ' + (mins % 60) + ' min' : mins + ' min';
          etaCaption.textContent = 'Estimated driving time';
          distanceCaption.textContent = 'Road distance · live estimate';
        } catch {
          distanceValue.textContent = 'Unavailable';
          etaValue.textContent = '—';
          etaCaption.textContent = 'ETA unavailable';
          distanceCaption.textContent = 'Road routing service unavailable';
        }
      };

      if (window.L && points.length) {
        map = L.map(trackingMap, { zoomControl: false, scrollWheelZoom: true, attributionControl: true });
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
          maxZoom: 20, attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
        }).addTo(map);
        if (validPoint(pickup)) L.marker([pickup.lat, pickup.lng]).addTo(map).bindPopup('Pickup');
        if (validPoint(dropoff)) L.marker([dropoff.lat, dropoff.lng]).addTo(map).bindPopup('Drop-off');
        if (points.length === 2) {
          routeLine = L.polyline(points, { color: '#176b52', weight: 5, opacity: .85, dashArray: '3 9', lineCap: 'round' }).addTo(map);
          fitRoute();
          updateRoute([pickup.lat, pickup.lng]);
        } else map.setView(points[0], 14);
        requestAnimationFrame(() => map && map.invalidateSize());
      } else {
        trackingMap.hidden = true;
        trackingNote.textContent = 'A route map needs valid pickup and destination coordinates. GPS can still be checked on this device.';
      }

      const showPosition = position => {
        const coords = position.coords;
        currentDriverPoint = [coords.latitude, coords.longitude];
        if (map) {
          if (!driverMarker) driverMarker = L.circleMarker(currentDriverPoint, {
            radius: 10, color: '#fff', weight: 4, fillColor: '#176b52', fillOpacity: 1
          }).addTo(map).bindPopup('Your current position');
          else driverMarker.setLatLng(currentDriverPoint);
          if (accuracyRing) accuracyRing.remove();
          accuracyRing = L.circle(currentDriverPoint, {
            radius: Math.max(10, coords.accuracy || 10), color: '#176b52',
            weight: 1, fillColor: '#176b52', fillOpacity: .09
          }).addTo(map);
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
        if (map && currentDriverPoint) map.setView(currentDriverPoint, 16, { animate: true });
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
      const plus = order[kind + '_plus_code'];
      const lat = order[kind + '_latitude'], lng = order[kind + '_longitude'];
      if (!plus && (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng)))) continue;
      const location = document.createElement('p');
      location.textContent = label + ' pin: ' + (plus || 'coordinates saved') + (order[kind + '_geohash'] ? ' · Geohash ' + order[kind + '_geohash'] : '');
      card.append(location);
      if (lat != null && lng != null && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) {
        const mapLink = document.createElement('a');
        mapLink.href = 'https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng);
        mapLink.target = '_blank'; mapLink.rel = 'noopener noreferrer'; mapLink.textContent = 'Open ' + label.toLowerCase() + ' pin in Maps';
        card.append(mapLink);
      }
      if (plus) {
        const copy = document.createElement('button'); copy.type = 'button'; copy.textContent = 'Copy ' + label.toLowerCase() + ' Plus Code';
        copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(plus); message.textContent = label + ' Plus Code copied.'; } catch { message.textContent = 'Copy was blocked; select the code manually: ' + plus; } });
        card.append(copy);
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
    list.append(card);
  }

  refresh.addEventListener('click', load);
  document.addEventListener('account-ready', () => { active = true; load(); });
  document.addEventListener('account-cleared', () => {
    active = false;
    requestNumber++;
    for (const cleanup of activeTrackingCleanups) cleanup();
    activeTrackingCleanups.clear();
    list.replaceChildren();
    message.textContent = '';
  });
  document.addEventListener('guest-preview', () => {
    active = false;
    requestNumber++;
    list.replaceChildren();
    message.textContent = 'Sign in to access assigned deliveries and company dispatch.';
  });
}

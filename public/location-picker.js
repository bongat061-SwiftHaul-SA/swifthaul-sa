(() => {
  const app = document.body.dataset.app;
  const workspace = document.querySelector('#workspace .page');
  if (!workspace || document.getElementById('global-location-tools')) return;
  const style = document.createElement('style');
  style.textContent = `
    #global-location-tools{margin:0 0 26px;padding:22px;background:#fff;border:1px solid #d9e1d9;border-radius:14px}
    #global-location-tools h2{margin:0 0 8px;font-size:18px}
    #global-location-tools p{font-size:12px;line-height:1.7;color:#61776f}
    #global-location-tools .loc-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}
    #global-location-tools button{border:1px solid #d9e1d9;background:#f7f9f4;color:#17352e;border-radius:8px;padding:10px 14px;font-weight:700;cursor:pointer}
    #global-location-tools button.primary-loc{background:#21664e;color:white;border-color:#21664e}
    #global-location-tools input{box-sizing:border-box;max-width:100%;padding:11px;border:1px solid #c8d3c7;border-radius:8px;margin:5px 8px 5px 0}
    #global-location-map{height:320px;border-radius:10px;overflow:hidden;margin-top:12px;background:#edf2eb}
    #global-location-tools .loc-code{font:700 18px ui-monospace,monospace;letter-spacing:.4px;overflow-wrap:anywhere;color:#173d31}
    #global-location-tools .loc-meta{font:11px ui-monospace,monospace;overflow-wrap:anywhere}
    #global-location-tools .loc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
    #global-location-tools .loc-cell{padding:12px;background:#f7f9f4;border-radius:9px;min-width:0}
  `;
  document.head.append(style);
  const panel = document.createElement('section');
  panel.id = 'global-location-tools';
  panel.innerHTML = `
    <h2>Global pin &amp; Plus Code</h2>
    <p>Drop a pin anywhere on Earth, use your device location, then copy a globally usable Plus Code. Geohash is also generated for technical integrations. No Google Maps API key is required for this pin tool.</p>
    <div class="loc-actions"><button type="button" id="loc-open" class="primary-loc">Open global pin map</button><button type="button" id="loc-current">Use my current location</button></div>
    <div id="loc-map-wrap" hidden><label for="loc-search">Jump to coordinates (latitude, longitude)</label><input id="loc-search" placeholder="-26.2041, 28.0473" inputmode="decimal"><button type="button" id="loc-go">Go to coordinates</button><div id="global-location-map" role="application" aria-label="Select a location anywhere in the world by moving the map pin"></div><p>Tap anywhere on the map or drag the pin to the exact entrance, gate or collection point.</p></div>
    <div class="loc-grid" aria-live="polite"><div class="loc-cell"><p>Full Plus Code</p><div id="loc-plus" class="loc-code">Choose a location</div><button type="button" id="loc-copy-plus" disabled>Copy Plus Code</button></div><div class="loc-cell"><p>Geohash · technical reference</p><div id="loc-geohash" class="loc-meta">—</div><button type="button" id="loc-copy-geohash" disabled>Copy Geohash</button></div><div class="loc-cell"><p>Coordinates</p><div id="loc-coords" class="loc-meta">—</div><button type="button" id="loc-copy-coords" disabled>Copy coordinates</button></div></div>
    <p id="loc-reference-note">Plus Codes can be shared in full globally, or shortened and recovered using a known reference location.</p>
    <label for="loc-reference">Reference coordinates (optional, for a short regional code)</label><input id="loc-reference" placeholder="e.g. -26.2041, 28.0473" inputmode="decimal"><div class="loc-actions"><button type="button" id="loc-copy-short" disabled>Copy short code for this reference</button><button type="button" id="loc-copy-link" disabled>Copy map link</button></div>
    <p id="loc-status" role="status" aria-live="polite"></p>`;
  workspace.insertBefore(panel, workspace.firstChild);
  const $ = id => document.getElementById(id);
  let map, marker, selected = null, fullCode = '';
  const parsePair = value => {
    const m = String(value || '').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat,lng] : null;
  };
  function geohash(lat, lng, precision=9) {
    const alphabet='0123456789bcdefghjkmnpqrstuvwxyz';let latR=[-90,90],lngR=[-180,180],even=true,bits=0,ch=0,out='';
    while(out.length<precision){const range=even?lngR:latR,mid=(range[0]+range[1])/2;ch<<=1;if((even?lng:lat)>=mid){ch|=1;range[0]=mid}else range[1]=mid;even=!even;if(++bits===5){out+=alphabet[ch];bits=0;ch=0}}
    return out;
  }
  function update(lat,lng) {
    if (!window.OpenLocationCode || !window.L) { $('loc-status').textContent='The map or Plus Code library did not load. Check your connection and reload.';return; }
    selected={lat,lng};fullCode=window.OpenLocationCode.encode(lat,lng,10);
    $('loc-plus').textContent=fullCode;$('loc-geohash').textContent=geohash(lat,lng,9);$('loc-coords').textContent=lat.toFixed(6)+', '+lng.toFixed(6);
    for(const id of ['loc-copy-plus','loc-copy-geohash','loc-copy-coords','loc-copy-link'])$(id).disabled=false;
    const ref=parsePair($('loc-reference').value);$('loc-copy-short').disabled=!ref;
    $('loc-reference-note').textContent=ref?'Full code is always globally unique. The short code below is only meaningful with the reference coordinates entered.':'Plus Codes can be shared in full globally, or shortened and recovered using a known reference location.';
    if(marker)marker.setLatLng([lat,lng]);
    $('loc-status').textContent='Pin selected. Copy the full Plus Code to share it anywhere.';
  }
  function initMap() {
    if(map)return;
    if(!window.L){$('loc-status').textContent='Map library is still loading. Try again in a moment.';return;}
    map=L.map('global-location-map',{worldCopyJump:true}).setView([-15,20],2);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map);
    marker=L.marker([-15,20],{draggable:true}).addTo(map);
    marker.on('dragend',()=>{const p=marker.getLatLng();update(p.lat,p.lng)});
    map.on('click',e=>{marker.setLatLng(e.latlng);update(e.latlng.lat,e.latlng.lng)});
    setTimeout(()=>map.invalidateSize(),100);
  }
  $('loc-open').addEventListener('click',()=>{$('loc-map-wrap').hidden=false;initMap();setTimeout(()=>map?.invalidateSize(),100)});
  $('loc-current').addEventListener('click',()=>{
    if(!navigator.geolocation){$('loc-status').textContent='This device does not support location sharing.';return}
    $('loc-status').textContent='Requesting device location permission…';
    navigator.geolocation.getCurrentPosition(pos=>{const {latitude:lat,longitude:lng}=pos.coords;$('loc-map-wrap').hidden=false;initMap();map.setView([lat,lng],17);marker.setLatLng([lat,lng]);update(lat,lng);setTimeout(()=>map.invalidateSize(),100)},err=>{$('loc-status').textContent=err.code===1?'Location permission was denied. You can still drop a pin manually.':'Could not get your location. Drop a pin manually instead.'},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  });
  $('loc-go').addEventListener('click',()=>{const p=parsePair($('loc-search').value);if(!p){$('loc-status').textContent='Enter valid latitude, longitude (for example -26.2041, 28.0473).';return}initMap();map.setView(p,17);marker.setLatLng(p);update(...p)});
  $('loc-reference').addEventListener('input',()=>{const ref=parsePair($('loc-reference').value);$('loc-copy-short').disabled=!ref||!selected});
  async function copy(value){try{await navigator.clipboard.writeText(value);$('loc-status').textContent='Copied: '+value}catch{$('loc-status').textContent='Copy was blocked by the browser. Select the code and copy it manually.'}}
  $('loc-copy-plus').addEventListener('click',()=>selected&&copy(fullCode));
  $('loc-copy-geohash').addEventListener('click',()=>selected&&copy(geohash(selected.lat,selected.lng,9)));
  $('loc-copy-coords').addEventListener('click',()=>selected&&copy(selected.lat.toFixed(6)+', '+selected.lng.toFixed(6)));
  $('loc-copy-link').addEventListener('click',()=>selected&&copy('https://www.google.com/maps?q='+selected.lat+','+selected.lng));
  $('loc-copy-short').addEventListener('click',()=>{
    const ref=parsePair($('loc-reference').value);if(!ref||!selected)return;
    try{const short=window.OpenLocationCode.shorten(fullCode,ref[0],ref[1]);copy(short+' (reference: '+ref.join(', ')+')')}catch{$('loc-status').textContent='This location is too far from the reference for a safe short code. Copy the full Plus Code instead.'}
  });
  // Address fields can launch the same pin tool without silently changing a typed address.
  for(const id of ['custPickup','custDropoff']){
    const field=$(id);if(!field)continue;
    const button=document.createElement('button');button.type='button';button.textContent='Pick / copy pin';button.style.margin='8px 0 16px';
    button.addEventListener('click',()=>{$('loc-map-wrap').hidden=false;initMap();panel.scrollIntoView({behavior:'smooth',block:'start'});setTimeout(()=>map.invalidateSize(),150)});
    field.insertAdjacentElement('afterend',button);
  }
})();
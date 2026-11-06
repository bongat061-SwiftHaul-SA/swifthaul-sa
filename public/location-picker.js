(() => {
  const workspace=document.querySelector('#workspace .page');
  if(!workspace||document.getElementById('global-location-tools'))return;
  const app=document.body.dataset.app||'customer';
  const role=app==='driver'?'DRIVER NAVIGATION':app==='company'?'DISPATCH ROUTE OVERVIEW':'DELIVERY ROUTE';
  const title=app==='driver'?'Your next delivery':app==='company'?'Dispatch route overview':'Plan your parcel route';
  const subtitle=app==='driver'?'A glanceable route workspace. Open an assigned delivery below for task details and status actions.':app==='company'?'A route-first dispatch workspace. Review individual jobs below; multi-stop sequencing is a planning preview until route optimisation is connected.':'Set your pickup and drop-off points, then book and follow your parcel in one place.';
  const style=document.createElement('style');
  style.textContent=`
  #global-location-tools{margin:0 0 24px;border-radius:24px;overflow:hidden;background:#20252d;color:#f5f7fa;box-shadow:0 18px 42px #10182020}
  #global-location-tools *{box-sizing:border-box}
  #global-location-tools .loc-map{height:255px;position:relative;overflow:hidden;background:#111720}
  #global-location-tools .loc-map:after{content:"";position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 15%,#10151d88 100%);pointer-events:none}
  #global-location-tools .loc-grid{position:absolute;inset:-30%;opacity:.8;transform:rotate(-13deg);background-image:linear-gradient(#ffffff0b 1px,transparent 1px),linear-gradient(90deg,#ffffff0b 1px,transparent 1px);background-size:72px 72px}
  #global-location-tools .loc-road{position:absolute;height:13px;border:1px solid #ffffff0b;border-radius:100%;background:#222c39;transform:rotate(-22deg)}
  #global-location-tools .loc-road.r1{width:120%;left:-10%;top:48%}#global-location-tools .loc-road.r2{width:80%;left:22%;top:20%;transform:rotate(42deg)}#global-location-tools .loc-road.r3{width:90%;left:-18%;top:78%;transform:rotate(48deg)}
  #global-location-tools .loc-map-top{position:absolute;z-index:2;left:20px;right:20px;top:17px;display:flex;align-items:center;justify-content:space-between}
  #global-location-tools .loc-brand{font-size:11px;font-weight:900;letter-spacing:1.4px;color:#fff}.loc-brand b{color:#6bd296}
  #global-location-tools .loc-live{padding:8px 12px;border-radius:30px;background:#293341;color:#e9eef7;font-size:10px;font-weight:800}
  #global-location-tools .loc-live i{display:inline-block;width:7px;height:7px;border-radius:50%;background:#e8b85d;margin-right:7px}
  #global-location-tools .loc-svg{position:absolute;z-index:1;inset:20px 4% 0;width:92%;height:90%}
  #global-location-tools .loc-route-line{fill:none;stroke:#4c76ee;stroke-width:8;stroke-linecap:round;opacity:.28}
  #global-location-tools .loc-route-dash{fill:none;stroke:#78a0ff;stroke-width:3.5;stroke-linecap:round;stroke-dasharray:9 10}
  #global-location-tools .loc-pin-a{fill:#121923;stroke:#f4f7ff;stroke-width:4}#global-location-tools .loc-pin-b{fill:#4ab77a;stroke:#e4ffed;stroke-width:3}
  #global-location-tools .loc-map-label{position:absolute;z-index:2;padding:7px 10px;border-radius:9px;background:#27313eea;display:flex;flex-direction:column;gap:2px;max-width:43%}
  #global-location-tools .loc-map-label small{font-size:8px;letter-spacing:1px;color:#aab5c5;font-weight:800}#global-location-tools .loc-map-label strong{font-size:10px;color:white;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  #global-location-tools .loc-map-label.a{left:18px;bottom:18px}#global-location-tools .loc-map-label.b{right:18px;top:38%}
  #global-location-tools .loc-map-note{position:absolute;z-index:2;right:15px;bottom:4px;margin:0;color:#9da9b9;font-size:8px}
  #global-location-tools .loc-sheet{position:relative;margin-top:-12px;border-radius:22px 22px 0 0;background:#252b34;padding:19px 20px 18px;z-index:3}
  #global-location-tools .loc-sheet-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
  #global-location-tools .loc-kicker{margin:0 0 6px;font-size:9px;letter-spacing:1.5px;font-weight:900;color:#9ba8b9}
  #global-location-tools h2{margin:0;color:#fff;font-size:20px;letter-spacing:-.6px}
  #global-location-tools .loc-intro{margin:6px 0 0;color:#aab4c2;font-size:11px;line-height:1.5;max-width:520px}
  #global-location-tools .loc-route{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:17px 0 12px}
  #global-location-tools .loc-stop{min-width:0;padding:11px 12px;border:1px solid #424b58;border-radius:13px;background:#2d343f}
  #global-location-tools .loc-stop-top{display:flex;align-items:center;gap:8px;margin-bottom:7px}
  #global-location-tools .loc-dot{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;background:#3c5fae;color:#fff;font-size:9px;font-weight:900;flex:none}
  #global-location-tools .loc-stop:last-child .loc-dot{background:#27794f;border-radius:6px}
  #global-location-tools .loc-stop-label{font-size:9px;letter-spacing:.8px;text-transform:uppercase;color:#aab4c2;font-weight:900}
  #global-location-tools .loc-stop input{width:100%;min-width:0;padding:0;border:0;outline:0;background:transparent;color:#fff;font:600 11px inherit}
  #global-location-tools .loc-stop input::placeholder{color:#9aa6b5}
  #global-location-tools .loc-targets{margin-top:9px}
  #global-location-tools button{cursor:pointer;border:1px solid #4a5665;background:#343d49;color:#f5f7fa;border-radius:10px;padding:9px 11px;font-size:10px;font-weight:800}
  #global-location-tools button:disabled{opacity:.45;cursor:not-allowed}
  #global-location-tools .loc-targets button[aria-pressed=true]{border-color:#7799ff;background:#304878}
  #global-location-tools .loc-actions{display:flex;gap:8px;flex-wrap:wrap}
  #global-location-tools .loc-current{background:#4779f4;border-color:#4779f4;color:white;padding:11px 14px}
  #global-location-tools .loc-status{margin:11px 0 0;color:#b4bfcd;font-size:10px;line-height:1.5}
  #global-location-tools .loc-details{margin-top:13px;border-top:1px solid #ffffff18;padding-top:12px}
  #global-location-tools .loc-details summary{cursor:pointer;color:#c3ccda;font-size:10px;font-weight:800;list-style:none}
  #global-location-tools .loc-details summary::-webkit-details-marker{display:none}
  #global-location-tools .loc-details summary:after{content:"＋";float:right;font-size:14px}
  #global-location-tools .loc-details[open] summary:after{content:"−"}
  #global-location-tools .loc-input-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px;margin-top:12px}
  #global-location-tools .loc-field label{display:block;margin-bottom:5px;color:#aeb9c8;font-size:9px;font-weight:800}
  #global-location-tools .loc-field input{width:100%;min-width:0;padding:10px;border:1px solid #4a5665;border-radius:9px;background:#1d232c;color:white;font-size:11px}
  #global-location-tools .loc-code-card{margin-top:12px;padding:12px;border-radius:12px;background:#1d232c;border:1px solid #414b59}
  #global-location-tools .loc-code-label{margin:0 0 5px;color:#aab5c5;font-size:9px}
  #global-location-tools .loc-code{font:800 15px ui-monospace,monospace;color:#fff;overflow-wrap:anywhere}
  #global-location-tools .loc-meta{margin-top:5px;color:#9da9b9;font:9px ui-monospace,monospace;overflow-wrap:anywhere}
  #global-location-tools .loc-code-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:9px}
  #global-location-tools .loc-sequence{display:flex;align-items:center;gap:9px;margin:12px 0 0;padding:10px 12px;border-radius:12px;background:#1d232c;color:#c2ccda;font-size:10px}
  #global-location-tools .loc-sequence b{display:grid;place-items:center;width:21px;height:21px;border-radius:50%;background:#354b76;color:#fff}
  #global-location-tools .loc-sequence .future{border:1px dashed #677487;background:transparent;color:#aeb8c7}
  @media(max-width:600px){#global-location-tools .loc-map{height:230px}#global-location-tools .loc-sheet{padding:17px 15px}#global-location-tools .loc-route{grid-template-columns:1fr;gap:8px}#global-location-tools .loc-input-grid{grid-template-columns:1fr}#global-location-tools h2{font-size:18px}}
  `;
  document.head.append(style);
  const panel=document.createElement('section');panel.id='global-location-tools';panel.setAttribute('aria-label','Route overview and location tools');
  panel.innerHTML=`
  <div class="loc-map" role="img" aria-label="Illustrative route map, not live GPS">
    <div class="loc-grid"></div><div class="loc-road r1"></div><div class="loc-road r2"></div><div class="loc-road r3"></div>
    <div class="loc-map-top"><span class="loc-brand">SWIFTHAUL <b>SA</b></span><span class="loc-live"><i></i>${app==='driver'?'DRIVER VIEW':app==='company'?'DISPATCH VIEW':'ROUTE PREVIEW'}</span></div>
    <svg class="loc-svg" viewBox="0 0 600 250" aria-hidden="true"><path class="loc-route-line" d="M65 195 C140 40 245 76 310 120 S455 185 535 45"/><path class="loc-route-dash" d="M65 195 C140 40 245 76 310 120 S455 185 535 45"/><circle class="loc-pin-a" cx="65" cy="195" r="9"/><circle class="loc-pin-b" cx="535" cy="45" r="11"/></svg>
    <div class="loc-map-label a"><small>STOP A · PICKUP</small><strong id="loc-pickup-map-label">Pickup point</strong></div>
    <div class="loc-map-label b"><small>STOP B · DROP-OFF</small><strong id="loc-dropoff-map-label">Drop-off point</strong></div>
    <p class="loc-map-note">Illustrative route · not live driver GPS</p>
  </div>
  <div class="loc-sheet">
    <div class="loc-sheet-head"><div><p class="loc-kicker">${role}</p><h2>${title}</h2><p class="loc-intro">${subtitle}</p></div></div>
    <div class="loc-route" id="loc-route">
      <div class="loc-stop"><div class="loc-stop-top"><span class="loc-dot">A</span><label class="loc-stop-label" for="loc-pickup-view">Pickup</label></div><input id="loc-pickup-view" placeholder="Set pickup location" readonly><div class="loc-targets"><button type="button" data-target="custPickup" id="loc-target-pickup" aria-pressed="true">Pin pickup</button></div></div>
      <div class="loc-stop"><div class="loc-stop-top"><span class="loc-dot">B</span><label class="loc-stop-label" for="loc-dropoff-view">Drop-off</label></div><input id="loc-dropoff-view" placeholder="Set drop-off location" readonly><div class="loc-targets"><button type="button" data-target="custDropoff" id="loc-target-dropoff" aria-pressed="false">Pin drop-off</button></div></div>
    </div>
    ${app==='company'?'<div class="loc-sequence" aria-label="Multi-stop planning preview"><b>A</b><span>Pickup</span><span>→</span><b>B</b><span>Drop-off</span><span>→</span><b class="future">C</b><span>Next stop slot</span></div>':''}
    <div class="loc-actions"><button type="button" class="loc-current" id="loc-current">◎ Use current location</button></div>
    <details class="loc-details"><summary>Manual location entry · Plus Code and coordinates</summary>
      <div class="loc-input-grid">
        <div class="loc-field"><label for="loc-search">Latitude, longitude</label><input id="loc-search" placeholder="-26.2041, 28.0473" inputmode="decimal"></div>
        <div class="loc-field"><label for="loc-plus-input">Full or short Plus Code</label><input id="loc-plus-input" placeholder="5G5CQ2WW+9W" autocomplete="off"></div>
        <div class="loc-field"><label for="loc-reference">Short-code reference</label><input id="loc-reference" placeholder="Optional coordinates" inputmode="decimal"></div>
      </div>
      <div class="loc-actions" style="margin-top:9px"><button type="button" id="loc-go">Use coordinates</button><button type="button" id="loc-resolve-plus">Resolve Plus Code</button></div>
    </details>
    <div class="loc-code-card" aria-live="polite"><p class="loc-code-label">Selected location · Full Plus Code</p><div id="loc-code-output" class="loc-code">No pin selected</div><div id="loc-coords" class="loc-meta">Coordinates not set</div>
      <div class="loc-code-actions"><button type="button" id="loc-copy-plus" disabled>Copy Plus Code</button><button type="button" id="loc-copy-link" disabled>Open in Google Maps ↗</button></div>
      <details class="loc-details"><summary>Technical location data</summary><p class="loc-meta">Geohash · <span id="loc-geohash">—</span></p><div class="loc-code-actions"><button type="button" id="loc-copy-geohash" disabled>Copy Geohash</button><button type="button" id="loc-copy-coords" disabled>Copy coordinates</button><button type="button" id="loc-copy-short" disabled>Copy short code + reference</button></div></details>
    </div>
    <p class="loc-status" id="loc-status" role="status" aria-live="polite">Choose a stop, then set a pin. Addresses remain editable in your booking or dispatch details.</p>
  </div>`;
  workspace.insertBefore(panel,workspace.firstChild);
  const $=id=>document.getElementById(id);
  let selected=null,fullCode='',activeField=null;
  const pickup=$('custPickup'),dropoff=$('custDropoff');
  const parsePair=value=>{const m=String(value||'').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);if(!m)return null;const lat=Number(m[1]),lng=Number(m[2]);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?[lat,lng]:null;};
  function geohash(lat,lng,precision=9){const alphabet='0123456789bcdefghjkmnpqrstuvwxyz';let latRange=[-90,90],lngRange=[-180,180],even=true,bits=0,ch=0,out='';while(out.length<precision){const range=even?lngRange:latRange,mid=(range[0]+range[1])/2;ch<<=1;if((even?lng:lat)>=mid){ch|=1;range[0]=mid;}else range[1]=mid;even=!even;if(++bits===5){out+=alphabet[ch];bits=0;ch=0;}}return out;}
  function setTarget(field){activeField=field;$('loc-target-pickup').setAttribute('aria-pressed',String(field===pickup));$('loc-target-dropoff').setAttribute('aria-pressed',String(field===dropoff));$('loc-status').textContent='Pin selected for '+(field===pickup?'pickup':'drop-off')+'. Choose current location or enter a code below.';}
  function update(lat,lng){
    if(!window.OpenLocationCode){$('loc-status').textContent='Plus Code library unavailable. Reload and try again.';return;}
    selected={lat,lng};fullCode=window.OpenLocationCode.encode(lat,lng,10);
    const hash=geohash(lat,lng,9),coords=lat.toFixed(6)+', '+lng.toFixed(6);
    if(activeField){const form=activeField.closest('form'),prefix=activeField.name;for(const [suffix,value] of Object.entries({latitude:lat,longitude:lng,plus_code:fullCode,geohash:hash})){const name=prefix+'_'+suffix;let input=form?.querySelector('[name="'+name+'"]');if(!input&&form){input=document.createElement('input');input.type='hidden';input.name=name;form.append(input);}if(input)input.value=String(value);}activeField.value=fullCode;activeField.dispatchEvent(new Event('change',{bubbles:true}));$(activeField===pickup?'loc-pickup-view':'loc-dropoff-view').value=fullCode;}
    $('loc-code-output').textContent=fullCode;$('loc-coords').textContent=coords;$('loc-geohash').textContent=hash;$('loc-plus-input').value=fullCode;
    $('loc-pickup-map-label').textContent=pickup?.value||'Pickup point';$('loc-dropoff-map-label').textContent=dropoff?.value||'Drop-off point';
    for(const id of ['loc-copy-plus','loc-copy-geohash','loc-copy-coords','loc-copy-link'])$(id).disabled=false;
    $('loc-copy-short').disabled=!parsePair($('loc-reference').value);
    $('loc-status').textContent='Pin selected. Confirm the exact entrance or collection point before booking.';
  }
  if(pickup){$('loc-pickup-view').value=pickup.value||'';pickup.addEventListener('input',()=>{$('loc-pickup-view').value=pickup.value;$('loc-pickup-map-label').textContent=pickup.value||'Pickup point';});}else{$('loc-target-pickup').hidden=true;$('loc-stop-pickup')?.remove();}
  if(dropoff){$('loc-dropoff-view').value=dropoff.value||'';dropoff.addEventListener('input',()=>{$('loc-dropoff-view').value=dropoff.value;$('loc-dropoff-map-label').textContent=dropoff.value||'Drop-off point';});}else $('loc-target-dropoff').hidden=true;
  if(pickup)$('loc-target-pickup').addEventListener('click',()=>setTarget(pickup));
  if(dropoff)$('loc-target-dropoff').addEventListener('click',()=>setTarget(dropoff));
  if(!pickup&&!dropoff){$('loc-route').hidden=true;$('loc-status').textContent=app==='driver'?'Open an assigned delivery below to see its next task.':'Select a delivery in the dispatch list to review its route.';}
  else setTarget(pickup||dropoff);
  $('loc-go').addEventListener('click',()=>{const pair=parsePair($('loc-search').value);if(!pair){$('loc-status').textContent='Enter valid latitude, longitude, for example -26.2041, 28.0473.';return;}update(...pair);});
  $('loc-resolve-plus').addEventListener('click',()=>{if(!window.OpenLocationCode){$('loc-status').textContent='Plus Code library unavailable. Reload and try again.';return;}let code=$('loc-plus-input').value.trim().toUpperCase().replace(/\s/g,'');const reference=parsePair($('loc-reference').value);try{if(!window.OpenLocationCode.isValid(code))throw new Error('Enter a valid full Plus Code or a short code with reference coordinates.');if(!window.OpenLocationCode.isFull(code)){if(!reference)throw new Error('A short Plus Code needs reference coordinates.');code=window.OpenLocationCode.recoverNearest(code,reference[0],reference[1]);}const area=window.OpenLocationCode.decode(code);update(area.latitudeCenter,area.longitudeCenter);}catch(error){$('loc-status').textContent=error.message||'Could not resolve this Plus Code.';}});
  $('loc-current').addEventListener('click',()=>{if(!navigator.geolocation){$('loc-status').textContent='This device does not support location sharing.';return;}$('loc-status').textContent='Requesting device location permission…';navigator.geolocation.getCurrentPosition(pos=>update(pos.coords.latitude,pos.coords.longitude),err=>{$('loc-status').textContent=err.code===1?'Location permission was denied. Enter coordinates or a Plus Code instead.':'Could not get your location. Enter coordinates or a Plus Code instead.';},{enableHighAccuracy:true,timeout:15000,maximumAge:30000});});
  $('loc-reference').addEventListener('input',()=>{$('loc-copy-short').disabled=!parsePair($('loc-reference').value)||!selected;});
  async function copy(value){try{await navigator.clipboard.writeText(value);$('loc-status').textContent='Copied: '+value;}catch{$('loc-status').textContent='Copy was blocked. Select and copy manually.';}}
  $('loc-copy-plus').addEventListener('click',()=>selected&&copy(fullCode));$('loc-copy-geohash').addEventListener('click',()=>selected&&copy(geohash(selected.lat,selected.lng,9)));$('loc-copy-coords').addEventListener('click',()=>selected&&copy(selected.lat.toFixed(6)+', '+selected.lng.toFixed(6)));$('loc-copy-link').addEventListener('click',()=>selected&&window.open('https://www.google.com/maps?q='+selected.lat+','+selected.lng,'_blank','noopener'));
  $('loc-copy-short').addEventListener('click',()=>{const reference=parsePair($('loc-reference').value);if(!reference||!selected)return;try{const short=window.OpenLocationCode.shorten(fullCode,reference[0],reference[1]);copy(short+' (reference: '+reference.join(', ')+')');}catch{$('loc-status').textContent='This location is too far from the reference for a safe short code. Copy the full Plus Code instead.';}});
})();
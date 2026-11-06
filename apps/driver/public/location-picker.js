(() => {
  const workspace = document.querySelector('#workspace .page');
  if (!workspace || document.getElementById('global-location-tools')) return;

  const style = document.createElement('style');
  style.textContent = `
    #global-location-tools{--loc-ink:#111b18;--loc-muted:#69756f;--loc-line:#e6eae7;--loc-green:#176b4a;margin:0 0 28px;padding:0;background:#fff;border:1px solid var(--loc-line);border-radius:22px;overflow:hidden;box-shadow:0 12px 34px rgba(18,39,29,.07);color:var(--loc-ink)}
    #global-location-tools *{box-sizing:border-box}
    #global-location-tools .loc-head{padding:22px 22px 18px;background:#f8faf8;border-bottom:1px solid var(--loc-line)}
    #global-location-tools .loc-kicker{margin:0 0 7px;color:var(--loc-green);font-size:10px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase}
    #global-location-tools h2{margin:0;font-size:clamp(19px,3vw,25px);letter-spacing:-.8px;color:var(--loc-ink)}
    #global-location-tools .loc-intro{margin:7px 0 0;color:var(--loc-muted);font-size:12px;line-height:1.6}
    #global-location-tools .loc-route{padding:18px 22px 4px}
    #global-location-tools .loc-stop{display:grid;grid-template-columns:24px minmax(0,1fr);gap:12px;align-items:start;position:relative;padding-bottom:16px}
    #global-location-tools .loc-stop:not(:last-child):after{content:"";position:absolute;left:9px;top:20px;bottom:0;border-left:2px dotted #b8c8be}
    #global-location-tools .loc-dot{width:20px;height:20px;border:2px solid var(--loc-green);border-radius:50%;display:grid;place-items:center;background:#fff;color:var(--loc-green);font-size:9px;font-weight:900;z-index:1}
    #global-location-tools .loc-stop:last-child .loc-dot{border-radius:5px;border-color:#222f29;color:#222f29}
    #global-location-tools .loc-stop-label{display:block;margin:0 0 5px;color:var(--loc-muted);font-size:10px;font-weight:800;letter-spacing:.8px;text-transform:uppercase}
    #global-location-tools .loc-stop input{width:100%;min-width:0;margin:0;padding:12px 13px;border:1px solid #dfe5e0;border-radius:11px;background:#fff;color:var(--loc-ink);font:600 13px inherit}
    #global-location-tools .loc-stop input::placeholder{color:#89958e;font-weight:400}
    #global-location-tools .loc-stop button{margin-top:7px}
    #global-location-tools .loc-tools{padding:4px 22px 20px}
    #global-location-tools .loc-actions{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
    #global-location-tools button{border:1px solid #dce4de;background:#f7f9f7;color:#1d3328;border-radius:11px;padding:11px 14px;font-size:11px;font-weight:800;cursor:pointer}
    #global-location-tools button:hover{background:#edf4ef}
    #global-location-tools button.primary-loc{background:#176b4a;color:#fff;border-color:#176b4a}
    #global-location-tools button:disabled{opacity:.45;cursor:not-allowed}
    #global-location-tools .loc-current{width:100%;background:#176b4a;color:#fff;border-color:#176b4a;padding:14px}
    #global-location-tools .loc-current:hover,#global-location-tools button.primary-loc:hover{background:#10563b}
    #global-location-tools .loc-details{margin:0 22px 20px;border-top:1px solid var(--loc-line);padding-top:13px}
    #global-location-tools .loc-details summary{cursor:pointer;color:#43564b;font-size:11px;font-weight:800;list-style:none}
    #global-location-tools .loc-details summary::-webkit-details-marker{display:none}
    #global-location-tools .loc-details summary:after{content:"＋";float:right;font-size:15px}
    #global-location-tools .loc-details[open] summary:after{content:"−"}
    #global-location-tools .loc-input-grid{display:grid;grid-template-columns:1fr;gap:10px;margin-top:14px}
    #global-location-tools .loc-field label{display:block;margin:0 0 6px;color:var(--loc-muted);font-size:10px;font-weight:800}
    #global-location-tools .loc-field input{width:100%;min-width:0;margin:0;padding:12px;border:1px solid #dfe5e0;border-radius:10px;background:#fff;font-size:12px}
    #global-location-tools .loc-code-card{margin:0 22px 20px;padding:15px;border:1px solid #e3e9e4;border-radius:14px;background:#f8faf8}
    #global-location-tools .loc-code-label{margin:0 0 7px;color:var(--loc-muted);font-size:10px;font-weight:700}
    #global-location-tools .loc-code{font:800 19px ui-monospace,monospace;letter-spacing:.2px;overflow-wrap:anywhere;color:#183b2c}
    #global-location-tools .loc-meta{margin-top:7px;color:var(--loc-muted);font:10px ui-monospace,monospace;overflow-wrap:anywhere}
    #global-location-tools .loc-code-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:12px}
    #global-location-tools .loc-status{margin:0;padding:0 22px 17px;color:var(--loc-muted);font-size:11px;line-height:1.6}
    #global-location-tools .loc-targets{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
    #global-location-tools .loc-targets button[aria-pressed=true]{border-color:#176b4a;background:#eaf4ed;color:#14583e}
    @media(min-width:650px){#global-location-tools .loc-tools{display:grid;grid-template-columns:1fr 1fr;gap:10px}#global-location-tools .loc-current{grid-column:1/-1}#global-location-tools .loc-input-grid{grid-template-columns:1fr 1fr}}
  `;
  document.head.append(style);

  const panel = document.createElement('section');
  panel.id = 'global-location-tools';
  panel.setAttribute('aria-label','Parcel pickup and drop-off locations');
  panel.innerHTML = `
    <div class="loc-head">
      <p class="loc-kicker">SwiftHaul · Location details</p>
      <h2>Set your parcel locations</h2>
      <p class="loc-intro">Choose a pickup or drop-off point. Use your device location, coordinates or a Plus Code. No map tiles are loaded.</p>
    </div>
    <div class="loc-route">
      <div class="loc-stop">
        <span class="loc-dot" aria-hidden="true">A</span>
        <div><label class="loc-stop-label" for="loc-pickup-view">Pickup location</label><input id="loc-pickup-view" placeholder="Set pickup location" readonly><div class="loc-targets"><button type="button" data-target="custPickup" id="loc-target-pickup" aria-pressed="true">Set pickup pin</button></div></div>
      </div>
      <div class="loc-stop">
        <span class="loc-dot" aria-hidden="true">B</span>
        <div><label class="loc-stop-label" for="loc-dropoff-view">Drop-off location</label><input id="loc-dropoff-view" placeholder="Set drop-off location" readonly><div class="loc-targets"><button type="button" data-target="custDropoff" id="loc-target-dropoff" aria-pressed="false">Set drop-off pin</button></div></div>
      </div>
    </div>
    <div class="loc-tools">
      <button type="button" class="loc-current" id="loc-current">◎ Use my current location</button>
      <button type="button" id="loc-go" class="primary-loc">Use coordinates</button>
      <button type="button" id="loc-resolve-plus">Resolve Plus Code</button>
    </div>
    <details class="loc-details">
      <summary>Enter coordinates or a Plus Code manually</summary>
      <div class="loc-input-grid">
        <div class="loc-field"><label for="loc-search">Coordinates · latitude, longitude</label><input id="loc-search" placeholder="-26.2041, 28.0473" inputmode="decimal"></div>
        <div class="loc-field"><label for="loc-plus-input">Full or short Plus Code</label><input id="loc-plus-input" placeholder="e.g. 5G5CQ2WW+9W" autocomplete="off"></div>
        <div class="loc-field"><label for="loc-reference">Reference coordinates for a short code (optional)</label><input id="loc-reference" placeholder="-26.2041, 28.0473" inputmode="decimal"></div>
      </div>
    </details>
    <div class="loc-code-card" aria-live="polite">
      <p class="loc-code-label">Selected location · Full Plus Code</p>
      <div id="loc-code-output" class="loc-code">Choose a location</div>
      <div id="loc-coords" class="loc-meta">Coordinates not set</div>
      <div class="loc-code-actions">
        <button type="button" id="loc-copy-plus" disabled>Copy Plus Code</button>
        <button type="button" id="loc-copy-link" disabled>Open in Google Maps ↗</button>
      </div>
      <details class="loc-details" style="margin:12px 0 0;padding-top:10px">
        <summary>Technical location data</summary>
        <p class="loc-meta">Geohash · <span id="loc-geohash">—</span></p>
        <div class="loc-code-actions"><button type="button" id="loc-copy-geohash" disabled>Copy Geohash</button><button type="button" id="loc-copy-coords" disabled>Copy coordinates</button><button type="button" id="loc-copy-short" disabled>Copy short code + reference</button></div>
      </details>
    </div>
    <p class="loc-status" id="loc-status" role="status" aria-live="polite">Choose which stop to pin, then select a location.</p>
  `;
  workspace.insertBefore(panel, workspace.firstChild);

  const $ = id => document.getElementById(id);
  let selected = null, fullCode = '', activeField = null;
  const pickup = $('custPickup'), dropoff = $('custDropoff');
  const parsePair = value => {
    const m = String(value || '').trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]), lng = Number(m[2]);
    return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? [lat,lng] : null;
  };
  function geohash(lat,lng,precision=9) {
    const alphabet='0123456789bcdefghjkmnpqrstuvwxyz';
    let latRange=[-90,90],lngRange=[-180,180],even=true,bits=0,ch=0,out='';
    while(out.length<precision){const range=even?lngRange:latRange,mid=(range[0]+range[1])/2;ch<<=1;if((even?lng:lat)>=mid){ch|=1;range[0]=mid;}else range[1]=mid;even=!even;if(++bits===5){out+=alphabet[ch];bits=0;ch=0;}}
    return out;
  }
  function setTarget(field) {
    activeField = field;
    $('loc-target-pickup').setAttribute('aria-pressed',String(field===pickup));
    $('loc-target-dropoff').setAttribute('aria-pressed',String(field===dropoff));
    $('loc-status').textContent = field ? 'Pin selected for ' + (field===pickup?'pickup':'drop-off') + '. Choose your location below.' : 'Choose a location to copy or share.';
  }
  function update(lat,lng) {
    if(!window.OpenLocationCode){$('loc-status').textContent='The Plus Code library is unavailable. Reload this page and try again.';return;}
    selected={lat,lng};fullCode=window.OpenLocationCode.encode(lat,lng,10);
    const hash=geohash(lat,lng,9),coords=lat.toFixed(6)+', '+lng.toFixed(6);
    if(activeField){
      const form=activeField.closest('form'),prefix=activeField.name;
      for(const [suffix,value] of Object.entries({latitude:lat,longitude:lng,plus_code:fullCode,geohash:hash})){
        const name=prefix+'_'+suffix;let input=form?.querySelector('[name="'+name+'"]');
        if(!input&&form){input=document.createElement('input');input.type='hidden';input.name=name;form.append(input);}
        if(input)input.value=String(value);
      }
      activeField.value=fullCode;
      activeField.dispatchEvent(new Event('change',{bubbles:true}));
      const view=activeField===pickup?'loc-pickup-view':'loc-dropoff-view';
      $(view).value=fullCode;
    }
    $('loc-code-output').textContent=fullCode;$('loc-coords').textContent=coords;$('loc-geohash').textContent=hash;$('loc-plus-input').value=fullCode;
    for(const id of ['loc-copy-plus','loc-copy-geohash','loc-copy-coords','loc-copy-link'])$(id).disabled=false;
    $('loc-copy-short').disabled=!parsePair($('loc-reference').value);
    $('loc-status').textContent='Location selected. Confirm the exact entrance or collection point before booking.';
  }
  if(pickup){$('loc-pickup-view').value=pickup.value||'';pickup.addEventListener('input',()=>{$('loc-pickup-view').value=pickup.value;});}
  if(dropoff){$('loc-dropoff-view').value=dropoff.value||'';dropoff.addEventListener('input',()=>{$('loc-dropoff-view').value=dropoff.value;});}
  if(pickup)$('loc-target-pickup').addEventListener('click',()=>setTarget(pickup));
  else $('loc-target-pickup').hidden=true;
  if(dropoff)$('loc-target-dropoff').addEventListener('click',()=>setTarget(dropoff));
  else $('loc-target-dropoff').hidden=true;
  if(!pickup&&!dropoff){$('loc-route').hidden=true;$('loc-status').textContent='Use the location controls to create a shareable Plus Code.';}
  else setTarget(pickup||dropoff);

  $('loc-go').addEventListener('click',()=>{
    const pair=parsePair($('loc-search').value);
    if(!pair){$('loc-status').textContent='Enter valid latitude, longitude, for example -26.2041, 28.0473.';return;}
    update(...pair);
  });
  $('loc-resolve-plus').addEventListener('click',()=>{
    if(!window.OpenLocationCode){$('loc-status').textContent='The Plus Code library is unavailable. Reload and try again.';return;}
    let code=$('loc-plus-input').value.trim().toUpperCase().replace(/\s/g,'');
    const reference=parsePair($('loc-reference').value);
    try{
      if(!window.OpenLocationCode.isValid(code))throw new Error('Enter a valid full Plus Code or a short code with reference coordinates.');
      if(!window.OpenLocationCode.isFull(code)){if(!reference)throw new Error('A short Plus Code needs reference coordinates.');code=window.OpenLocationCode.recoverNearest(code,reference[0],reference[1]);}
      const area=window.OpenLocationCode.decode(code);update(area.latitudeCenter,area.longitudeCenter);
    }catch(error){$('loc-status').textContent=error.message||'Could not resolve this Plus Code.';}
  });
  $('loc-current').addEventListener('click',()=>{
    if(!navigator.geolocation){$('loc-status').textContent='This device does not support location sharing.';return;}
    $('loc-status').textContent='Requesting device location permission…';
    navigator.geolocation.getCurrentPosition(pos=>update(pos.coords.latitude,pos.coords.longitude),err=>{
      $('loc-status').textContent=err.code===1?'Location permission was denied. Enter coordinates or a Plus Code instead.':'Could not get your location. Enter coordinates or a Plus Code instead.';
    },{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
  });
  $('loc-reference').addEventListener('input',()=>{$('loc-copy-short').disabled=!parsePair($('loc-reference').value)||!selected;});
  async function copy(value){try{await navigator.clipboard.writeText(value);$('loc-status').textContent='Copied: '+value;}catch{$('loc-status').textContent='Copy was blocked by the browser. Select the value and copy it manually.';}}
  $('loc-copy-plus').addEventListener('click',()=>selected&&copy(fullCode));
  $('loc-copy-geohash').addEventListener('click',()=>selected&&copy(geohash(selected.lat,selected.lng,9)));
  $('loc-copy-coords').addEventListener('click',()=>selected&&copy(selected.lat.toFixed(6)+', '+selected.lng.toFixed(6)));
  $('loc-copy-link').addEventListener('click',()=>selected&&window.open('https://www.google.com/maps?q='+selected.lat+','+selected.lng,'_blank','noopener'));
  $('loc-copy-short').addEventListener('click',()=>{
    const reference=parsePair($('loc-reference').value);if(!reference||!selected)return;
    try{const short=window.OpenLocationCode.shorten(fullCode,reference[0],reference[1]);copy(short+' (reference: '+reference.join(', ')+')');}
    catch{$('loc-status').textContent='This location is too far from the reference for a safe short code. Copy the full Plus Code instead.';}
  });
})();
